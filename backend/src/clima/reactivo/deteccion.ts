import type {
  CondicionClima,
  ErrorFuenteClima,
  EvaluacionClima,
  FuenteUbicacionClima,
  MotivoDecisionClima,
  NivelRiesgoClima,
  ReferenciaClima,
  SenalClima,
} from "../../../../shared/types";
import type { ConfiguracionClimaReactivo } from "../../config/climaReactivo";
import type { ErrorApi } from "../../errores";
import type { ClimaActual, Pronostico } from "../../openweather/transformar";

export const NIVELES: readonly NivelRiesgoClima[] = ["favorable", "lluvia_ligera", "riesgo_elevado", "lluvia_significativa", "tormenta"];
export const NIVEL_DISPARO: NivelRiesgoClima = "riesgo_elevado";

const SEGUNDOS_INTERVALO_PRONOSTICO = 3 * 3600;

export function rango(nivel: NivelRiesgoClima): number {
  return NIVELES.indexOf(nivel);
}

const RANGO_CONDICION: Record<CondicionClima, number> = {
  tormenta: 4,
  lluvia_intensa: 3,
  lluvia_moderada: 3,
  lluvia_ligera: 1,
  llovizna: 1,
  despejado_o_nublado: 0,
  otra: 0,
};

// Grupos de condición de OpenWeather: https://openweathermap.org/weather-conditions
export function condicionPorCodigo(codigo: number): CondicionClima {
  if (codigo >= 200 && codigo < 300) return "tormenta";
  if (codigo >= 300 && codigo < 400) return "llovizna";
  if (codigo === 500 || codigo === 520) return "lluvia_ligera";
  if (codigo === 501 || codigo === 511 || codigo === 521) return "lluvia_moderada";
  if (codigo === 502 || codigo === 503 || codigo === 504 || codigo === 522 || codigo === 531) return "lluvia_intensa";
  if (codigo >= 800 && codigo < 900) return "despejado_o_nublado";
  return "otra";
}

function peorCondicion(codigos: readonly number[]): { condicion: CondicionClima; codigo: number | null } {
  let peor: { condicion: CondicionClima; codigo: number | null } = { condicion: "otra", codigo: null };
  for (const codigo of codigos) {
    const condicion = condicionPorCodigo(codigo);
    if (peor.codigo === null || RANGO_CONDICION[condicion] > RANGO_CONDICION[peor.condicion]) {
      peor = { condicion, codigo };
    }
  }
  return peor;
}

const iso = (segundos: number) => new Date(segundos * 1000).toISOString();

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: ErrorApi };

const aErrorFuente = (error: ErrorApi): ErrorFuenteClima => ({ codigo: error.codigo, mensaje: error.message });

export interface EntradaEvaluacion {
  actual: Resultado<ClimaActual>;
  pronostico: Resultado<Pronostico>;
  ubicacion: { lat: number; lng: number; fuente: FuenteUbicacionClima };
  ahora: Date;
  consultadoEn: Date;
  config: ConfiguracionClimaReactivo;
}

export function senalObservada(actual: ClimaActual, ahoraS: number, config: ConfiguracionClimaReactivo): SenalClima {
  const { condicion, codigo } = peorCondicion(actual.codigosClima);
  let nivel = NIVELES[RANGO_CONDICION[condicion]];
  if (actual.lluvia1hMm !== null && actual.lluvia1hMm >= config.umbralLluvia1hMm && rango(nivel) < rango("lluvia_significativa")) {
    nivel = "lluvia_significativa";
  }
  return {
    origen: "observado",
    nivel,
    condicion,
    codigoOpenWeather: codigo,
    descripcion: actual.descripcion,
    desde: iso(ahoraS),
    hasta: iso(ahoraS + config.ventanaObservacionMinutos * 60),
    probabilidadPrecipitacion: null,
    lluviaMm: actual.lluvia1hMm,
    periodoLluviaHoras: actual.lluvia1hMm === null ? null : 1,
  };
}

