export interface IntervaloHorario {
  inicio: string;
  fin: string;
}

export type EstadoEstancia = "completa" | "ajustada" | "descartada";

export interface ResultadoEstancia {
  estado: EstadoEstancia;
  llegada: string;
  inicio?: string;
  fin?: string;
  duracionMinutos: number;
  motivo?: string;
}

const FORMATO_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutosDesdeHora(hora: string): number {
  const match = FORMATO_HORA.exec(hora);

  if (!match) {
    throw new Error(`Hora inválida: ${hora}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function horaDesdeMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;

  return `${String(horas).padStart(2, "0")}:${String(minutosRestantes).padStart(2, "0")}`;
}

/**
 * Valida una visita según la hora de llegada y los intervalos
 * reales de apertura.
 *
 * Si la persona llega durante un receso, espera hasta la
 * siguiente apertura.
 *
 * No permite que una visita atraviese un cierre.
 *
 * Los intervalos deben corresponder al mismo día y no
 * deben cruzar la medianoche.
 */
export function validarEstancia(params: {
  llegada: string;
  duracionSolicitada: number;
  intervalos: IntervaloHorario[];
  estanciaMinima?: number;
}): ResultadoEstancia {
  const {
    llegada,
    duracionSolicitada,
    intervalos,
    estanciaMinima = 15,
  } = params;

  const llegadaMinutos = minutosDesdeHora(llegada);

  if (!Number.isInteger(duracionSolicitada) || duracionSolicitada <= 0) {
    throw new Error("La duración solicitada debe ser un entero positivo.");
  }

  if (!Number.isInteger(estanciaMinima) || estanciaMinima <= 0) {
    throw new Error("La estancia mínima debe ser un entero positivo.");
  }

  const ventanas = intervalos
    .map(({ inicio, fin }) => ({
      inicio: minutosDesdeHora(inicio),
      fin: minutosDesdeHora(fin),
    }))
    .sort((a, b) => a.inicio - b.inicio);

  for (let i = 0; i < ventanas.length; i++) {
    const ventana = ventanas[i];

    if (ventana.fin <= ventana.inicio) {
      throw new Error(
        "Cada intervalo debe terminar después de comenzar."
      );
    }

    if (i > 0 && ventana.inicio < ventanas[i - 1].fin) {
      throw new Error("Los intervalos no deben superponerse.");
    }
  }

  for (const ventana of ventanas) {
    const inicio = Math.max(llegadaMinutos, ventana.inicio);
    const tiempoDisponible = ventana.fin - inicio;

    if (tiempoDisponible < estanciaMinima) {
      continue;
    }

    const duracionFinal = Math.min(
      duracionSolicitada,
      tiempoDisponible
    );

    const estado: EstadoEstancia =
      duracionFinal < duracionSolicitada ? "ajustada" : "completa";

    return {
      estado,
      llegada,
      inicio: horaDesdeMinutos(inicio),
      fin: horaDesdeMinutos(inicio + duracionFinal),
      duracionMinutos: duracionFinal,
      ...(estado === "ajustada"
        ? {
            motivo:
              `La visita se redujo de ${duracionSolicitada} ` +
              `a ${duracionFinal} minutos por el horario del lugar.`,
          }
        : {}),
    };
  }

  return {
    estado: "descartada",
    llegada,
    duracionMinutos: 0,
    motivo:
      `No hay un intervalo abierto con al menos ` +
      `${estanciaMinima} minutos disponibles.`,
  };
}
