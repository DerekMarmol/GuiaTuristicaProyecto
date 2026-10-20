import type { AperturaActual, MotivoAperturaNoVerificable } from "../../../shared/types";
import { esZonaHorariaValida, formatearInstante, momentoEnZona, resolverMomento } from "../ai/zonaHoraria";
import { evaluarApertura, type Horario } from "../geoapify/horario";

function desconocido(motivo: MotivoAperturaNoVerificable): AperturaActual {
  return { estadoApertura: "desconocido", open_now: null, motivo };
}

// opening_hours describe la hora local del establecimiento, así que el instante se traduce a su zona IANA
// antes de evaluarlo; sin zona confiable no se afirma que esté abierto ni cerrado.
export function evaluarAperturaActual(horario: Horario | null | undefined, zonaHoraria: string | null, instante: number): AperturaActual {
  if (!esZonaHorariaValida(zonaHoraria)) {
    if (horario?.estado !== "disponible") {
      return desconocido(horario ? horario.estado : "error_consulta");
    }
    return desconocido("zona_horaria_desconocida");
  }

  const evaluacion = evaluarApertura(horario, momentoEnZona(instante, zonaHoraria));
  if (evaluacion.estado === "desconocido") {
    return desconocido(evaluacion.motivo);
  }
  if (evaluacion.estado === "cerrado") {
    return { estadoApertura: "cerrado", open_now: false };
  }
  const cierreEstimado = evaluacion.cierre ? formatearInstante(resolverMomento(evaluacion.cierre, zonaHoraria).instante, zonaHoraria) : null;
  return { estadoApertura: "abierto", open_now: true, cierreEstimado };
}