function nivelPronosticado(
  condicion: CondicionClima,
  probabilidad: number | null,
  lluviaMm: number,
  config: ConfiguracionClimaReactivo,
): NivelRiesgoClima {
  const lluviaAlta = lluviaMm >= config.umbralLluvia3hMm;
  if (probabilidad === null) {
    if (condicion === "tormenta") return "tormenta";
    return lluviaAlta ? "lluvia_significativa" : "favorable";
  }
  if (probabilidad < config.umbralProbabilidad) {
    return RANGO_CONDICION[condicion] > 0 ? "lluvia_ligera" : "favorable";
  }
  if (condicion === "tormenta") return "tormenta";
  if (lluviaAlta || RANGO_CONDICION[condicion] >= 3) return "lluvia_significativa";
  return "riesgo_elevado";
}

export function senalesPronosticadas(
  pronostico: Pronostico,
  ahoraS: number,
  config: ConfiguracionClimaReactivo,
): { cubierto: boolean; senales: SenalClima[] } {
  const hastaS = ahoraS + config.horizonteHoras * 3600;
  const relevantes = pronostico.registros.filter((r) => r.dt < hastaS && r.dt + SEGUNDOS_INTERVALO_PRONOSTICO > ahoraS);
  const senales = relevantes
    .map((registro): SenalClima => {
      const { condicion, codigo } = peorCondicion(registro.codigosClima);
      return {
        origen: "pronosticado",
        nivel: nivelPronosticado(condicion, registro.probabilidadPrecipitacion, registro.lluviaMm, config),
        condicion,
        codigoOpenWeather: codigo,
        descripcion: registro.descripcion,
        desde: iso(registro.dt),
        hasta: iso(registro.dt + SEGUNDOS_INTERVALO_PRONOSTICO),
        probabilidadPrecipitacion: registro.probabilidadPrecipitacion,
        lluviaMm: registro.lluviaMm,
        periodoLluviaHoras: 3,
      };
    })
    .filter((senal) => rango(senal.nivel) > 0);
  return { cubierto: relevantes.length > 0, senales };
}

function precede(a: SenalClima, b: SenalClima): boolean {
  if (rango(a.nivel) !== rango(b.nivel)) return rango(a.nivel) > rango(b.nivel);
  if (a.origen !== b.origen) return a.origen === "observado";
  return a.desde < b.desde;
}

export function identificarEvento(senal: SenalClima, desplazamientoUtcSegundos: number): string {
  const bloque = Math.floor((Date.parse(senal.desde) / 1000 + desplazamientoUtcSegundos) / SEGUNDOS_INTERVALO_PRONOSTICO);
  return `${senal.nivel}:${senal.origen}:${senal.condicion}:${bloque}`;
}

export function evaluarClima({ actual, pronostico, ubicacion, ahora, consultadoEn, config }: EntradaEvaluacion): EvaluacionClima {
  const ahoraS = Math.floor(ahora.getTime() / 1000);
  let observacion: EvaluacionClima["observacion"] = { estado: "no_disponible", observadaEn: null, senal: null, error: null };
  if (actual.ok) {
    const antiguedadS = ahoraS - actual.valor.dt;
    observacion = {
      estado: antiguedadS > config.antiguedadMaximaObservacionMinutos * 60 ? "obsoleta" : "vigente",
      observadaEn: iso(actual.valor.dt),
      senal: senalObservada(actual.valor, ahoraS, config),
      error: null,
    };
  } else {
    observacion.error = aErrorFuente(actual.error);
  }

  let pronosticoEvaluado: EvaluacionClima["pronostico"] = { estado: "no_disponible", senales: [], error: null };
  if (pronostico.ok) {
    const { cubierto, senales } = senalesPronosticadas(pronostico.valor, ahoraS, config);
    pronosticoEvaluado = { estado: cubierto ? "disponible" : "sin_cobertura", senales, error: null };
  } else {
    pronosticoEvaluado.error = aErrorFuente(pronostico.error);
  }

  const consideradas = [
    ...(observacion.estado === "vigente" && observacion.senal ? [observacion.senal] : []),
    ...pronosticoEvaluado.senales,
  ];
  const hayDatos = observacion.estado === "vigente" || pronosticoEvaluado.estado === "disponible";
  const principal = consideradas.reduce<SenalClima | null>((mejor, senal) => (!mejor || precede(senal, mejor) ? senal : mejor), null);
  const nivel: NivelRiesgoClima | null = hayDatos ? principal?.nivel ?? "favorable" : null;
  const desplazamiento = actual.ok ? actual.valor.desplazamientoUtcSegundos : pronostico.ok ? pronostico.valor.desplazamientoUtcSegundos : 0;

  return {
    fuente: "openweathermap",
    ubicacion,
    consultadoEn: consultadoEn.toISOString(),
    observacion,
    pronostico: pronosticoEvaluado,
    nivel,
    senalPrincipal: principal,
    eventoId: principal && rango(principal.nivel) >= rango(NIVEL_DISPARO) ? identificarEvento(principal, desplazamiento) : null,
    umbrales: {
      probabilidadPrecipitacion: config.umbralProbabilidad,
      lluvia1hMm: config.umbralLluvia1hMm,
      lluvia3hMm: config.umbralLluvia3hMm,
      horizonteHoras: config.horizonteHoras,
    },
  };
}

