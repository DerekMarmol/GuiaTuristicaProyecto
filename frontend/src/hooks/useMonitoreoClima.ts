import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ItinerarioActivo,
  ModoTransporteRuta,
  PropuestaClima,
  ReferenciaClima,
  RespuestaAceptarPropuestaClima,
  RespuestaEvaluacionClima,
  UbicacionCompartida,
} from "../../../shared/types";
import { aceptarPropuestaClima, evaluarClimaReactivo, solicitarPropuestaClima } from "../services/climaReactivo";
import { crearControlSolicitudes, esDiaActivo, firmaItinerario } from "../services/climaReactivoEstado";

export type EstadoMonitoreoClima = "inactivo" | "evaluando" | "en_espera" | "error";
export type EstadoUbicacion = "sin_compartir" | "solicitando" | "compartida" | "no_disponible";

const ESPERA_PREDETERMINADA_S = 12 * 60;

interface Opciones {
  itinerario: ItinerarioActivo | null;
  modoTransporte: ModoTransporteRuta;
  intereses: string[];
}

export function useMonitoreoClima({ itinerario, modoTransporte, intereses }: Opciones) {
  const [estado, setEstado] = useState<EstadoMonitoreoClima>("inactivo");
  const [evaluacion, setEvaluacion] = useState<RespuestaEvaluacionClima | null>(null);
  const [propuesta, setPropuesta] = useState<PropuestaClima | null>(null);
  const [firmaPropuesta, setFirmaPropuesta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proximaRevision, setProximaRevision] = useState<Date | null>(null);
  const [ubicacion, setUbicacion] = useState<UbicacionCompartida | null>(null);
  const [estadoUbicacion, setEstadoUbicacion] = useState<EstadoUbicacion>("sin_compartir");

  const referencias = useRef(new Map<string, ReferenciaClima | null>());
  const control = useRef(crearControlSolicitudes());
  const abortar = useRef<AbortController | null>(null);
  const temporizador = useRef<number | null>(null);
  const intervalo = useRef(ESPERA_PREDETERMINADA_S);
  const datos = useRef({ itinerario, modoTransporte, intereses, ubicacion });
  datos.current = { itinerario, modoTransporte, intereses, ubicacion };

  const diaId = itinerario?.id ?? null;
  const activo = itinerario !== null && esDiaActivo(itinerario, new Date());
  const firmaActual = itinerario ? firmaItinerario(itinerario) : null;

  const detener = useCallback(() => {
    abortar.current?.abort();
    abortar.current = null;
    control.current.invalidar();
    if (temporizador.current !== null) {
      window.clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    setProximaRevision(null);
  }, []);

  const verificar = useCallback(async function verificar() {
    const actual = datos.current;
    if (!actual.itinerario || !esDiaActivo(actual.itinerario, new Date())) return;
    const id = control.current.iniciar();
    if (id === null) return;

    if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    const programar = (segundos: number) => {
      temporizador.current = window.setTimeout(() => void verificar(), segundos * 1000);
      setProximaRevision(new Date(Date.now() + segundos * 1000));
    };
    const controlador = new AbortController();
    abortar.current = controlador;
    const itinerarioEnviado = actual.itinerario;
    const solicitud = {
      itinerario: itinerarioEnviado,
      modoTransporte: actual.modoTransporte,
      intereses: actual.intereses,
      ...(actual.ubicacion ? { ubicacionActual: actual.ubicacion } : {}),
      referencia: referencias.current.get(itinerarioEnviado.id) ?? null,
    };

    setEstado("evaluando");
    setError(null);
    try {
      const respuesta = await evaluarClimaReactivo(solicitud, controlador.signal);
      if (!control.current.esVigente(id)) return;
      referencias.current.set(itinerarioEnviado.id, respuesta.referencia);
      intervalo.current = respuesta.proximaEvaluacionSegundos;
      setEvaluacion(respuesta);
      if (respuesta.requierePropuesta) {
        const conPropuesta = await solicitarPropuestaClima(solicitud, controlador.signal);
        if (!control.current.esVigente(id)) return;
        referencias.current.set(itinerarioEnviado.id, conPropuesta.referencia);
        if (conPropuesta.propuesta) {
          setPropuesta(conPropuesta.propuesta);
          setFirmaPropuesta(firmaItinerario(itinerarioEnviado));
        }
      }
      setEstado(respuesta.estado === "activo" ? "en_espera" : "inactivo");
      if (respuesta.estado === "activo") programar(respuesta.proximaEvaluacionSegundos);
    } catch (err) {
      if (controlador.signal.aborted || !control.current.esVigente(id)) return;
      setError(err instanceof Error ? err.message : "No se pudo revisar el clima.");
      setEstado("error");
      programar(intervalo.current);
    } finally {
      control.current.terminar(id);
    }
  }, []);

  useEffect(() => {
    setPropuesta(null);
    setFirmaPropuesta(null);
    setEvaluacion(null);
    setError(null);
    if (!activo) {
      setEstado("inactivo");
      return;
    }
    void verificar();
    return detener;
  }, [diaId, activo, verificar, detener]);

  const compartirUbicacion = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setEstadoUbicacion("no_disponible");
      return;
    }
    setEstadoUbicacion("solicitando");
    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        setUbicacion({ lat: posicion.coords.latitude, lng: posicion.coords.longitude, registradaEn: new Date(posicion.timestamp).toISOString() });
        setEstadoUbicacion("compartida");
      },
      () => setEstadoUbicacion("no_disponible"),
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 15_000 },
    );
  }, []);

  const dejarDeCompartir = useCallback(() => {
    setUbicacion(null);
    setEstadoUbicacion("sin_compartir");
  }, []);

  const descartarPropuesta = useCallback(() => {
    setPropuesta(null);
    setFirmaPropuesta(null);
  }, []);

  const aceptarPropuesta = useCallback(async (): Promise<{ respuesta: RespuestaAceptarPropuestaClima; firmaEnviada: string }> => {
    const actual = datos.current.itinerario;
    if (!propuesta?.token || !actual) {
      throw new Error("No hay una propuesta que se pueda aplicar.");
    }
    const respuesta = await aceptarPropuestaClima(propuesta.token, actual);
    return { respuesta, firmaEnviada: firmaItinerario(actual) };
  }, [propuesta]);

  return {
    activo,
    estado,
    evaluacion,
    propuesta,
    propuestaObsoleta: propuesta !== null && firmaPropuesta !== firmaActual,
    error,
    proximaRevision,
    estadoUbicacion,
    verificar,
    compartirUbicacion,
    dejarDeCompartir,
    descartarPropuesta,
    aceptarPropuesta,
  };
}
