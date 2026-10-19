import { ErrorApi } from "../errores";

export const URL_OPTIMIZADOR_PREDETERMINADA = "http://localhost:8000";
export const TIEMPO_ESPERA_OPTIMIZADOR_MS = 10_000;

export interface OpcionesOptimizador {
  url?: string;
  fetchImpl?: typeof fetch;
  tiempoEsperaMs?: number;
}

export type LlamarOptimizador = (ruta: string, cuerpo: unknown) => Promise<unknown>;

export function errorRespuestaOptimizador(mensaje = "El optimizador devolvió una respuesta inválida."): ErrorApi {
  return new ErrorApi(502, "RESPUESTA_OPTIMIZADOR_INVALIDA", mensaje);
}

export function crearClienteOptimizador({
  url = process.env.OPTIMIZER_URL ?? URL_OPTIMIZADOR_PREDETERMINADA,
  fetchImpl = fetch,
  tiempoEsperaMs = TIEMPO_ESPERA_OPTIMIZADOR_MS,
}: OpcionesOptimizador = {}): LlamarOptimizador {
  return async function llamarOptimizador(ruta, cuerpo) {
    let respuesta: Response;
    try {
      respuesta = await fetchImpl(new URL(ruta, url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(tiempoEsperaMs),
      });
    } catch {
      throw new ErrorApi(502, "OPTIMIZADOR_NO_DISPONIBLE", "No fue posible conectar con el optimizador de rutas.");
    }
    if (respuesta.status === 503) {
      throw new ErrorApi(503, "SERVICIO_RUTAS_NO_DISPONIBLE", "El servicio de cálculo de rutas no está disponible en este momento.");
    }
    if (!respuesta.ok) {
      throw new ErrorApi(
        respuesta.status === 422 ? 409 : 502,
        "REOPTIMIZACION_NO_DISPONIBLE",
        "El optimizador no pudo encontrar una ruta válida para las paradas pendientes.",
      );
    }
    try {
      return (await respuesta.json()) as unknown;
    } catch {
      throw errorRespuestaOptimizador();
    }
  };
}
