import { diasEntre } from "./fechas";
import type { LugarReal, ViajeIA } from "./tipos";

export const MAX_MINUTOS_POR_DIA = 360;

export const SYSTEM_INSTRUCTION = `Eres el planificador de itinerarios de una guía turística.
Tu única forma de responder es llamando a la función "crear_itinerario".

REGLAS ESTRICTAS (si las incumples, tu respuesta será rechazada):
1. Usa SOLAMENTE lugares de la lista de CANDIDATOS, identificados por su placeId exacto. Está prohibido inventar lugares o placeId.
2. No repitas un lugar en el plan.
3. Respeta el horario de cada lugar: la estancia debe caber entre su apertura y su cierre.

CÓMO ARMAR CADA DÍA:
4. Entre 2 y 4 paradas por día (lo normal son 3). Si el transporte es a pie, máximo 3.
5. Carga razonable: la suma de las estancias de un día no debe pasar de ${MAX_MINUTOS_POR_DIA} minutos (6 horas). Deja tiempo libre para traslados y descansos.
6. Agrupa por cercanía: las paradas de un mismo día deben estar en la misma zona (usa lat y lng) y seguir una ruta lógica, sin ir y volver entre zonas lejanas.
7. Comida: si la lista incluye lugares de gastronomía, reparte las comidas entre los días: una parada de comida por día, hacia el mediodía. Nunca pongas dos el mismo día si otro día se queda sin comida.
8. Prioriza lo que coincide con los intereses del viajero. No tienes que usar todos los candidatos: es mejor un día con menos paradas que rellenarlo con lugares que no encajan.
9. Respeta el presupuesto diario: la suma de precioEstimado de las paradas de un día no debe pasar del presupuesto indicado. Si un precio es null, no cuentes gasto.
10. Si no hay suficientes lugares adecuados para todos los días, usa menos paradas por día; nunca inventes ni repitas lugares para rellenar.
11. En "motivo" escribe una frase concreta sobre por qué ese lugar encaja con este viaje (sus intereses o el tipo de viaje). Evita frases genéricas que valdrían para cualquier lugar.`;

export function construirPrompt(viaje: ViajeIA, candidatos: LugarReal[], erroresPrevios: string[] = []): string {
  const dias = diasEntre(viaje.fechaInicio, viaje.fechaFin);
  const lugares = candidatos.map((c) => ({
    placeId: c.placeId,
    nombre: c.nombre,
    categoria: c.categoria,
    lat: c.lat,
    lng: c.lng,
    horario: c.horario
      ? c.horario.valorOriginal ?? "sin horario verificable"
      : `${c.horaApertura}-${c.horaCierre}`,
    precioEstimado: c.precioEstimado ?? null,
  }));

  const partes = [
    `VIAJE`,
    `- Destino: ${viaje.destino}`,
    `- Tipo de viaje: ${viaje.tipoViaje}`,
    `- Duración: ${dias} día(s), del ${viaje.fechaInicio} al ${viaje.fechaFin}`,
    `- Transporte: ${viaje.transporte}`,
    `- Intereses: ${viaje.intereses.join(", ")}`,
    viaje.presupuestoDiario ? `- Presupuesto diario: Q${viaje.presupuestoDiario}` : `- Presupuesto total: Q${viaje.presupuesto}`,
    viaje.hospedaje && viaje.nombreHotel ? `- Hospedaje: ${viaje.nombreHotel}` : "",
    ``,
    `CANDIDATOS (única fuente permitida, JSON):`,
    JSON.stringify(lugares),
    ``,
    `Genera el itinerario de ${dias} día(s) llamando a crear_itinerario.`,
  ];

  if (erroresPrevios.length > 0) {
    partes.push(
      ``,
      `TU INTENTO ANTERIOR FUE RECHAZADO por estos errores. Corrígelos todos:`,
      ...erroresPrevios.map((e) => `- ${e}`)
    );
  }
  return partes.filter((l) => l !== "").join("\n");
}