import { SalidaIASchema, MAX_PARADAS_POR_DIA } from "./schemas";
import { aMinutos, diasEntre, sumarDias } from "./fechas";
import type { ItinerarioIA, LugarReal, ParadaIA, ViajeIA } from "./tipos";
import { validarEstancia } from "./validacionEstancia";

export interface ResultadoValidacion {
  errores: string[];
  advertencias: string[];
  itinerarios: ItinerarioIA[];
  viable: boolean;
}

export function validarSalida(
  raw: unknown,
  candidatos: LugarReal[],
  viaje: ViajeIA
): ResultadoValidacion {
  const errores: string[] = [];
  const advertencias: string[] = [];
  const parsed = SalidaIASchema.safeParse(raw);

  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      errores.push(
        `Formato inválido en "${i.path.join(".")}": ${i.message}`
      );
    }

    return {
      errores,
      advertencias,
      itinerarios: [],
      viable: false,
    };
  }

  const porId = new Map(candidatos.map((c) => [c.placeId, c]));
  const totalDias = diasEntre(viaje.fechaInicio, viaje.fechaFin);

  const usados = new Set<string>();
  const vistos = new Set<number>();
  const itinerarios: ItinerarioIA[] = [];

  for (const dia of parsed.data.dias) {
    if (dia.numeroDia > totalDias) {
      errores.push(
        `El día ${dia.numeroDia} no existe: el viaje solo tiene ${totalDias} día(s).`
      );
      continue;
    }

    if (vistos.has(dia.numeroDia)) {
      errores.push(`El día ${dia.numeroDia} aparece repetido.`);
      continue;
    }

    vistos.add(dia.numeroDia);

    const paradas: ParadaIA[] = [];

    // Hora estimada de inicio del recorrido: 09:00
    let llegadaEstimada = 9 * 60;

    for (const p of dia.paradas) {
      const real = porId.get(p.placeId);

      // Validar que el lugar exista
      if (!real) {
        errores.push(
          `Día ${dia.numeroDia}: el placeId "${p.placeId}" NO existe en la lista de candidatos (inventado).`
        );
        continue;
      }

      // Evitar lugares repetidos
      if (usados.has(p.placeId)) {
        errores.push(
          `Día ${dia.numeroDia}: "${real.nombre}" ya está en otro punto del plan; no repitas lugares.`
        );
        continue;
      }

      // Máximo de paradas permitidas
      if (paradas.length >= MAX_PARADAS_POR_DIA) {
        errores.push(
          `Día ${dia.numeroDia}: máximo ${MAX_PARADAS_POR_DIA} paradas por día.`
        );
        continue;
      }

      let estanciaFinal = p.tiempoEstanciaMinutos;

      // Validar horarios y tiempos mínimos de estancia
      if (real.intervalosHorario !== undefined) {
        const horaLlegada =
          `${String(Math.floor(llegadaEstimada / 60)).padStart(2, "0")}:` +
          `${String(llegadaEstimada % 60).padStart(2, "0")}`;

        const resultado = validarEstancia({
          llegada: horaLlegada,
          duracionSolicitada: estanciaFinal,
          intervalos: real.intervalosHorario,
        });

        if (resultado.estado === "descartada") {
          advertencias.push(
            `Día ${dia.numeroDia}: "${real.nombre}" fue descartado porque no tiene tiempo suficiente para la visita.`
          );
          continue;
        }

        if (resultado.estado === "ajustada") {
          estanciaFinal = resultado.duracionMinutos;

          advertencias.push(
            `Día ${dia.numeroDia}: la estancia en "${real.nombre}" se ajustó a ${estanciaFinal} minutos por su horario de atención.`
          );
        }

        // Si hay que esperar a que abra, actualizar la llegada
        if (resultado.inicio) {
          llegadaEstimada = aMinutos(resultado.inicio);
        }
      } else {
        // Compatibilidad con lugares que solo tienen apertura y cierre
        const ventana =
          aMinutos(real.horaCierre) -
          aMinutos(real.horaApertura);

        if (p.tiempoEstanciaMinutos > ventana) {
          errores.push(
            `Día ${dia.numeroDia}: "${real.nombre}" abre ${real.horaApertura}-${real.horaCierre} (${ventana} min); ` +
            `no cabe una estancia de ${p.tiempoEstanciaMinutos} min.`
          );
          continue;
        }

        llegadaEstimada = Math.max(
          llegadaEstimada,
          aMinutos(real.horaApertura)
        );
      }

      // Calcular llegada estimada a la siguiente parada
      // Se consideran 30 minutos de traslado provisional
      llegadaEstimada += estanciaFinal + 30;

      usados.add(p.placeId);

      paradas.push({
        id: `p${dia.numeroDia}-${paradas.length + 1}`,
        placeId: real.placeId,
        nombre: real.nombre,
        lat: real.lat,
        lng: real.lng,
        horaApertura: real.horaApertura,
        horaCierre: real.horaCierre,
        tiempoEstanciaMinutos: estanciaFinal,
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

  // Comprobar que todos los días tengan paradas válidas
  for (let d = 1; d <= totalDias; d++) {
    if (!itinerarios.some((it) => it.numeroDia === d)) {
      errores.push(
        `Falta el día ${d} (o no quedó ninguna parada válida).`
      );
    }
  }

  itinerarios.sort((a, b) => a.numeroDia - b.numeroDia);

  const viable = Array.from(
    { length: totalDias },
    (_, i) => i + 1
  ).every((d) =>
    itinerarios.some((it) => it.numeroDia === d)
  );

  return {
    errores,
    advertencias,
    itinerarios,
    viable,
  };
}
