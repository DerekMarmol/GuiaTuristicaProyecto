import { useCallback, useEffect, useRef, useState } from "react";
import { crearEstimadorVelocidad, type VelocidadEstimada } from "../utils/velocidadGps";

type EstadoTelemetria =
  | "inactivo"
  | "solicitando"
  | "activo"
  | "error";

export function useTelemetria() {
  const [estado, setEstado] = useState<EstadoTelemetria>("inactivo");
  const [velocidadKmh, setVelocidadKmh] = useState<number | null>(null);
  const [fuenteVelocidad, setFuenteVelocidad] = useState<VelocidadEstimada["fuente"]>(null);
  const estimadorRef = useRef(crearEstimadorVelocidad());
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);

  const detener = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setEstado("inactivo");
    setVelocidadKmh(null);
    setFuenteVelocidad(null);
    setError(null);
    estimadorRef.current.reiniciar();
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
    setFuenteVelocidad(null);
    setError(null);
    estimadorRef.current.reiniciar();

    const watchId = navigator.geolocation.watchPosition(
      (posicion) => {
        // Si el dispositivo no informa coords.speed, se calcula con las posiciones recientes.
        const estimada = estimadorRef.current.agregar({
          lat: posicion.coords.latitude,
          lng: posicion.coords.longitude,
          precisionMetros: Number.isFinite(posicion.coords.accuracy) ? posicion.coords.accuracy : null,
          tiempoMs: posicion.timestamp,
          velocidadMs: posicion.coords.speed,
        });
        setVelocidadKmh(estimada.velocidadKmh === null ? null : Math.max(0, estimada.velocidadKmh));
        setFuenteVelocidad(estimada.fuente);

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
    fuenteVelocidad,
    error,
    iniciar,
    detener,
  };
}
