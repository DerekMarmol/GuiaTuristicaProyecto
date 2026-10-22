import { fechaDeMomento, momentoEnZona } from "../ai/zonaHoraria";
import type { ConsultarClima } from "../clima/servicio";
import { distanciaMetros, type Coordenada } from "../hoteles/geografia";

// GUI-112: el momento en que se genera el itinerario. Un plan para hoy no puede empezar a las 09:00 si ya
// son las 2 p. m., ni la primera parada puede quedar en otro municipio si el viajero está en el destino.

// Tiempo para alistarse antes de la primera visita cuando el viaje empieza hoy.
const MARGEN_PARA_SALIR_MIN = 15;
const PASO_MIN = 15;
// Más lejos que esto, el viajero está planeando desde casa: su ubicación no sirve de punto de partida.
export const DISTANCIA_MAXIMA_ORIGEN_METROS = 50_000;
// Lluvia del día a partir de la cual se prefieren lugares bajo techo (llovizna aislada no cambia el plan).
export const LLUVIA_PARA_PRIORIZAR_INTERIORES_MM = 5;

// Hora local (HH:MM) desde la que puede empezar el primer día, o null si el viaje no empieza hoy.
export function horaDeArranqueHoy(fechaInicio: string, zonaHoraria: string, ahora: Date): string | null {
  const momento = momentoEnZona(ahora.getTime(), zonaHoraria);
  if (fechaDeMomento(momento) !== fechaInicio) {
    return null;
  }
  const minutos = Math.ceil((momento.hora * 60 + momento.minuto + MARGEN_PARA_SALIR_MIN) / PASO_MIN) * PASO_MIN;
  const acotados = Math.min(minutos, 23 * 60 + 45);
  return `${String(Math.floor(acotados / 60)).padStart(2, "0")}:${String(acotados % 60).padStart(2, "0")}`;
}

export function origenCercano(origen: Coordenada | undefined, destino: Coordenada): Coordenada | undefined {
  return origen && distanciaMetros(origen, destino) <= DISTANCIA_MAXIMA_ORIGEN_METROS ? origen : undefined;
}

// Días del viaje (1, 2, …) con lluvia significativa según el pronóstico. Si el pronóstico falla o no cubre
// las fechas, el plan se arma sin esta preferencia: el clima no debe impedir generar el itinerario.
export async function diasConLluvia(
  consultarClima: ConsultarClima | undefined,
  destino: Coordenada,
  fechaInicio: string,
  fechaFin: string,
): Promise<{ numeroDia: number; lluviaMm: number }[]> {
  if (!consultarClima) {
    return [];
  }
  try {
    const { dias } = await consultarClima({ lat: destino.lat, lng: destino.lng, fechaInicio, fechaFin });
    return dias.flatMap((dia, indice) =>
      dia.lluviaMm !== null && dia.lluviaMm >= LLUVIA_PARA_PRIORIZAR_INTERIORES_MM
        ? [{ numeroDia: indice + 1, lluviaMm: Math.round(dia.lluviaMm * 10) / 10 }]
        : [],
    );
  } catch {
    return [];
  }
}
