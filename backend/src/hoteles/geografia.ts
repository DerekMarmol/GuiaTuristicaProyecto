export interface Coordenada {
  lat: number;
  lng: number;
}

export const RADIO_TIERRA_METROS = 6_371_000;
const NORMA_MINIMA = 1e-9;

const aRadianes = (grados: number) => (grados * Math.PI) / 180;
const aGrados = (radianes: number) => (radianes * 180) / Math.PI;

export function calcularCentro(puntos: readonly Coordenada[]): Coordenada | null {
  if (puntos.length === 0) {
    return null;
  }

  let x = 0;
  let y = 0;
  let z = 0;
  for (const { lat, lng } of puntos) {
    const latitud = aRadianes(lat);
    const longitud = aRadianes(lng);
    x += Math.cos(latitud) * Math.cos(longitud);
    y += Math.cos(latitud) * Math.sin(longitud);
    z += Math.sin(latitud);
  }
  x /= puntos.length;
  y /= puntos.length;
  z /= puntos.length;

  const proyeccion = Math.hypot(x, y);
  if (Math.hypot(proyeccion, z) < NORMA_MINIMA) {
    return null;
  }

  const lng = proyeccion < NORMA_MINIMA ? 0 : aGrados(Math.atan2(y, x));
  return { lat: aGrados(Math.atan2(z, proyeccion)), lng: lng === -180 ? 180 : lng };
}

export function distanciaMetros(origen: Coordenada, destino: Coordenada): number {
  const dLat = aRadianes(destino.lat - origen.lat);
  const dLng = aRadianes(destino.lng - origen.lng);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(aRadianes(origen.lat)) * Math.cos(aRadianes(destino.lat)) * Math.sin(dLng / 2) ** 2;
  return RADIO_TIERRA_METROS * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
