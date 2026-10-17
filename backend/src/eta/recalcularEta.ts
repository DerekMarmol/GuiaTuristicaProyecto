export interface SolicitudRecalculoEta {
  horaActual: string;
  tiempoTranscurridoMinutos: number;
  tiempoTrasladoPrevistoMinutos: number;
}

export interface ResultadoRecalculoEta {
  etaActualizada: string;
  tiempoRestanteMinutos: number;
  retrasoMinutos: number;
}

export interface TramoItinerario {
  paradaId: string;
  tiempoTrasladoMinutos: number;
  tiempoEstanciaMinutos: number;
}

export interface EtaParada {
  paradaId: string;
  llegadaEstimada: string;
}

export function recalcularEta({
  horaActual,
  tiempoTranscurridoMinutos,
  tiempoTrasladoPrevistoMinutos,
}: SolicitudRecalculoEta): ResultadoRecalculoEta {
  const fechaActual = new Date(horaActual);

  // Validar los datos recibidos.
  if (
    Number.isNaN(fechaActual.getTime()) ||
    !Number.isFinite(tiempoTranscurridoMinutos) ||
    !Number.isFinite(tiempoTrasladoPrevistoMinutos) ||
    tiempoTranscurridoMinutos < 0 ||
    tiempoTrasladoPrevistoMinutos < 0
  ) {
    throw new Error("Datos inválidos para recalcular la ETA.");
  }

  // Calcular el tiempo restante del traslado.
  const tiempoRestanteMinutos = Math.max(
    0,
    tiempoTrasladoPrevistoMinutos - tiempoTranscurridoMinutos
  );

  // Detectar el retraso acumulado.
  const retrasoMinutos = Math.max(
    0,
    tiempoTranscurridoMinutos - tiempoTrasladoPrevistoMinutos
  );

  // Calcular la ETA provisional.
  // Si el tiempo previsto se supera, la ETA queda en la hora actual.
  // Esto no significa que el usuario haya llegado a su destino.
  const etaActualizada = new Date(
    fechaActual.getTime() + tiempoRestanteMinutos * 60_000
  );

  return {
    etaActualizada: etaActualizada.toISOString(),
    tiempoRestanteMinutos,
    retrasoMinutos,
  };
}

export function recalcularEtasItinerario(
  horaSalida: string,
  tramos: TramoItinerario[]
): EtaParada[] {
  const inicio = new Date(horaSalida);

  // Validar la hora inicial.
  if (Number.isNaN(inicio.getTime())) {
    throw new Error("La hora de salida no es válida.");
  }

  let momentoActual = inicio.getTime();

  return tramos.map((tramo, indice) => {
    // Validar los datos de cada tramo.
    if (
      !tramo.paradaId ||
      !Number.isFinite(tramo.tiempoTrasladoMinutos) ||
      tramo.tiempoTrasladoMinutos < 0 ||
      !Number.isFinite(tramo.tiempoEstanciaMinutos) ||
      tramo.tiempoEstanciaMinutos < 0
    ) {
      throw new Error("Datos inválidos en el tramo del itinerario.");
    }

    // Sumar la estancia de la parada anterior.
    if (indice > 0) {
      momentoActual +=
        tramos[indice - 1].tiempoEstanciaMinutos * 60_000;
    }

    // Sumar el traslado hacia la parada actual.
    momentoActual += tramo.tiempoTrasladoMinutos * 60_000;

    // Guardar la hora estimada de llegada.
    return {
      paradaId: tramo.paradaId,
      llegadaEstimada: new Date(momentoActual).toISOString(),
    };
  });
}
