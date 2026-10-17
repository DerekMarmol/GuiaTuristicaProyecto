export interface TramoEta {
  paradaId: string;
  tiempoTrasladoMinutos: number;
  tiempoEstanciaMinutos: number;
}

export interface SolicitudEta {
  horaActual: string;
  tiempoTranscurridoMinutos: number;
  tiempoTrasladoPrevistoMinutos: number;
  tramos: TramoEta[];
}

export interface RespuestaEta {
  etaActualizada: string;
  tiempoRestanteMinutos: number;
  retrasoMinutos: number;
  proximasParadas: {
    paradaId: string;
    llegadaEstimada: string;
  }[];
}

export async function solicitarRecalculoEta(
  datos: SolicitudEta
): Promise<RespuestaEta> {
  const respuesta = await fetch(
    "/api/itinerarios/recalcular-eta",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(datos),
    }
  );

  if (!respuesta.ok) {
    throw new Error("No se pudo recalcular la ETA.");
  }

  return (await respuesta.json()) as RespuestaEta;
}
