import { ErrorApi } from "../errores";
import type { FuncionFetch } from "../tipos";
import { transformarLugares, type Lugar } from "./transformar";

export const URL_PLACES = "https://api.geoapify.com/v2/places";
const TIEMPO_ESPERA_MS = 10000;

export interface ConsultaBusqueda {
  lat: number;
  lng: number;
  categorias: string[];
  radio: number;
  limite: number;
}

export type BuscarLugares = (consulta: ConsultaBusqueda) => Promise<Lugar[]>;

export type ConsultarPlaces = (consulta: ConsultaBusqueda) => Promise<unknown>;

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
      "El servicio de lugares no está configurado correctamente. Contacta al administrador del sistema.",
    );
  }
  if (estado === 429) {
    return new ErrorApi(
      503,
      "PROVEEDOR_LIMITE_SOLICITUDES",
      "Se alcanzó el límite de solicitudes del proveedor de lugares. Intenta de nuevo más tarde.",
    );
  }
  return new ErrorApi(502, "PROVEEDOR_ERROR", "El proveedor de lugares respondió con un error.");
}

function errorTiempoAgotado(): ErrorApi {
  return new ErrorApi(504, "PROVEEDOR_TIEMPO_AGOTADO", "El proveedor de lugares tardó demasiado en responder.");
}

export function crearConsultaPlaces({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
  tiempoEsperaMs = TIEMPO_ESPERA_MS,
}: OpcionesCliente = {}): ConsultarPlaces {
  const clave = typeof apiKey === "string" ? apiKey.trim() : "";

  return async function consultarPlaces({ lat, lng, categorias, radio, limite }) {
    if (!clave) {
      throw new ErrorApi(500, "SERVICIO_NO_CONFIGURADO", "El servicio de lugares no está configurado.");
    }

    const longitud = formatearCoordenada(lng);
    const latitud = formatearCoordenada(lat);
    const url = new URL(URL_PLACES);
    url.search = new URLSearchParams({
      categories: categorias.join(","),
      filter: `circle:${longitud},${latitud},${radio}`,
      bias: `proximity:${longitud},${latitud}`,
      limit: String(limite),
      lang: "es",
      apiKey: clave,
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
        throw new ErrorApi(502, "PROVEEDOR_NO_DISPONIBLE", "No fue posible conectar con el proveedor de lugares.");
      }

      if (!respuesta.ok) {
        respuesta.body?.cancel().catch(() => {});
        throw errorPorEstado(respuesta.status);
      }

      try {
        return (await respuesta.json()) as unknown;
      } catch {
        if (controlador.signal.aborted) {
          throw errorTiempoAgotado();
        }
        throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de lugares devolvió una respuesta que no es JSON válido.");
      }
    } finally {
      clearTimeout(temporizador);
    }
  };
}

export function crearClienteGeoapify(opciones: OpcionesCliente = {}): BuscarLugares {
  const consultarPlaces = crearConsultaPlaces(opciones);

  return async function buscarLugares(consulta) {
    return transformarLugares(await consultarPlaces(consulta)).slice(0, consulta.limite);
  };
}
