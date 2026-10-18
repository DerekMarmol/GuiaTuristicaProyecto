import type { TipoCambioHoteles } from "../../../shared/types";
import { esObjeto, type FuncionFetch } from "../tipos";
import {
  consultarProveedor,
  errorCredenciales,
  errorLimiteSolicitudes,
  errorNoConfigurado,
  errorProveedor,
  errorRespuestaInvalida,
} from "./http";

export const URL_BASE_EXCHANGERATE = "https://v6.exchangerate-api.com/v6/";
export const TIEMPO_ESPERA_EXCHANGERATE_MS = 10000;
export const MAX_BYTES_EXCHANGERATE = 128 * 1024;
export const ANTIGUEDAD_MAXIMA_TASA_MS = 36 * 60 * 60 * 1000;
export const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;
export const SERVICIO_EXCHANGERATE = "de tipo de cambio (ExchangeRate-API)";

export interface ObtenedorTipoCambio {
  configurado: boolean;
  obtener(): Promise<TipoCambioHoteles>;
}

interface OpcionesTipoCambio {
  apiKey?: string;
  fetch?: FuncionFetch;
  tiempoEsperaMs?: number;
  ahora?: () => Date;
}

interface TasaAlmacenada {
  valor: TipoCambioHoteles;
  expiraEn: number;
}

export function construirUrlExchangeRate(clave: string): URL {
  return new URL(`${URL_BASE_EXCHANGERATE}${encodeURIComponent(clave)}/latest/USD`);
}

function errorPorTipo(tipo: unknown) {
  if (tipo === "invalid-key" || tipo === "inactive-account") {
    return errorCredenciales(SERVICIO_EXCHANGERATE);
  }
  if (tipo === "quota-reached") {
    return errorLimiteSolicitudes(SERVICIO_EXCHANGERATE);
  }
  return errorProveedor(SERVICIO_EXCHANGERATE);
}

function segundosUnix(valor: unknown): number | null {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor > 0 ? valor : null;
}

export function interpretarTipoCambio(datos: unknown, ahora: Date): TasaAlmacenada {
  if (!esObjeto(datos)) {
    throw errorRespuestaInvalida(SERVICIO_EXCHANGERATE);
  }
  if (datos.result === "error") {
    throw errorPorTipo(datos["error-type"]);
  }
  if (datos.result !== "success" || datos.base_code !== "USD" || !esObjeto(datos.conversion_rates)) {
    throw errorRespuestaInvalida(SERVICIO_EXCHANGERATE);
  }
  const tasa = datos.conversion_rates.GTQ;
  if (typeof tasa !== "number" || !Number.isFinite(tasa) || tasa <= 0) {
    throw errorRespuestaInvalida(SERVICIO_EXCHANGERATE, "no devolvió una tasa USD a GTQ válida");
  }

  const ultima = segundosUnix(datos.time_last_update_unix);
  const siguiente = segundosUnix(datos.time_next_update_unix);
  if (ultima === null || siguiente === null || siguiente <= ultima) {
    throw errorRespuestaInvalida(SERVICIO_EXCHANGERATE, "devolvió fechas de actualización incoherentes");
  }
  const actualizadoEn = ultima * 1000;
  const instante = ahora.getTime();
  if (actualizadoEn > instante + TOLERANCIA_RELOJ_MS) {
    throw errorRespuestaInvalida(SERVICIO_EXCHANGERATE, "devolvió fechas de actualización incoherentes");
  }
  const vencimiento = actualizadoEn + ANTIGUEDAD_MAXIMA_TASA_MS;
  if (instante >= vencimiento) {
    throw errorRespuestaInvalida(SERVICIO_EXCHANGERATE, "devolvió una tasa con más de 36 horas de antigüedad");
  }

  return {
    valor: {
      proveedor: "exchangerate-api",
      base: "USD",
      destino: "GTQ",
      tasa,
      actualizadoEn: new Date(actualizadoEn).toISOString(),
      proximaActualizacion: new Date(siguiente * 1000).toISOString(),
      consultadoEn: ahora.toISOString(),
    },
    expiraEn: Math.min(siguiente * 1000, vencimiento),
  };
}

export function crearObtenedorTipoCambio({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
  tiempoEsperaMs = TIEMPO_ESPERA_EXCHANGERATE_MS,
  ahora = () => new Date(),
}: OpcionesTipoCambio = {}): ObtenedorTipoCambio {
  const clave = typeof apiKey === "string" ? apiKey.trim() : "";
  let almacenada: TasaAlmacenada | null = null;
  let enCurso: Promise<TipoCambioHoteles> | null = null;

  async function consultar(): Promise<TipoCambioHoteles> {
    const respuesta = await consultarProveedor({
      fetch: fetchImpl,
      url: construirUrlExchangeRate(clave),
      tiempoEsperaMs,
      maxBytes: MAX_BYTES_EXCHANGERATE,
      servicio: SERVICIO_EXCHANGERATE,
    });
    if (!respuesta.ok) {
      if (esObjeto(respuesta.datos) && respuesta.datos.result === "error") {
        throw errorPorTipo(respuesta.datos["error-type"]);
      }
      if (respuesta.estado === 401 || respuesta.estado === 403) {
        throw errorCredenciales(SERVICIO_EXCHANGERATE);
      }
      if (respuesta.estado === 429) {
        throw errorLimiteSolicitudes(SERVICIO_EXCHANGERATE);
      }
      throw errorProveedor(SERVICIO_EXCHANGERATE);
    }
    if (!respuesta.jsonValido) {
      throw errorRespuestaInvalida(SERVICIO_EXCHANGERATE, "devolvió una respuesta que no es JSON válido");
    }
    const nueva = interpretarTipoCambio(respuesta.datos, ahora());
    almacenada = nueva;
    return nueva.valor;
  }

  return {
    configurado: clave.length > 0,
    obtener() {
      if (!clave) {
        return Promise.reject(errorNoConfigurado(SERVICIO_EXCHANGERATE));
      }
      if (almacenada && ahora().getTime() < almacenada.expiraEn) {
        return Promise.resolve(almacenada.valor);
      }
      almacenada = null;
      if (!enCurso) {
        enCurso = consultar().finally(() => {
          enCurso = null;
        });
      }
      return enCurso;
    },
  };
}
