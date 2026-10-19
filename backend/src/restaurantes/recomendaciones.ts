import type {
  MotivoSinEstimacionRestaurante,
  MotivoSinRecomendacionesRestaurante,
  ParadaFallidaRestaurantes,
  ParadaProcesadaRestaurantes,
  PreciosReferencialesRestaurantes,
  RespuestaRecomendacionesRestaurantes,
  RestauranteRecomendado,
  RestauranteSinEstimacion,
  ResultadoParadaRestaurantes,
  TarifaReferencialRestaurante,
} from "../../../shared/types";
import { ErrorApi } from "../errores";
import { distanciaMetros } from "../hoteles/geografia";
import { ordenarPorCercania } from "../hoteles/recomendaciones";
import type { ParadaSolicitudRestaurantes, SolicitudRestaurantes } from "../validacion/restaurantes";
import { CATEGORIAS_RESTAURANTES, RESULTADOS_PROVEEDOR_POR_PARADA, type BuscarRestaurantes, type RestauranteProveedor, type ResultadoBusquedaRestaurantes } from "./busqueda";
import {
  CATALOGO_TARIFAS_RESTAURANTES,
  crearAsignadorTarifas,
  fuentesDelCatalogo,
  type AsignarTarifa,
  type CatalogoTarifasRestaurantes,
  type ReferenciaTarifa,
} from "./catalogo";
import { ejecutarConLimite, type ResultadoTarea } from "./planificador";
import {
  COMIDAS_PRINCIPALES_POR_DIA,
  PORCENTAJE_ALIMENTACION,
  cabeEnPresupuesto,
  calcularCostoGrupoCentavos,
  calcularPresupuestoAlimentacionCentavos,
  calcularPresupuestoPorPersonaCentavos,
} from "./tarifas";

// Con 250 ms entre inicios se envían como máximo 4 búsquedas por segundo, bajo el límite de 5 del plan gratuito de Geoapify.
export const CONCURRENCIA_BUSQUEDAS = 2;
export const INTERVALO_BUSQUEDAS_MS = 250;

const CODIGOS_QUE_DETIENEN = new Set(["SERVICIO_NO_CONFIGURADO", "PROVEEDOR_CREDENCIALES_INVALIDAS", "PROVEEDOR_LIMITE_SOLICITUDES"]);

export const MENSAJES_SIN_RECOMENDACIONES: Record<MotivoSinRecomendacionesRestaurante, string> = {
  sin_restaurantes_encontrados: "La búsqueda alrededor de esta parada no devolvió restaurantes con nombre, coordenadas y categorías utilizables.",
  sin_restaurantes_en_radio: "Los restaurantes devueltos por el proveedor quedan fuera del radio de búsqueda de esta parada.",
  sin_tarifas_aplicables: "Hay restaurantes cerca de esta parada, pero ninguno tiene una tarifa referencial sustentada para estimar su costo.",
  sin_restaurantes_en_presupuesto: "Hay restaurantes con tarifa referencial cerca de esta parada, pero el costo referencial del grupo supera el presupuesto de alimentación.",
};

const MENSAJE_SIN_PARADAS = "El itinerario del día no tiene paradas; no hay puntos alrededor de los cuales buscar restaurantes.";
const MENSAJE_BUSQUEDA_FALLIDA =
  "La búsqueda de restaurantes de esta parada falló por un error técnico del proveedor; no significa que no existan restaurantes cercanos.";
const MENSAJE_BUSQUEDA_OMITIDA = "No se consultó esta parada porque una búsqueda anterior de la misma solicitud falló con este error.";

export const AVISO_PRECIOS =
  "Los importes son rangos referenciales de mercado en GTQ calculados con estadísticas públicas (Numbeo y Preciosmundi); no son precios publicados ni confirmados por los establecimientos. El filtro asegura que el costo referencial máximo del grupo no supera el presupuesto de alimentación, no el importe real de la cuenta.";

export type RecomendarRestaurantes = (solicitud: SolicitudRestaurantes) => Promise<RespuestaRecomendacionesRestaurantes>;

interface Candidato {
  restaurante: RestauranteProveedor;
  idExterno: string;
  distancia: number;
}

