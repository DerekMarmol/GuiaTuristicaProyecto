import { useEffect, useState } from "react";

export interface PosicionEnVivo {
  lat: number;
  lng: number;
  precisionMetros: number | null;
  obtenidaEn: number;
}

const MENSAJES_ERROR: Record<number, string> = {
  1: "No diste permiso para usar tu ubicación.",
  2: "No se pudo obtener tu ubicación.",
  3: "Tu ubicación tarda en llegar.",
};

// GUI-115: posición del dispositivo actualizada en tiempo real mientras `activo` (por ejemplo, con el mapa
// abierto). Al desactivarse deja de escuchar al GPS para no gastar batería, pero conserva la última posición.
export function useUbicacionEnVivo(activo: boolean) {
  const [posicion, setPosicion] = useState<PosicionEnVivo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activo) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setError("Este navegador no permite obtener la ubicación.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return;
        setPosicion({
          lat: coords.latitude,
          lng: coords.longitude,
          precisionMetros: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
          obtenidaEn: timestamp,
        });
        setError(null);
      },
      (fallo) => setError(MENSAJES_ERROR[fallo.code] ?? "No se pudo obtener tu ubicación."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [activo]);

  return { posicion, error };
}
