import { ErrorApi } from "../errores";
import { fechaLocal } from "../clima/fechas";
import { esObjeto } from "../tipos";

const SEGUNDOS_POR_INTERVALO = 3 * 3600;
export const INTERVALOS_POR_DIA = 8;
const DESPLAZAMIENTO_MINIMO_S = -12 * 3600;
const DESPLAZAMIENTO_MAXIMO_S = 14 * 3600;

export interface RegistroPronostico {
  dt: number;
  temperaturaC: number;
  lluviaMm: number;
  probabilidadPrecipitacion: number | null;
  codigosClima: number[];
  descripcion: string | null;
}

export interface ClimaActual {
  dt: number;
  desplazamientoUtcSegundos: number;
  codigosClima: number[];
  descripcion: string | null;
  lluvia1hMm: number | null;
  temperaturaC: number | null;
}

export interface Pronostico {
  desplazamientoUtcSegundos: number;
  registros: RegistroPronostico[];
}

export type EstadoDia = "disponible" | "parcial" | "fuera_de_cobertura" | "sin_datos";

export interface ResumenDia {
  fecha: string;
  estado: EstadoDia;
  temperaturaPromedioC: number | null;
  temperaturaMinimaC: number | null;
  temperaturaMaximaC: number | null;
  lluviaMm: number | null;
  intervalosDisponibles: number;
}

export interface Cobertura {
  desde: string;
  hasta: string;
  primerIntervalo: string;
  ultimoIntervalo: string;
}

export interface Advertencia {
  codigo: "SERIE_VACIA" | "FUERA_DE_COBERTURA" | "COBERTURA_PARCIAL" | "SIN_DATOS";
  mensaje: string;
  fechas: string[];
}

function respuestaInvalida(): ErrorApi {
  return new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de clima devolvió una respuesta con formato inesperado.");
}