interface CandidatoEstimado extends Candidato {
  referencia: ReferenciaTarifa;
  costoCentavos: number;
}

interface CandidatoSinEstimacion extends Candidato {
  motivo: MotivoSinEstimacionRestaurante;
}

interface Contexto {
  solicitud: SolicitudRestaurantes;
  presupuestoAlimentacionCentavos: number;
  asignarTarifa: AsignarTarifa;
}

export function claveBusqueda({ lat, lng }: { lat: number; lng: number }): string {
  return `${lat.toFixed(7)},${lng.toFixed(7)}`;
}

function debeDetener(error: unknown): boolean {
  return !(error instanceof ErrorApi) || CODIGOS_QUE_DETIENEN.has(error.codigo);
}

function aBase({ restaurante, distancia }: Candidato) {
  return {
    idExterno: restaurante.idExterno,
    proveedor: "geoapify" as const,
    nombre: restaurante.nombre,
    direccion: restaurante.direccion,
    lat: restaurante.lat,
    lng: restaurante.lng,
    categorias: restaurante.categorias,
    distanciaLineaRectaMetros: Math.round(distancia),
  };
}

export function aTarifaReferencial(referencia: ReferenciaTarifa): TarifaReferencialRestaurante {
  return {
    referencial: true,
    precioConfirmado: false,
    referenciaId: referencia.id,
    perfil: referencia.perfil,
    aplicabilidad: referencia.aplicabilidad,
    confianza: referencia.confianza,
    region: referencia.region,
    moneda: referencia.moneda,
    unidad: referencia.unidad,
    minimo: referencia.minimoCentavos / 100,
    minimoCentavos: referencia.minimoCentavos,
    maximo: referencia.maximoCentavos / 100,
    maximoCentavos: referencia.maximoCentavos,
    criterioEvaluacion: "maximo_del_rango",
    valorEvaluacion: referencia.maximoCentavos / 100,
    valorEvaluacionCentavos: referencia.maximoCentavos,
    alcance: referencia.alcance,
    fuentes: referencia.fuentes.map(({ nombre, url, indicador, consultadoEn }) => ({ nombre, url, indicador, consultadoEn })),
  };
}

function aRecomendado(candidato: CandidatoEstimado, comensales: number): RestauranteRecomendado {
  return {
    ...aBase(candidato),
    estimacion: "estimado",
    tarifaReferencial: aTarifaReferencial(candidato.referencia),
    costoReferencialGrupo: { comensales, importe: candidato.costoCentavos / 100, importeCentavos: candidato.costoCentavos, moneda: "GTQ" },
    elegiblePorPresupuesto: true,
  };
}

function aSinEstimacion(candidato: CandidatoSinEstimacion): RestauranteSinEstimacion {
  return {
    ...aBase(candidato),
    estimacion: "sin_estimacion",
    motivoSinEstimacion: candidato.motivo,
    tarifaReferencial: null,
    costoReferencialGrupo: null,
    elegiblePorPresupuesto: false,
  };
}

function motivoSinRecomendaciones(validos: number, enRadio: number, estimados: number, elegibles: number): MotivoSinRecomendacionesRestaurante | null {
  if (elegibles > 0) {
    return null;
  }
  if (validos === 0) {
    return "sin_restaurantes_encontrados";
  }
  if (enRadio === 0) {
    return "sin_restaurantes_en_radio";
  }
  return estimados === 0 ? "sin_tarifas_aplicables" : "sin_restaurantes_en_presupuesto";
}