export function senalesDeRiesgo(evaluacion: EvaluacionClima): SenalClima[] {
  const senales = [
    ...(evaluacion.observacion.estado === "vigente" && evaluacion.observacion.senal ? [evaluacion.observacion.senal] : []),
    ...evaluacion.pronostico.senales,
  ];
  return senales.filter((senal) => rango(senal.nivel) >= rango(NIVEL_DISPARO));
}

export interface Decision {
  requierePropuesta: boolean;
  motivo: MotivoDecisionClima;
  referencia: ReferenciaClima | null;
}

export function decidir(
  evaluacion: EvaluacionClima,
  referencia: ReferenciaClima | null | undefined,
  ahora: Date,
  config: ConfiguracionClimaReactivo,
): Decision {
  const previa = referencia ?? null;
  if (evaluacion.nivel === null) {
    return { requierePropuesta: false, motivo: "datos_insuficientes", referencia: previa };
  }

  const actual = rango(evaluacion.nivel);
  const anterior = rango(previa?.nivel ?? "favorable");
  const avanzar = (): ReferenciaClima => ({
    nivel: evaluacion.nivel as NivelRiesgoClima,
    eventoId: evaluacion.eventoId,
    evaluadoEn: ahora.toISOString(),
    nivelNotificado: previa?.nivelNotificado ?? null,
    ultimaPropuestaEn: previa?.ultimaPropuestaEn ?? null,
  });

  if (actual < rango(NIVEL_DISPARO)) {
    return { requierePropuesta: false, motivo: "sin_riesgo_relevante", referencia: avanzar() };
  }
  if (previa?.eventoId && previa.eventoId === evaluacion.eventoId) {
    return { requierePropuesta: false, motivo: "evento_ya_notificado", referencia: avanzar() };
  }
  if (actual <= anterior) {
    return { requierePropuesta: false, motivo: "sin_empeoramiento", referencia: avanzar() };
  }

  const ultima = previa?.ultimaPropuestaEn ? Date.parse(previa.ultimaPropuestaEn) : Number.NaN;
  const enEspera = Number.isFinite(ultima) && ahora.getTime() - ultima < config.esperaEntrePropuestasMinutos * 60_000;
  const superaLoNotificado = actual > rango(previa?.nivelNotificado ?? "favorable");
  if (enEspera && !superaLoNotificado) {
    // Se conserva la referencia anterior para que el empeoramiento se reconsidere al terminar la espera.
    return { requierePropuesta: false, motivo: "espera_entre_propuestas", referencia: previa };
  }
  return { requierePropuesta: true, motivo: "empeoramiento_detectado", referencia: previa };
}

export function referenciaNotificada(evaluacion: EvaluacionClima, ahora: Date): ReferenciaClima {
  return {
    nivel: evaluacion.nivel ?? "favorable",
    eventoId: evaluacion.eventoId,
    evaluadoEn: ahora.toISOString(),
    nivelNotificado: evaluacion.nivel,
    ultimaPropuestaEn: ahora.toISOString(),
  };
}
