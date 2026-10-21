import { useCallback, useEffect, useRef, useState } from "react";
import { obtenerUbicacionActual } from "../services/ubicacionActual";
import {
  calcularTrasladoInicio,
  distanciaKm,
  DISTANCIA_MAXIMA_PARTIDA_KM,
  type Coordenada,
  type PuntoPartida,
  type TrasladoInicio,
} from "../services/puntoPartida";

export type EstadoUbicacionPartida = "inactivo" | "solicitando" | "lista" | "error";

// GUI-107: desde dónde sale el usuario. Al iniciar el viaje pide la ubicación una vez; si no hay permiso
// (o el usuario prefiere otro punto, como su hotel) puede elegirlo tocando el mapa.
export function usePuntoPartida(primeraParada: Coordenada | null, activo: boolean) {
  const [punto, setPunto] = useState<PuntoPartida | null>(null);
  const [estado, setEstado] = useState<EstadoUbicacionPartida>("inactivo");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [traslado, setTraslado] = useState<TrasladoInicio | null>(null);
  const pedidoInicial = useRef(false);

  const usarUbicacion = useCallback(async () => {
    setEstado("solicitando");
    setMensaje(null);
    setEligiendo(false);
    try {
      const ubicacion = await obtenerUbicacionActual();
      setPunto({ lat: ubicacion.lat, lng: ubicacion.lng, fuente: "ubicacion", precisionMetros: ubicacion.precisionMetros });
      setEstado("lista");
    } catch (error) {
      setEstado("error");
      setMensaje(error instanceof Error ? error.message : "No se pudo obtener tu ubicación.");
    }
  }, []);

  useEffect(() => {
    if (activo && !pedidoInicial.current) {
      pedidoInicial.current = true;
      void usarUbicacion();
    }
  }, [activo, usarUbicacion]);

  const elegirEnMapa = useCallback((coordenada: Coordenada) => {
    setPunto({ lat: coordenada.lat, lng: coordenada.lng, fuente: "mapa" });
    setEstado("lista");
    setMensaje(null);
    setEligiendo(false);
  }, []);

  const distancia = punto && primeraParada ? distanciaKm(punto, primeraParada) : null;
  const lejos = distancia !== null && distancia > DISTANCIA_MAXIMA_PARTIDA_KM;

  useEffect(() => {
    setTraslado(null);
    if (!punto || !primeraParada || lejos) return;
    const controlador = new AbortController();
    calcularTrasladoInicio(punto, primeraParada, controlador.signal).then(
      (resultado) => {
        if (!controlador.signal.aborted) setTraslado(resultado);
      },
      (error) => {
        if (!controlador.signal.aborted) setMensaje(error instanceof Error ? error.message : "No se pudo calcular el traslado.");
      }
    );
    return () => controlador.abort();
  }, [punto?.lat, punto?.lng, primeraParada?.lat, primeraParada?.lng, lejos]);

  return {
    punto,
    // Solo cuenta como punto de partida si está cerca del recorrido del día.
    puntoUtil: punto && !lejos ? punto : null,
    estado,
    mensaje,
    eligiendo,
    setEligiendo,
    usarUbicacion,
    elegirEnMapa,
    traslado,
    distanciaKm: distancia,
    lejos,
  };
}