export function evaluarParada(
  parada: ParadaSolicitudRestaurantes,
  resultado: ResultadoBusquedaRestaurantes,
  busquedaCompartida: boolean,
  { solicitud, presupuestoAlimentacionCentavos, asignarTarifa }: Contexto,
): ParadaProcesadaRestaurantes {
  let fueraDeRadio = 0;
  let excluidosPorPresupuesto = 0;
  const elegibles: CandidatoEstimado[] = [];
  const sinEstimacion: CandidatoSinEstimacion[] = [];

  for (const restaurante of resultado.restaurantes) {
    const distancia = distanciaMetros(parada, restaurante);
    if (distancia > solicitud.radio) {
      fueraDeRadio++;
      continue;
    }
    const candidato: Candidato = { restaurante, idExterno: restaurante.idExterno, distancia };
    const asignacion = asignarTarifa(restaurante.categorias, restaurante.codigoPais);
    if (asignacion.estado === "sin_estimacion") {
      sinEstimacion.push({ ...candidato, motivo: asignacion.motivo });
      continue;
    }
    const costoCentavos = calcularCostoGrupoCentavos(asignacion.referencia.maximoCentavos, solicitud.comensales);
    if (cabeEnPresupuesto(costoCentavos, presupuestoAlimentacionCentavos)) {
      elegibles.push({ ...candidato, referencia: asignacion.referencia, costoCentavos });
    } else {
      excluidosPorPresupuesto++;
    }
  }

  const validos = resultado.restaurantes.length;
  const enRadio = validos - fueraDeRadio;
  const motivo = motivoSinRecomendaciones(validos, enRadio, enRadio - sinEstimacion.length, elegibles.length);
  return {
    id: parada.id,
    lat: parada.lat,
    lng: parada.lng,
    estado: "procesada",
    restaurantesEncontrados: enRadio,
    recomendacionesElegibles: elegibles.length,
    restaurantes: ordenarPorCercania(elegibles)
      .slice(0, solicitud.limite)
      .map((candidato) => aRecomendado(candidato, solicitud.comensales)),
    sinEstimacion: ordenarPorCercania(sinEstimacion).slice(0, solicitud.limite).map(aSinEstimacion),
    busqueda: {
      proveedor: "geoapify",
      categorias: [...CATEGORIAS_RESTAURANTES],
      radioMetros: solicitud.radio,
      limiteProveedor: RESULTADOS_PROVEEDOR_POR_PARADA,
      resultadosProveedor: resultado.resultadosRecibidos,
      resultadosDescartados: resultado.resultadosRecibidos - validos,
      fueraDeRadio,
      sinEstimacion: sinEstimacion.length,
      excluidosPorPresupuesto,
      posiblesResultadosAdicionales: resultado.resultadosRecibidos >= RESULTADOS_PROVEEDOR_POR_PARADA,
      busquedaCompartida,
    },
    motivo,
    mensaje: motivo && MENSAJES_SIN_RECOMENDACIONES[motivo],
    error: null,
  };
}

function paradaFallida(parada: ParadaSolicitudRestaurantes, error: ErrorApi, consultada: boolean): ParadaFallidaRestaurantes {
  return {
    id: parada.id,
    lat: parada.lat,
    lng: parada.lng,
    estado: "fallida",
    restaurantesEncontrados: null,
    recomendacionesElegibles: null,
    restaurantes: [],
    sinEstimacion: [],
    busqueda: null,
    motivo: "busqueda_fallida",
    mensaje: consultada ? MENSAJE_BUSQUEDA_FALLIDA : MENSAJE_BUSQUEDA_OMITIDA,
    error: { codigo: error.codigo, mensaje: error.message, consultada },
  };
}

function errorDe(resultado: Exclude<ResultadoTarea<unknown>, { estado: "completada" }>): unknown {
  return resultado.estado === "fallida" ? resultado.error : resultado.causa;
}

