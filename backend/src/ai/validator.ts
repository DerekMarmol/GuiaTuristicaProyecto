import { SalidaIASchema, MAX_PARADAS_POR_DIA } from "./schemas";
import { aMinutos, diasEntre, sumarDias } from "./fechas";
import type { ItinerarioIA, LugarReal, ParadaIA, ViajeIA } from "./tipos";

export interface ResultadoValidacion {
  /** Vacío = la respuesta de la IA es 100% válida. */
  errores: string[];
  /** Itinerarios reconstruidos SOLO con paradas válidas y datos reales. */
  itinerarios: ItinerarioIA[];
  /** true si cada día del viaje conserva al menos una parada válida. */
  viable: boolean;
}

/**
 * Validación anti-alucinaciones (RNF).
 * 1) La forma de la respuesta es correcta (Zod).
 * 2) Cada placeId existe en los lugares reales.
 * 3) No se repiten lugares y los días coinciden con el viaje.
 * 4) La estancia cabe en el horario real del lugar.
 * 5) Nombre, coordenadas y horarios se toman de los datos reales, nunca de la IA.
 */
export function validarSalida(raw: unknown, candidatos: LugarReal[], viaje: ViajeIA): ResultadoValidacion {
  const errores: string[] = [];
  const parsed = SalidaIASchema.safeParse(raw);

  if (!parsed.success) {
    for (const i of parsed.error.issues) errores.push(`Formato inválido en "${i.path.join(".")}": ${i.message}`);
    return { errores, itinerarios: [], viable: false };
  }

  const porId = new Map(candidatos.map((c) => [c.placeId, c]));
  const totalDias = diasEntre(viaje.fechaInicio, viaje.fechaFin);
  const usados = new Set<string>();
  const vistos = new Set<number>();
  const itinerarios: ItinerarioIA[] = [];

  for (const dia of parsed.data.dias) {
    if (dia.numeroDia > totalDias) {
      errores.push(`El día ${dia.numeroDia} no existe: el viaje solo tiene ${totalDias} día(s).`);
      continue;
    }
    if (vistos.has(dia.numeroDia)) {
      errores.push(`El día ${dia.numeroDia} aparece repetido.`);
      continue;
    }
    vistos.add(dia.numeroDia);

    const paradas: ParadaIA[] = [];
    for (const p of dia.paradas) {
      const real = porId.get(p.placeId);
      if (!real) {
        errores.push(`Día ${dia.numeroDia}: el placeId "${p.placeId}" NO existe en la lista de candidatos (inventado).`);
        continue;
      }
      if (usados.has(p.placeId)) {
        errores.push(`Día ${dia.numeroDia}: "${real.nombre}" ya está en otro punto del plan; no repitas lugares.`);
        continue;
      }
      const ventana = aMinutos(real.horaCierre) - aMinutos(real.horaApertura);
      if (p.tiempoEstanciaMinutos > ventana) {
        errores.push(
          `Día ${dia.numeroDia}: "${real.nombre}" abre ${real.horaApertura}-${real.horaCierre} (${ventana} min); ` +
            `no cabe una estancia de ${p.tiempoEstanciaMinutos} min.`
        );
        continue;
      }
      if (paradas.length >= MAX_PARADAS_POR_DIA) {
        errores.push(`Día ${dia.numeroDia}: máximo ${MAX_PARADAS_POR_DIA} paradas por día.`);
        continue;
      }
      usados.add(p.placeId);
      paradas.push({
        id: `p${dia.numeroDia}-${paradas.length + 1}`,
        placeId: real.placeId,
        nombre: real.nombre, // ← dato real
        lat: real.lat, // ← dato real
        lng: real.lng, // ← dato real
        horaApertura: real.horaApertura, // ← dato real
        horaCierre: real.horaCierre, // ← dato real
        tiempoEstanciaMinutos: p.tiempoEstanciaMinutos,
        motivo: p.motivo,
      });
    }

    if (paradas.length > 0) {
      itinerarios.push({
        id: `it-${dia.numeroDia}`,
        viajeId: viaje.id,
        numeroDia: dia.numeroDia,
        fecha: sumarDias(viaje.fechaInicio, dia.numeroDia - 1),
        paradas,
      });
    }
  }

  for (let d = 1; d <= totalDias; d++) {
    if (!itinerarios.some((it) => it.numeroDia === d)) errores.push(`Falta el día ${d} (o no quedó ninguna parada válida).`);
  }

  itinerarios.sort((a, b) => a.numeroDia - b.numeroDia);
  const viable = Array.from({ length: totalDias }, (_, i) => i + 1).every((d) => itinerarios.some((it) => it.numeroDia === d));
  return { errores, itinerarios, viable };
}
