import { ErrorApi } from "../errores";
import type { FuncionFetch } from "../tipos";
import { interpretarClimaActual, interpretarPronostico, type ClimaActual, type Pronostico } from "./transformar";
import { cacheService } from "../lib/redis";

export const URL_PRONOSTICO = "https://api.openweathermap.org/data/2.5/forecast";
export const URL_CLIMA_ACTUAL = "https://api.openweathermap.org/data/2.5/weather";
export const TIEMPO_ESPERA_MS = 10000;
export const TTL_CLIMA_SEGUNDOS = 1800;

type Ubicacion = { lat: number; lng: number };

export type ObtenerPronostico = (ubicacion: Ubicacion) => Promise<Pronostico>;

export type ObtenerClimaActual = (ubicacion: Ubicacion) => Promise<ClimaActual>;

interface OpcionesCliente {
  apiKey?: string;
  fetch?: FuncionFetch;
  tiempoEsperaMs?: number;
}

function formatearCoordenada(valor: number): string {
  return valor.toFixed(7).replace(/\.?0+$/, "");
}

function errorPorEstado(estado: number): ErrorApi {
  if (estado === 401 || estado === 403) {
    return new ErrorApi(
      502,
      "PROVEEDOR_CREDENCIALES_INVALIDAS",
      "El servicio de clima no está configurado correctamente. Contacta al administrador del sistema.",
    );
  }
  if (estado === 429) {
    return new ErrorApi(
      503,
      "PROVEEDOR_LIMITE_SOLICITUDES",
      "Se alcanzó el límite de solicitudes del proveedor de clima. Intenta de nuevo más tarde.",
    );
  }
  return new ErrorApi(502, "PROVEEDOR_ERROR", "El proveedor de clima respondió con un error.");
}

function errorTiempoAgotado(): ErrorApi {
  return new ErrorApi(504, "PROVEEDOR_TIEMPO_AGOTADO", "El proveedor de clima tardó demasiado en responder.");
}

function crearSolicitud({ apiKey, fetch: fetchImpl = globalThis.fetch, tiempoEsperaMs = TIEMPO_ESPERA_MS }: OpcionesCliente) {
  const clave = typeof apiKey === "string" ? apiKey.trim() : "";

  return async function solicitar(direccion: string, { lat, lng }: Ubicacion): Promise<unknown> {
    if (!clave) {
      throw new ErrorApi(503, "SERVICIO_NO_CONFIGURADO", "El servicio de clima no está configurado.");
    }

    const tipo = direccion.includes("forecast") ? "pronostico" : "actual";
    const claveCache = `cache:openweather:${tipo}:${lat.toFixed(2)}:${lng.toFixed(2)}`;

    try {
      const datosEnCache = await cacheService.get(claveCache);
      if (datosEnCache) {
        return datosEnCache;
      }
    } catch {
      // Si la caché no está disponible, continúa a la API sin interrumpir la operación
    }

    const url = new URL(direccion);
    url.search = new URLSearchParams({
      lat: formatearCoordenada(lat),
      lon: formatearCoordenada(lng),
      appid: clave,
      units: "metric",
      lang: "es",
    }).toString();

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), tiempoEsperaMs);

    try {
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: controlador.signal,
        });
      } catch {
        if (controlador.signal.aborted) {
          throw errorTiempoAgotado();
        }
        throw new ErrorApi(502, "PROVEEDOR_NO_DISPONIBLE", "No fue posible conectar con el proveedor de clima.");
      }

      if (!respuesta.ok) {
        respuesta.body?.cancel().catch(() => {});
        throw errorPorEstado(respuesta.status);
      }
      
      let datos: unknown;
      try {
        datos = (await respuesta.json()) as unknown;
      } catch {
        if (controlador.signal.aborted) {
          throw errorTiempoAgotado();
        }
        throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de clima devolvió una respuesta que no es JSON válido.");
      }
      try {
        await cacheService.set(claveCache, datos, TTL_CLIMA_SEGUNDOS);
      } catch {
        // Si la caché no está disponible, no se interrumpe la operación
      }   
      return datos;
    } finally {
      clearTimeout(temporizador);
    }
  };
}

export function crearClienteOpenWeather(opciones: OpcionesCliente = {}): ObtenerPronostico {
  const solicitar = crearSolicitud(opciones);
  return async function obtenerPronostico(ubicacion) {
    return interpretarPronostico(await solicitar(URL_PRONOSTICO, ubicacion));
  };
}

export function crearClienteClimaActual(opciones: OpcionesCliente = {}): ObtenerClimaActual {
  const solicitar = crearSolicitud(opciones);
  return async function obtenerClimaActual(ubicacion) {
    return interpretarClimaActual(await solicitar(URL_CLIMA_ACTUAL, ubicacion));
  };
}
