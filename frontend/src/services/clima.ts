import type { Itinerario, PronosticoDiario, RespuestaClima } from "../../../shared/types";
import type { ViajeBorrador } from "../context/ViajeContext";

// Lluvia acumulada en el día a partir de la cual se muestra la advertencia.
export const UMBRAL_LLUVIA_MM = 10;

export interface ConsultaPronostico {
  lat: number;
  lng: number;
  fechaInicio: string;
  fechaFin: string;
}

export async function consultarPronostico(
  { lat, lng, fechaInicio, fechaFin }: ConsultaPronostico,
  signal?: AbortSignal
): Promise<RespuestaClima | null> {
  // El backend solo acepta notación decimal simple (sin exponente).
  const parametros = new URLSearchParams({
    lat: lat.toFixed(6),
    lng: lng.toFixed(6),
    fechaInicio,
    fechaFin,
  });

  try {
    const respuesta = await fetch(`/api/clima/pronostico?${parametros.toString()}`, { signal });

    if (!respuesta.ok) {
      return null;
    }

    return (await respuesta.json()) as RespuestaClima;
  } catch (error) {
    if (signal?.aborted) {
      return null;
    }

    console.warn("No se pudo consultar el pronóstico:", error);
    return null;
  }
}

export interface ClimaAhora {
  observadoEn: string;
  temperaturaC: number | null;
  descripcion: string | null;
}

// Clima observado en este momento. Es complementario: si falla, el pronóstico se muestra igual.
export async function consultarClimaActual(
  { lat, lng }: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<ClimaAhora | null> {
  const parametros = new URLSearchParams({ lat: lat.toFixed(6), lng: lng.toFixed(6) });
  try {
    const respuesta = await fetch(`/api/clima/actual?${parametros.toString()}`, { signal });
    if (!respuesta.ok) {
      return null;
    }
    const datos = (await respuesta.json()) as ClimaAhora;
    return datos.temperaturaC === null ? null : datos;
  } catch (error) {
    if (!signal?.aborted) {
      console.warn("No se pudo consultar el clima actual:", error);
    }
    return null;
  }
}

// Usa las coordenadas del destino si existen; si no, el centro de las paradas del itinerario.
export function coordenadasDelViaje(
  viaje: ViajeBorrador,
  itinerarios: Itinerario[]
): { lat: number; lng: number } | null {
  if (Number.isFinite(viaje.lat) && Number.isFinite(viaje.lng)) {
    return { lat: viaje.lat as number, lng: viaje.lng as number };
  }

  const paradas = itinerarios
    .flatMap((it) => it.paradas)
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  if (paradas.length === 0) {
    return null;
  }

  return {
    lat: paradas.reduce((total, p) => total + p.lat, 0) / paradas.length,
    lng: paradas.reduce((total, p) => total + p.lng, 0) / paradas.length,
  };
}

export function hayLluviaSignificativa(dia: PronosticoDiario): boolean {
  return dia.lluviaMm !== null && dia.lluviaMm >= UMBRAL_LLUVIA_MM;
}
