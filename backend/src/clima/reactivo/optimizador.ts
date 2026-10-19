import type { ModoTransporteRuta } from "../../../../shared/types";
import { errorRespuestaOptimizador, type LlamarOptimizador } from "../../optimizador/cliente";
import { esObjeto } from "../../tipos";

export interface ParadaOptimizador {
  id: string;
  lat: number;
  lng: number;
  hora_apertura: string;
  hora_cierre: string;
  tiempo_estancia_minutos: number;
}

export interface SolicitudReoptimizacionClima {
  paradas: ParadaOptimizador[];
  horaActualMinutos: number;
  modoTransporte: ModoTransporteRuta;
  origen: { lat: number; lng: number } | null;
  sustituciones: { paradaId: string; candidatos: ParadaOptimizador[] }[];
}

export interface VisitaOptimizada {
  paradaId: string;
  inicioMinutos: number;
  finMinutos: number;
  trasladoSegundos: number;
  distanciaMetros: number;
}

export interface RutaOptimizada {
  orden: string[];
  viable: boolean;
  distanciaTotalKm: number | null;
  duracionTrasladoMinutos: number | null;
  visitas: VisitaOptimizada[];
}

export interface ResultadoReoptimizacionClima {
  rutaActual: RutaOptimizada;
  rutaPropuesta: RutaOptimizada | null;
  motivoSinRuta: string | null;
  sustituciones: { paradaId: string; alternativaId: string }[];
  sinSustitucion: { paradaId: string; motivo: "sin_candidatos" | "sin_alternativa_viable" }[];
}

export type ReoptimizarClima = (solicitud: SolicitudReoptimizacionClima) => Promise<ResultadoReoptimizacionClima>;

const esNumero = (valor: unknown): valor is number => typeof valor === "number" && Number.isFinite(valor);
const esNumeroONulo = (valor: unknown): valor is number | null => valor === null || esNumero(valor);

function leerRuta(datos: unknown, permitidos: Set<string>): RutaOptimizada {
  if (!esObjeto(datos) || !Array.isArray(datos.orden) || typeof datos.viable !== "boolean" || !Array.isArray(datos.visitas) ||
    !esNumeroONulo(datos.distancia_total_km) || !esNumeroONulo(datos.duracion_traslado_minutos)) {
    throw errorRespuestaOptimizador();
  }
  const orden = datos.orden;
  if (!orden.every((id): id is string => typeof id === "string" && permitidos.has(id)) || new Set(orden).size !== orden.length) {
    throw errorRespuestaOptimizador("El optimizador devolvió un orden de paradas inválido.");
  }
  const visitas = datos.visitas.map((visita): VisitaOptimizada => {
    if (!esObjeto(visita) || typeof visita.parada_id !== "string" || !esNumero(visita.inicio_minutos) || !esNumero(visita.fin_minutos) ||
      !esNumero(visita.traslado_segundos) || !esNumero(visita.distancia_metros)) {
      throw errorRespuestaOptimizador();
    }
    return {
      paradaId: visita.parada_id,
      inicioMinutos: visita.inicio_minutos,
      finMinutos: visita.fin_minutos,
      trasladoSegundos: visita.traslado_segundos,
      distanciaMetros: visita.distancia_metros,
    };
  });
  if (visitas.length > 0 && visitas.map((v) => v.paradaId).join("\u0000") !== orden.join("\u0000")) {
    throw errorRespuestaOptimizador("Las visitas del optimizador no coinciden con el orden devuelto.");
  }
  return {
    orden,
    viable: datos.viable,
    distanciaTotalKm: datos.distancia_total_km,
    duracionTrasladoMinutos: datos.duracion_traslado_minutos,
    visitas,
  };
}

export function crearReoptimizadorClima(llamarOptimizador: LlamarOptimizador): ReoptimizarClima {
  return async function reoptimizarClima(solicitud) {
    const datos = await llamarOptimizador("/reoptimize-clima", {
      paradas: solicitud.paradas,
      hora_actual_minutos: solicitud.horaActualMinutos,
      modo_transporte: solicitud.modoTransporte,
      origen: solicitud.origen,
      sustituciones: solicitud.sustituciones.map((g) => ({ parada_id: g.paradaId, candidatos: g.candidatos })),
    });
    if (!esObjeto(datos) || !Array.isArray(datos.sustituciones) || !Array.isArray(datos.sin_sustitucion)) {
      throw errorRespuestaOptimizador();
    }

    const pendientes = new Set(solicitud.paradas.map((p) => p.id));
    const candidatosPorParada = new Map(solicitud.sustituciones.map((g) => [g.paradaId, new Set(g.candidatos.map((c) => c.id))]));
    const permitidos = new Set([...pendientes, ...[...candidatosPorParada.values()].flatMap((ids) => [...ids])]);

    const rutaActual = leerRuta(datos.ruta_actual, pendientes);
    if (rutaActual.orden.join("\u0000") !== solicitud.paradas.map((p) => p.id).join("\u0000")) {
      throw errorRespuestaOptimizador("La ruta actual del optimizador no conserva el orden enviado.");
    }
    const rutaPropuesta = datos.ruta_propuesta === null ? null : leerRuta(datos.ruta_propuesta, permitidos);

    const sustituciones = datos.sustituciones.map((s) => {
      if (!esObjeto(s) || typeof s.parada_id !== "string" || typeof s.alternativa_id !== "string" ||
        !candidatosPorParada.get(s.parada_id)?.has(s.alternativa_id)) {
        throw errorRespuestaOptimizador("El optimizador devolvió una sustitución que no se solicitó.");
      }
      return { paradaId: s.parada_id, alternativaId: s.alternativa_id };
    });
    if (new Set(sustituciones.map((s) => s.alternativaId)).size !== sustituciones.length) {
      throw errorRespuestaOptimizador("El optimizador usó el mismo lugar para varias sustituciones.");
    }
    const sinSustitucion = datos.sin_sustitucion.map((s) => {
      if (!esObjeto(s) || typeof s.parada_id !== "string" || (s.motivo !== "sin_candidatos" && s.motivo !== "sin_alternativa_viable")) {
        throw errorRespuestaOptimizador();
      }
      return { paradaId: s.parada_id, motivo: s.motivo as "sin_candidatos" | "sin_alternativa_viable" };
    });

    if (rutaPropuesta) {
      const esperados = new Set([...pendientes].map((id) => sustituciones.find((s) => s.paradaId === id)?.alternativaId ?? id));
      if (rutaPropuesta.orden.length !== esperados.size || rutaPropuesta.orden.some((id) => !esperados.has(id))) {
        throw errorRespuestaOptimizador("La ruta propuesta omite o agrega paradas.");
      }
    }

    return {
      rutaActual,
      rutaPropuesta,
      motivoSinRuta: typeof datos.motivo_sin_ruta === "string" ? datos.motivo_sin_ruta : null,
      sustituciones,
      sinSustitucion,
    };
  };
}