export function crearRecomendadorRestaurantes({
  buscar,
  catalogo = CATALOGO_TARIFAS_RESTAURANTES,
  concurrencia = CONCURRENCIA_BUSQUEDAS,
  intervaloMs = INTERVALO_BUSQUEDAS_MS,
}: {
  buscar: BuscarRestaurantes;
  catalogo?: CatalogoTarifasRestaurantes;
  concurrencia?: number;
  intervaloMs?: number;
}): RecomendarRestaurantes {
  const asignarTarifa = crearAsignadorTarifas(catalogo);
  const preciosReferenciales: PreciosReferencialesRestaurantes = {
    referencial: true,
    precioConfirmado: false,
    moneda: "GTQ",
    unidad: "persona_comida",
    criterioEvaluacion: "maximo_del_rango",
    consultadoEn: catalogo.consultadoEn,
    fuentes: fuentesDelCatalogo(catalogo),
    aviso: AVISO_PRECIOS,
  };

  return async function recomendarRestaurantes(solicitud) {
    const presupuestoAlimentacionCentavos = calcularPresupuestoAlimentacionCentavos(solicitud.presupuestoDiarioCentavos);
    const presupuestoPorPersonaCentavos = calcularPresupuestoPorPersonaCentavos(presupuestoAlimentacionCentavos, solicitud.comensales);

    const responder = (
      paradas: ResultadoParadaRestaurantes[],
      busquedas: { intentadas: number; omitidas: number },
      motivo: "itinerario_sin_paradas" | null,
    ): RespuestaRecomendacionesRestaurantes => {
      const procesadas = paradas.filter((parada) => parada.estado === "procesada").length;
      return {
        fecha: solicitud.fecha,
        moneda: solicitud.moneda,
        presupuestoDiario: solicitud.presupuestoDiarioCentavos / 100,
        presupuestoDiarioCentavos: solicitud.presupuestoDiarioCentavos,
        porcentajeAlimentacion: PORCENTAJE_ALIMENTACION,
        presupuestoAlimentacion: presupuestoAlimentacionCentavos / 100,
        presupuestoAlimentacionCentavos,
        comensales: solicitud.comensales,
        presupuestoPorPersona: presupuestoPorPersonaCentavos / 100,
        presupuestoPorPersonaCentavos,
        comidasPresupuestadas: COMIDAS_PRINCIPALES_POR_DIA,
        metodoDistancia: "linea_recta",
        radioMetros: solicitud.radio,
        limitePorParada: solicitud.limite,
        preciosReferenciales,
        paradas,
        resumen: {
          paradasSolicitadas: solicitud.paradas.length,
          paradasProcesadas: procesadas,
          paradasFallidas: paradas.length - procesadas,
          busquedasIntentadas: busquedas.intentadas,
          busquedasOmitidas: busquedas.omitidas,
          completo: procesadas === paradas.length,
        },
        motivo,
        mensaje: motivo && MENSAJE_SIN_PARADAS,
      };
    };

    if (solicitud.paradas.length === 0) {
      return responder([], { intentadas: 0, omitidas: 0 }, "itinerario_sin_paradas");
    }

    const centros = new Map<string, ParadaSolicitudRestaurantes>();
    for (const parada of solicitud.paradas) {
      const clave = claveBusqueda(parada);
      if (!centros.has(clave)) {
        centros.set(clave, parada);
      }
    }
    const claves = [...centros.keys()];
    const resultados = await ejecutarConLimite(claves, (clave) => buscar(centros.get(clave) as ParadaSolicitudRestaurantes, solicitud.radio), {
      concurrencia,
      intervaloMs,
      detenerTras: debeDetener,
    });

    for (const resultado of resultados) {
      if (resultado.estado !== "completada" && !(errorDe(resultado) instanceof ErrorApi)) {
        throw errorDe(resultado);
      }
    }

    const porClave = new Map(claves.map((clave, indice) => [clave, resultados[indice]]));
    const contexto: Contexto = { solicitud, presupuestoAlimentacionCentavos, asignarTarifa };
    const usadas = new Set<string>();
    const paradas = solicitud.paradas.map((parada): ResultadoParadaRestaurantes => {
      const clave = claveBusqueda(parada);
      const resultado = porClave.get(clave) as ResultadoTarea<ResultadoBusquedaRestaurantes>;
      const compartida = usadas.has(clave);
      usadas.add(clave);
      if (resultado.estado === "completada") {
        return evaluarParada(parada, resultado.valor, compartida, contexto);
      }
      return paradaFallida(parada, errorDe(resultado) as ErrorApi, resultado.estado === "fallida");
    });

    if (paradas.every((parada) => parada.estado === "fallida")) {
      const primera = resultados.find((resultado) => resultado.estado === "fallida") ?? resultados[0];
      throw errorDe(primera as Exclude<ResultadoTarea<unknown>, { estado: "completada" }>);
    }

    const omitidas = resultados.filter((resultado) => resultado.estado === "omitida").length;
    return responder(paradas, { intentadas: resultados.length - omitidas, omitidas }, null);
  };
}
