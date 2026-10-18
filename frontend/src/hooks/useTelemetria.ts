import { useCallback, useEffect, useRef, useState } from "react";

type EstadoTelemetria =
  | "inactivo"
  | "solicitando"
  | "activo"
  | "error";

export function useTelemetria() {
  const [estado, setEstado] = useState<EstadoTelemetria>("inactivo");
  const [velocidadKmh, setVelocidadKmh] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);

  const detener = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setEstado("inactivo");
    setVelocidadKmh(null);
    setError(null);
  }, []);

  const iniciar = useCallback(() => {
    if (watchIdRef.current !== null) return;

    if (
      typeof navigator === "undefined" ||
      !("geolocation" in navigator)
    ) {
      setEstado("error");
      setError("Este navegador no admite geolocalización.");
      return;
    }

    setEstado("solicitando");
    setVelocidadKmh(null);
    setError(null);

    const watchId = navigator.geolocation.watchPosition(
      (posicion) => {
        const velocidad = posicion.coords.speed;

        setVelocidadKmh(
          velocidad === null || !Number.isFinite(velocidad)
            ? null
            : Math.max(0, velocidad * 3.6)
        );

        setEstado("activo");
        setError(null);
      },
      (fallo) => {
        const mensajes: Record<number, string> = {
          1: "Se denegó el permiso de ubicación.",
          2: "No se pudo obtener la ubicación.",
          3: "Se agotó el tiempo de espera del GPS.",
        };

        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }

        setError(
          mensajes[fallo.code] ?? "Ocurrió un error de geolocalización."
        );
        setEstado("error");
        setVelocidadKmh(null);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000,
      }
    );

    watchIdRef.current = watchId;
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return {
    estado,
    velocidadKmh,
    error,
    iniciar,
    detener,
  };
}
