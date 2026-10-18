import { ErrorApi } from "../errores";
import type { FuncionFetch } from "../tipos";

export interface ConsultaProveedor {
  fetch: FuncionFetch;
  url: URL;
  tiempoEsperaMs: number;
  maxBytes: number;
  servicio: string;
}

export interface RespuestaProveedor {
  estado: number;
  ok: boolean;
  datos: unknown;
  jsonValido: boolean;
}

export function errorTiempoAgotado(servicio: string): ErrorApi {
  return new ErrorApi(504, "PROVEEDOR_TIEMPO_AGOTADO", `El proveedor ${servicio} tardó demasiado en responder.`);
}

export function errorRespuestaInvalida(servicio: string, detalle = "devolvió una respuesta con un formato inesperado"): ErrorApi {
  return new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", `El proveedor ${servicio} ${detalle}.`);
}

export function errorProveedor(servicio: string): ErrorApi {
  return new ErrorApi(502, "PROVEEDOR_ERROR", `El proveedor ${servicio} respondió con un error.`);
}

export function errorCredenciales(servicio: string): ErrorApi {
  return new ErrorApi(
    502,
    "PROVEEDOR_CREDENCIALES_INVALIDAS",
    `El proveedor ${servicio} rechazó las credenciales configuradas en el servidor. No es un problema de la sesión del usuario; contacta al administrador del sistema.`,
  );
}

export function errorLimiteSolicitudes(servicio: string): ErrorApi {
  return new ErrorApi(
    503,
    "PROVEEDOR_LIMITE_SOLICITUDES",
    `Se agotó la cuota o se alcanzó el límite de solicitudes del proveedor ${servicio}. Intenta de nuevo más tarde.`,
  );
}

export function errorNoConfigurado(servicio: string): ErrorApi {
  return new ErrorApi(503, "SERVICIO_NO_CONFIGURADO", `El proveedor ${servicio} no está configurado en el servidor.`);
}

async function leerTexto(respuesta: Response, maxBytes: number, senal: AbortSignal, servicio: string): Promise<string> {
  const longitud = Number(respuesta.headers.get("content-length"));
  if (Number.isFinite(longitud) && longitud > maxBytes) {
    respuesta.body?.cancel().catch(() => {});
    throw errorRespuestaInvalida(servicio, "devolvió una respuesta demasiado grande");
  }
  if (!respuesta.body) {
    return "";
  }

  const lector = respuesta.body.getReader();
  const cancelar = () => {
    lector.cancel().catch(() => {});
  };
  senal.addEventListener("abort", cancelar, { once: true });
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (senal.aborted) {
        throw errorTiempoAgotado(servicio);
      }
      const { done, value } = await lector.read();
      if (senal.aborted) {
        throw errorTiempoAgotado(servicio);
      }
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        cancelar();
        throw errorRespuestaInvalida(servicio, "devolvió una respuesta demasiado grande");
      }
      partes.push(value);
    }
  } catch (error) {
    if (error instanceof ErrorApi) {
      throw error;
    }
    if (senal.aborted) {
      throw errorTiempoAgotado(servicio);
    }
    throw new ErrorApi(502, "PROVEEDOR_NO_DISPONIBLE", `No fue posible leer la respuesta del proveedor ${servicio}.`);
  } finally {
    senal.removeEventListener("abort", cancelar);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(partes));
}

export async function consultarProveedor({ fetch, url, tiempoEsperaMs, maxBytes, servicio }: ConsultaProveedor): Promise<RespuestaProveedor> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tiempoEsperaMs);
  const abortada = new Promise<never>((_, rechazar) => {
    controlador.signal.addEventListener("abort", () => rechazar(controlador.signal.reason), { once: true });
  });
  abortada.catch(() => {});

  try {
    let respuesta: Response;
    try {
      respuesta = await Promise.race([fetch(url, { headers: { Accept: "application/json" }, signal: controlador.signal }), abortada]);
    } catch {
      if (controlador.signal.aborted) {
        throw errorTiempoAgotado(servicio);
      }
      throw new ErrorApi(502, "PROVEEDOR_NO_DISPONIBLE", `No fue posible conectar con el proveedor ${servicio}.`);
    }

    const texto = await leerTexto(respuesta, maxBytes, controlador.signal, servicio);
    try {
      return { estado: respuesta.status, ok: respuesta.ok, datos: JSON.parse(texto) as unknown, jsonValido: true };
    } catch {
      return { estado: respuesta.status, ok: respuesta.ok, datos: undefined, jsonValido: false };
    }
  } finally {
    clearTimeout(temporizador);
  }
}
