import type { Parada } from "../../../shared/types";

export type TipoEventoRuta = "clima" | "retraso" | "parada_cancelada";

export async function reoptimizarRuta({
  tipo,
  paradas,
  paradaCanceladaId,
  probabilidadLluvia,
}: {
  tipo: TipoEventoRuta;
  paradas: Parada[];
  paradaCanceladaId?: string;
  probabilidadLluvia?: number;
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