function esNumeroFinito(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

function esEnteroSeguro(valor: unknown): valor is number {
  return Number.isSafeInteger(valor);
}

function leerDesplazamiento(ciudad: unknown): number {
  const desplazamiento = esObjeto(ciudad) ? ciudad.timezone : undefined;
  if (
    !esEnteroSeguro(desplazamiento) ||
    desplazamiento < DESPLAZAMIENTO_MINIMO_S ||
    desplazamiento > DESPLAZAMIENTO_MAXIMO_S
  ) {
    throw respuestaInvalida();
  }
  return desplazamiento;
}

function leerLluvia(registro: Record<string, unknown>): number {
  if (!("rain" in registro)) {
    return 0;
  }
  const volumen = esObjeto(registro.rain) ? registro.rain["3h"] : undefined;
  if (!esNumeroFinito(volumen) || volumen < 0) {
    throw respuestaInvalida();
  }
  return volumen;
}


function leerProbabilidad(valor: unknown): number | null {
  return esNumeroFinito(valor) && valor >= 0 && valor <= 1 ? valor : null;
}

function leerCondiciones(valor: unknown): { codigosClima: number[]; descripcion: string | null } {
  const condiciones = Array.isArray(valor) ? valor.filter(esObjeto) : [];
  const codigosClima = condiciones.map((c) => c.id).filter((id): id is number => esEnteroSeguro(id) && id >= 200 && id < 1000);
  const descripcion = condiciones.map((c) => c.description).find((d): d is string => typeof d === "string" && d.trim() !== "");
  return { codigosClima, descripcion: descripcion?.trim() ?? null };
}

function leerRegistro(registro: unknown): RegistroPronostico {
  if (!esObjeto(registro) || !esEnteroSeguro(registro.dt) || !esObjeto(registro.main)) {
    throw respuestaInvalida();
  }
  if (!esNumeroFinito(registro.main.temp)) {
    throw respuestaInvalida();
  }
  return {
    dt: registro.dt,
    temperaturaC: registro.main.temp,
    lluviaMm: leerLluvia(registro),
    probabilidadPrecipitacion: leerProbabilidad(registro.pop),
    ...leerCondiciones(registro.weather),
  };
}

export function interpretarClimaActual(datos: unknown): ClimaActual {
  if (!esObjeto(datos) || !esEnteroSeguro(datos.dt) || datos.dt <= 0 || !Array.isArray(datos.weather)) {
    throw respuestaInvalida();
  }
  const desplazamiento = datos.timezone;
  if (!esEnteroSeguro(desplazamiento) || desplazamiento < DESPLAZAMIENTO_MINIMO_S || desplazamiento > DESPLAZAMIENTO_MAXIMO_S) {
    throw respuestaInvalida();
  }
  let lluvia1hMm: number | null = null;
  if ("rain" in datos) {
    const volumen = esObjeto(datos.rain) ? datos.rain["1h"] : undefined;
    if (volumen !== undefined && (!esNumeroFinito(volumen) || volumen < 0)) {
      throw respuestaInvalida();
    }
    lluvia1hMm = esNumeroFinito(volumen) ? volumen : null;
  }
  const temperatura = esObjeto(datos.main) ? datos.main.temp : undefined;
  return {
    dt: datos.dt,
    desplazamientoUtcSegundos: desplazamiento,
    ...leerCondiciones(datos.weather),
    lluvia1hMm,
    temperaturaC: esNumeroFinito(temperatura) ? temperatura : null,
  };
}

export function interpretarPronostico(datos: unknown): Pronostico {
  if (!esObjeto(datos) || !Array.isArray(datos.list)) {
    throw respuestaInvalida();
  }

  const desplazamientoUtcSegundos = leerDesplazamiento(datos.city);
  const ordenados = datos.list.map(leerRegistro).sort((a, b) => a.dt - b.dt);

  const registros: RegistroPronostico[] = [];
  for (const registro of ordenados) {
    const anterior = registros[registros.length - 1];
    if (anterior && anterior.dt === registro.dt) {
      continue;
    }
    if (anterior && registro.dt - anterior.dt < SEGUNDOS_POR_INTERVALO) {
      throw respuestaInvalida();
    }
    registros.push(registro);
  }

  return { desplazamientoUtcSegundos, registros };
}

function redondear(valor: number): number {
  const redondeado = Math.round(valor * 100) / 100;
  return redondeado === 0 ? 0 : redondeado;
}

function resumir(fecha: string, registros: RegistroPronostico[]): ResumenDia {
  const temperaturas = registros.map((registro) => registro.temperaturaC);
  const suma = temperaturas.reduce((total, temperatura) => total + temperatura, 0);
  const lluvia = registros.reduce((total, registro) => total + registro.lluviaMm, 0);

  return {
    fecha,
    estado: registros.length >= INTERVALOS_POR_DIA ? "disponible" : "parcial",
    temperaturaPromedioC: redondear(suma / temperaturas.length),
    temperaturaMinimaC: Math.min(...temperaturas),
    temperaturaMaximaC: Math.max(...temperaturas),
    lluviaMm: redondear(lluvia),
    intervalosDisponibles: registros.length,
  };
}

function sinResumen(fecha: string, estado: EstadoDia): ResumenDia {
  return {
    fecha,
    estado,
    temperaturaPromedioC: null,
    temperaturaMinimaC: null,
    temperaturaMaximaC: null,
    lluviaMm: null,
    intervalosDisponibles: 0,
  };
}

function calcularCobertura(registros: RegistroPronostico[], desplazamientoUtcSegundos: number): Cobertura | null {
  if (registros.length === 0) {
    return null;
  }
  const primero = registros[0].dt;
  const ultimo = registros[registros.length - 1].dt;
  return {
    desde: fechaLocal(primero, desplazamientoUtcSegundos),
    hasta: fechaLocal(ultimo, desplazamientoUtcSegundos),
    primerIntervalo: new Date(primero * 1000).toISOString(),
    ultimoIntervalo: new Date(ultimo * 1000).toISOString(),
  };
}

export function resumirPorDia({
  registros,
  desplazamientoUtcSegundos,
  fechas,
}: Pronostico & { fechas: string[] }): { cobertura: Cobertura | null; dias: ResumenDia[] } {
  const porFecha = new Map<string, RegistroPronostico[]>();
  for (const registro of registros) {
    const fecha = fechaLocal(registro.dt, desplazamientoUtcSegundos);
    const delDia = porFecha.get(fecha);
    if (delDia) {
      delDia.push(registro);
    } else {
      porFecha.set(fecha, [registro]);
    }
  }

  const cobertura = calcularCobertura(registros, desplazamientoUtcSegundos);

  const dias = fechas.map((fecha) => {
    if (!cobertura) {
      return sinResumen(fecha, "sin_datos");
    }
    if (fecha < cobertura.desde || fecha > cobertura.hasta) {
      return sinResumen(fecha, "fuera_de_cobertura");
    }
    const delDia = porFecha.get(fecha);
    return delDia ? resumir(fecha, delDia) : sinResumen(fecha, "sin_datos");
  });

  return { cobertura, dias };
}

function fechasConEstado(dias: ResumenDia[], estado: EstadoDia): string[] {
  return dias.filter((dia) => dia.estado === estado).map((dia) => dia.fecha);
}

export function construirAdvertencias(dias: ResumenDia[], cobertura: Cobertura | null): Advertencia[] {
  if (!cobertura) {
    return [
      {
        codigo: "SERIE_VACIA",
        mensaje: "El proveedor no devolvió intervalos de pronóstico; ninguna fecha tiene datos.",
        fechas: dias.map((dia) => dia.fecha),
      },
    ];
  }

  const advertencias: Advertencia[] = [];
  const fuera = fechasConEstado(dias, "fuera_de_cobertura");
  if (fuera.length > 0) {
    advertencias.push({
      codigo: "FUERA_DE_COBERTURA",
      mensaje: `Estas fechas están fuera del pronóstico disponible (${cobertura.desde} a ${cobertura.hasta}).`,
      fechas: fuera,
    });
  }
  const parciales = fechasConEstado(dias, "parcial");
  if (parciales.length > 0) {
    advertencias.push({
      codigo: "COBERTURA_PARCIAL",
      mensaje: `Estas fechas tienen menos de ${INTERVALOS_POR_DIA} intervalos de tres horas; su resumen es incompleto.`,
      fechas: parciales,
    });
  }
  const sinDatos = fechasConEstado(dias, "sin_datos");
  if (sinDatos.length > 0) {
    advertencias.push({
      codigo: "SIN_DATOS",
      mensaje: "El proveedor no devolvió intervalos para estas fechas dentro de la cobertura.",
      fechas: sinDatos,
    });
  }
  return advertencias;
}
