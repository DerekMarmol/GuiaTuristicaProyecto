import type { TrasladoParada } from "./itinerario";

export interface Coordenada {
  lat: number;
  lng: number;
}

export interface PuntoPartida extends Coordenada {
  // "ubicacion": la del dispositivo; "mapa": un punto que el usuario tocó en el mapa (su hotel, por ejemplo).
  fuente: "ubicacion" | "mapa";
  precisionMetros?: number | null;
}

export type TrasladoInicio = TrasladoParada & { distanciaKm: number };

// Más lejos que esto, la ubicación no es un punto de partida útil: el usuario está planeando desde casa.
export const DISTANCIA_MAXIMA_PARTIDA_KM = 50;

export function distanciaKm(a: Coordenada, b: Coordenada): number {
  const rad = (grados: number) => (grados * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function etiquetaPartida(punto: PuntoPartida): string {
  return punto.fuente === "ubicacion" ? "Tú estás aquí" : "Tu punto de partida";
}

// Hora a la que conviene salir para llegar a la primera parada a su hora programada ("09:00" - 21 min).
export function horaDeSalida(llegada: string, minutosTraslado: number): string {
  const [h, m] = llegada.split(":").map(Number);
  const total = (((h * 60 + m - minutosTraslado) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// "13:50" + 25 min -> "14:15"
export function sumarMinutos(hora: string, minutos: number): string {
  return horaDeSalida(hora, -minutos);
}

export async function calcularTrasladoInicio(
  origen: Coordenada,
  destino: Coordenada,
  signal?: AbortSignal
): Promise<TrasladoInicio> {
  let respuesta: Response;
  try {
    respuesta = await fetch("/api/itinerarios/traslado", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origen: { lat: origen.lat, lng: origen.lng }, destino: { lat: destino.lat, lng: destino.lng } }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("No se pudo conectar con el servidor para calcular el traslado.");
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !datos?.traslado) {
    throw new Error(datos?.error?.mensaje ?? "No se pudo calcular el traslado desde tu punto de partida.");
  }
  return datos.traslado as TrasladoInicio;
}
