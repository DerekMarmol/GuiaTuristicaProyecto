interface Punto {
  lat: number;
  lng: number;
}

// Distancia en kilómetros entre dos puntos (fórmula de Haversine).
export function distanciaKm(a: Punto, b: Punto): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Punto medio de un grupo de lugares.
export function centroide(puntos: Punto[]): Punto {
  const n = puntos.length || 1;
  return {
    lat: puntos.reduce((s, p) => s + p.lat, 0) / n,
    lng: puntos.reduce((s, p) => s + p.lng, 0) / n,
  };
}