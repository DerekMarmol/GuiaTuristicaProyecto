import type { HorarioLugar } from "../../../shared/types";
import { evaluarApertura, type MotivoAperturaDesconocida } from "../geoapify/horario";
import type { LugarReal, MotivoDescarte, TrasladoEstimado } from "./tipos";
import { calcularTiempoTotalTraslado } from "./tiempoService";
import { horaDesdeMinutos, minutosDesdeHora, validarEstancia, type IntervaloHorario } from "./validacionEstancia";
import {
  fechaDeMomento,
  formatearInstante,
  momentoDesdeFechaHora,
  momentoEnZona,
  resolverMomento,
} from "./zonaHoraria";

export const VELOCIDAD_PROMEDIO_KMH = 40;
export const UMBRAL_TRASLADO_A_PIE_MINUTOS = 12;

const MS_POR_MINUTO = 60_000;
const RADIO_TIERRA_KM = 6371;
const ULTIMO_MINUTO_DEL_DIA = 23 * 60 + 59;

const MOTIVO_POR_APERTURA_DESCONOCIDA: Record<MotivoAperturaDesconocida, MotivoDescarte> = {
  no_publicado: "horario_no_publicado",
  no_interpretable: "horario_no_interpretable",
  error_consulta: "error_consulta",
  estado_desconocido: "apertura_desconocida",
};

export type EstimadorTraslado = (origen: LugarReal, destino: LugarReal) => TrasladoEstimado;

export type VisitaEvaluada =
  | {
      aceptada: true;
      estado: "completa" | "ajustada";
      duracionMinutos: number;
      llegada: string;
      salida: string;
      traslado: TrasladoEstimado | null;
    }
  | {
      aceptada: false;
      motivo: MotivoDescarte;
      llegada: string;
      traslado: TrasladoEstimado | null;
    };

export interface PlanificadorDia {
  evaluar(lugar: LugarReal, duracionSolicitada: number): VisitaEvaluada;
}

type Disponibilidad = { abierto: true; minutosDisponibles: number } | { abierto: false; motivo: MotivoDescarte };

function distanciaKm(origen: LugarReal, destino: LugarReal): number {
  const radianes = (grados: number) => (grados * Math.PI) / 180;
  const dLat = radianes(destino.lat - origen.lat);
  const dLng = radianes(destino.lng - origen.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radianes(origen.lat)) * Math.cos(radianes(destino.lat)) * Math.sin(dLng / 2) ** 2;
  return RADIO_TIERRA_KM * 2 * Math.asin(Math.sqrt(a));
}

export function estimarTraslado(origen: LugarReal, destino: LugarReal): TrasladoEstimado {
  const km = distanciaKm(origen, destino);
  const tiempoBase = Math.floor((km / VELOCIDAD_PROMEDIO_KMH) * 60);
  const tipo = tiempoBase < UMBRAL_TRASLADO_A_PIE_MINUTOS ? "pie" : "vehiculo";
  return {
    ...calcularTiempoTotalTraslado(tiempoBase, tipo),
    estimado: true,
    metodo: "distancia_lineal",
    distanciaKm: Math.round(km * 100) / 100,
    velocidadKmh: VELOCIDAD_PROMEDIO_KMH,
  };
}

function disponibilidadReal(horario: HorarioLugar, llegada: number, zona: string): Disponibilidad {
  const evaluacion = evaluarApertura(horario, momentoEnZona(llegada, zona));
  if (evaluacion.estado === "desconocido") {
    return { abierto: false, motivo: MOTIVO_POR_APERTURA_DESCONOCIDA[evaluacion.motivo] };
  }
  if (evaluacion.estado === "cerrado") {
    return { abierto: false, motivo: "cerrado" };
  }
  if (!evaluacion.cierre) {
    return { abierto: true, minutosDisponibles: Number.POSITIVE_INFINITY };
  }
  const cierre = resolverMomento(evaluacion.cierre, zona).instante;
  return { abierto: true, minutosDisponibles: Math.floor((cierre - llegada) / MS_POR_MINUTO) };
}

function disponibilidadNominal(intervalos: IntervaloHorario[], llegada: number, fecha: string, zona: string): Disponibilidad {
  const momento = momentoEnZona(llegada, zona);
  if (fechaDeMomento(momento) !== fecha) {
    return { abierto: false, motivo: "cerrado" };
  }
  const minuto = momento.hora * 60 + momento.minuto;
  const intervalo = intervalos.find(
    ({ inicio, fin }) => minutosDesdeHora(inicio) <= minuto && minuto < minutosDesdeHora(fin)
  );
  if (!intervalo) {
    return { abierto: false, motivo: "cerrado" };
  }
  return { abierto: true, minutosDisponibles: minutosDesdeHora(intervalo.fin) - minuto };
}

function disponibilidad(lugar: LugarReal, llegada: number, fecha: string, zona: string): Disponibilidad {
  if (lugar.horario !== undefined) {
    return disponibilidadReal(lugar.horario, llegada, zona);
  }
  if (lugar.intervalosHorario !== undefined) {
    return disponibilidadNominal(lugar.intervalosHorario, llegada, fecha, zona);
  }
  if (lugar.horaApertura !== undefined && lugar.horaCierre !== undefined) {
    return disponibilidadNominal([{ inicio: lugar.horaApertura, fin: lugar.horaCierre }], llegada, fecha, zona);
  }
  return { abierto: false, motivo: "horario_no_publicado" };
}

export function crearPlanificadorDia({
  fecha,
  horaInicio,
  zonaHoraria,
  estimar = estimarTraslado,
}: {
  fecha: string;
  horaInicio: string;
  zonaHoraria: string;
  estimar?: EstimadorTraslado;
}): PlanificadorDia | null {
  const inicio = resolverMomento(momentoDesdeFechaHora(fecha, horaInicio), zonaHoraria);
  if (!inicio.existe) {
    return null;
  }

  let anterior: { lugar: LugarReal; salida: number } | null = null;

  return {
    evaluar(lugar, duracionSolicitada) {
      const traslado = anterior ? estimar(anterior.lugar, lugar) : null;
      const llegada = anterior && traslado
        ? anterior.salida + traslado.tiempoTotalConHolgura * MS_POR_MINUTO
        : inicio.instante;
      const llegadaTexto = formatearInstante(llegada, zonaHoraria);

      const apertura = disponibilidad(lugar, llegada, fecha, zonaHoraria);
      if (!apertura.abierto) {
        return { aceptada: false, motivo: apertura.motivo, llegada: llegadaTexto, traslado };
      }

      const minutosDisponibles = Math.min(apertura.minutosDisponibles, ULTIMO_MINUTO_DEL_DIA);
      const estancia = validarEstancia({
        llegada: "00:00",
        duracionSolicitada,
        intervalos: minutosDisponibles > 0 ? [{ inicio: "00:00", fin: horaDesdeMinutos(minutosDisponibles) }] : [],
      });
      if (estancia.estado === "descartada") {
        return { aceptada: false, motivo: "tiempo_insuficiente", llegada: llegadaTexto, traslado };
      }

      const salida = llegada + estancia.duracionMinutos * MS_POR_MINUTO;
      anterior = { lugar, salida };
      return {
        aceptada: true,
        estado: estancia.estado,
        duracionMinutos: estancia.duracionMinutos,
        llegada: llegadaTexto,
        salida: formatearInstante(salida, zonaHoraria),
        traslado,
      };
    },
  };
}
