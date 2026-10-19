import type { ModoTransporteRuta, Parada, Viaje } from "../../../shared/types";

export type TipoEventoRuta = "clima" | "retraso" | "parada_cancelada";

// Valhalla solo calcula traslados en automóvil o a pie; los demás medios viajan por carretera.
export function modoTransporteRuta(transporte: Viaje["transporte"] | undefined): ModoTransporteRuta {
  return transporte === "A pie" ? "pedestrian" : "auto";
}

export async function reoptimizarRuta({
  tipo,
  paradas,
  paradaCanceladaId,
  probabilidadLluvia,
  modoTransporte,
}: {
  tipo: TipoEventoRuta;
  paradas: Parada[];
  paradaCanceladaId?: string;
  probabilidadLluvia?: number;
  modoTransporte?: ModoTransporteRuta;
}): Promise<Parada[]> {
  const hora = new Date();
  const respuesta = await fetch("/api/itinerarios/reoptimizar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tipo,
      paradas,
      paradaCanceladaId,
      probabilidadLluvia,
      modoTransporte,
      horaActualMinutos: hora.getHours() * 60 + hora.getMinutes(),
    }),
  });
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error(cuerpo?.error?.mensaje ?? "No se pudo actualizar la ruta.");
  }
  if (!Array.isArray(cuerpo?.paradas)) {
    throw new Error("El optimizador devolvió una ruta inválida.");
  }
  return cuerpo.paradas as Parada[];
}
