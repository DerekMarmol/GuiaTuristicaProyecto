import { MAX_PARADAS_POR_DIA } from "./schemas";
import { diasEntre } from "./fechas";
import type { LugarReal, ViajeIA } from "./tipos";

export const SYSTEM_INSTRUCTION = `Eres el planificador de itinerarios de una guía turística.
Tu única forma de responder es llamando a la función "crear_itinerario".

REGLAS ESTRICTAS:
1. Usa SOLAMENTE lugares de la lista de CANDIDATOS, identificados por su placeId exacto. Está prohibido inventar lugares o placeId.
2. No repitas un lugar en el plan.
3. Agrupa por cercanía geográfica las paradas de un mismo día, para minimizar traslados.
4. Respeta el horario de cada lugar: la estancia debe caber entre su apertura y su cierre.
5. Prioriza los lugares que coinciden con los intereses del viajero.
6. Entre 2 y ${MAX_PARADAS_POR_DIA} paradas por día (menos si el viaje es lento o el transporte es a pie).
7. Respeta el presupuesto diario: no sumes más gasto estimado del que se indica.
8. Si no hay suficientes lugares adecuados, usa menos paradas; nunca inventes para rellenar.`;

export function construirPrompt(viaje: ViajeIA, candidatos: LugarReal[], erroresPrevios: string[] = []): string {
  const dias = diasEntre(viaje.fechaInicio, viaje.fechaFin);
  const lugares = candidatos.map((c) => ({
    placeId: c.placeId,
    nombre: c.nombre,
    categoria: c.categoria,
    lat: c.lat,
    lng: c.lng,
    horario: `${c.horaApertura}-${c.horaCierre}`,
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
