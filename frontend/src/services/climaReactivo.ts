import type {
  ItinerarioActivo,
  RespuestaAceptarPropuestaClima,
  RespuestaEvaluacionClima,
  RespuestaPropuestaClima,
  SolicitudClimaReactivo,
} from "../../../shared/types";

const RUTA = "/api/itinerarios/clima-reactivo";

export class ErrorClimaReactivo extends Error {
  codigo: string;
  estado: number;

  constructor(mensaje: string, codigo: string, estado: number) {
    super(mensaje);
    this.name = "ErrorClimaReactivo";
    this.codigo = codigo;
    this.estado = estado;
  }
}

async function enviar<T>(ruta: string, cuerpo: unknown, signal?: AbortSignal): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${RUTA}${ruta}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ErrorClimaReactivo("No se pudo conectar con el servidor para revisar el clima.", "SIN_CONEXION", 0);
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new ErrorClimaReactivo(datos?.error?.mensaje ?? "No se pudo revisar el clima.", datos?.error?.codigo ?? "ERROR", respuesta.status);
  }
  return datos as T;
}

export function evaluarClimaReactivo(solicitud: SolicitudClimaReactivo, signal?: AbortSignal) {
  return enviar<RespuestaEvaluacionClima>("/evaluar", solicitud, signal);
}

export function solicitarPropuestaClima(solicitud: SolicitudClimaReactivo, signal?: AbortSignal) {
  return enviar<RespuestaPropuestaClima>("/propuesta", solicitud, signal);
}

export function aceptarPropuestaClima(token: string, itinerario: ItinerarioActivo, signal?: AbortSignal) {
  return enviar<RespuestaAceptarPropuestaClima>("/aceptar", { token, itinerario }, signal);
}
