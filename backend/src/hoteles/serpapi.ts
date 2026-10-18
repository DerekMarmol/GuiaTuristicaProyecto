import type { ErrorApi } from "../errores";
import { esObjeto, type FuncionFetch } from "../tipos";
import { NINOS_POR_SOLICITUD } from "./estancia";
import {
  consultarProveedor,
  errorCredenciales,
  errorLimiteSolicitudes,
  errorNoConfigurado,
  errorProveedor,
  errorRespuestaInvalida,
} from "./http";
import { seleccionarPrecio, type PrecioReferencialUsd } from "./tarifas";

export const URL_SERPAPI = "https://serpapi.com/search.json";
export const MOTOR_SERPAPI = "google_hotels";
export const MONEDA_SERPAPI = "USD";
export const IDIOMA_SERPAPI = "es";
export const TIEMPO_ESPERA_SERPAPI_MS = 20000;
export const MAX_BYTES_SERPAPI = 5 * 1024 * 1024;
export const TTL_CACHE_BUSQUEDAS_MS = 15 * 60 * 1000;
export const MAX_ENTRADAS_CACHE_BUSQUEDAS = 100;
export const SERVICIO_SERPAPI = "de tarifas de hoteles (SerpApi)";
const MAX_TEXTO_ID = 500;
const MAX_TEXTO_NOMBRE = 300;

export interface ConsultaHoteles {
  destino: string;
  entrada: string;
  salida: string;
  adultos: number;
}

export interface HotelProveedor {
  idExterno: string;
  nombre: string;
  lat: number;
  lng: number;
  precio: PrecioReferencialUsd;
}

export interface PaginaHoteles {
  resultadosRecibidos: number;
  hoteles: HotelProveedor[];
  hayMasPaginas: boolean;
}

export interface ResultadoBusquedaHoteles extends PaginaHoteles {
  consulta: string;
  consultadoEn: string;
  desdeCache: boolean;
}

export interface BuscadorHoteles {
  configurado: boolean;
  buscar(consulta: ConsultaHoteles): Promise<ResultadoBusquedaHoteles>;
}

interface OpcionesBuscador {
  apiKey?: string;
  fetch?: FuncionFetch;
  tiempoEsperaMs?: number;
  ahora?: () => Date;
  ttlMs?: number;
  maxEntradas?: number;
}

export function construirConsultaTexto(destino: string): string {
  return `hoteles en ${destino}`;
}

export function construirUrlSerpApi(consulta: ConsultaHoteles, clave: string): URL {
  const url = new URL(URL_SERPAPI);
  url.search = new URLSearchParams({
    engine: MOTOR_SERPAPI,
    q: construirConsultaTexto(consulta.destino),
    check_in_date: consulta.entrada,
    check_out_date: consulta.salida,
    adults: String(consulta.adultos),
    children: String(NINOS_POR_SOLICITUD),
    currency: MONEDA_SERPAPI,
    hl: IDIOMA_SERPAPI,
    api_key: clave,
  }).toString();
  return url;
}

function clasificarMensaje(mensaje: string): ErrorApi | null {
  if (/api[ _-]?key/i.test(mensaje)) {
    return errorCredenciales(SERVICIO_SERPAPI);
  }
  if (/run out of searches|out of searches|throughput|rate limit|too many requests/i.test(mensaje)) {
    return errorLimiteSolicitudes(SERVICIO_SERPAPI);
  }
  return null;
}

function texto(valor: unknown, maximo: number): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const limpio = valor.trim();
  return limpio.length > 0 && limpio.length <= maximo ? limpio : null;
}

function coordenadas(valor: unknown): { lat: number; lng: number } | null {
  if (!esObjeto(valor)) {
    return null;
  }
  const { latitude: lat, longitude: lng } = valor;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

export function normalizarPropiedad(propiedad: unknown, adultos: number): HotelProveedor | null {
  if (!esObjeto(propiedad) || propiedad.type !== "hotel") {
    return null;
  }
  const idExterno = texto(propiedad.property_token, MAX_TEXTO_ID);
  const nombre = texto(propiedad.name, MAX_TEXTO_NOMBRE);
  const posicion = coordenadas(propiedad.gps_coordinates);
  if (!idExterno || !nombre || !posicion) {
    return null;
  }
  const precio = seleccionarPrecio(propiedad, adultos);
  if (!precio) {
    return null;
  }
  return { idExterno, nombre, lat: posicion.lat, lng: posicion.lng, precio };
}

function hayPaginaSiguiente(datos: Record<string, unknown>): boolean {
  const paginacion = datos.serpapi_pagination;
  return esObjeto(paginacion) && typeof paginacion.next_page_token === "string" && paginacion.next_page_token.length > 0;
}

export function interpretarRespuestaSerpApi(datos: unknown, adultos: number): PaginaHoteles {
  if (!esObjeto(datos)) {
    throw errorRespuestaInvalida(SERVICIO_SERPAPI);
  }
  const metadatos = datos.search_metadata;
  const estado = esObjeto(metadatos) ? metadatos.status : undefined;

  if (typeof datos.error === "string") {
    const clasificado = clasificarMensaje(datos.error);
    if (clasificado) {
      throw clasificado;
    }
    if (estado === "Success" && datos.properties === undefined && datos.property_token === undefined) {
      return { resultadosRecibidos: 0, hoteles: [], hayMasPaginas: false };
    }
    throw errorProveedor(SERVICIO_SERPAPI);
  }
  if (estado !== undefined && estado !== "Success") {
    throw errorProveedor(SERVICIO_SERPAPI);
  }

  let propiedades: unknown[];
  if (Array.isArray(datos.properties)) {
    propiedades = datos.properties;
  } else if (datos.properties === undefined && typeof datos.property_token === "string") {
    propiedades = [datos];
  } else {
    throw errorRespuestaInvalida(SERVICIO_SERPAPI);
  }

  const hoteles: HotelProveedor[] = [];
  for (const propiedad of propiedades) {
    const hotel = normalizarPropiedad(propiedad, adultos);
    if (hotel) {
      hoteles.push(hotel);
    }
  }
  return { resultadosRecibidos: propiedades.length, hoteles, hayMasPaginas: hayPaginaSiguiente(datos) };
}

async function consultarSerpApi(
  consulta: ConsultaHoteles,
  clave: string,
  fetchImpl: FuncionFetch,
  tiempoEsperaMs: number,
): Promise<PaginaHoteles> {
  const respuesta = await consultarProveedor({
    fetch: fetchImpl,
    url: construirUrlSerpApi(consulta, clave),
    tiempoEsperaMs,
    maxBytes: MAX_BYTES_SERPAPI,
    servicio: SERVICIO_SERPAPI,
  });

  if (!respuesta.ok) {
    if (respuesta.estado === 401 || respuesta.estado === 403) {
      throw errorCredenciales(SERVICIO_SERPAPI);
    }
    if (respuesta.estado === 429) {
      throw errorLimiteSolicitudes(SERVICIO_SERPAPI);
    }
    const mensaje = esObjeto(respuesta.datos) && typeof respuesta.datos.error === "string" ? respuesta.datos.error : "";
    throw clasificarMensaje(mensaje) ?? errorProveedor(SERVICIO_SERPAPI);
  }
  if (!respuesta.jsonValido) {
    throw errorRespuestaInvalida(SERVICIO_SERPAPI, "devolvió una respuesta que no es JSON válido");
  }
  return interpretarRespuestaSerpApi(respuesta.datos, consulta.adultos);
}

export function llaveBusqueda(consulta: ConsultaHoteles): string {
  return JSON.stringify([
    MOTOR_SERPAPI,
    construirConsultaTexto(consulta.destino),
    consulta.entrada,
    consulta.salida,
    consulta.adultos,
    NINOS_POR_SOLICITUD,
    MONEDA_SERPAPI,
    IDIOMA_SERPAPI,
  ]);
}

export function crearBuscadorHoteles({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
  tiempoEsperaMs = TIEMPO_ESPERA_SERPAPI_MS,
  ahora = () => new Date(),
  ttlMs = TTL_CACHE_BUSQUEDAS_MS,
  maxEntradas = MAX_ENTRADAS_CACHE_BUSQUEDAS,
}: OpcionesBuscador = {}): BuscadorHoteles {
  const clave = typeof apiKey === "string" ? apiKey.trim() : "";
  const cache = new Map<string, { expiraEn: number; resultado: ResultadoBusquedaHoteles }>();
  const enCurso = new Map<string, Promise<ResultadoBusquedaHoteles>>();

  function leerCache(llave: string): ResultadoBusquedaHoteles | null {
    const entrada = cache.get(llave);
    if (!entrada) {
      return null;
    }
    cache.delete(llave);
    if (ahora().getTime() >= entrada.expiraEn) {
      return null;
    }
    cache.set(llave, entrada);
    return entrada.resultado;
  }

  function guardar(llave: string, resultado: ResultadoBusquedaHoteles, expiraEn: number): void {
    const instante = ahora().getTime();
    for (const [otra, entrada] of cache) {
      if (instante >= entrada.expiraEn) {
        cache.delete(otra);
      }
    }
    cache.delete(llave);
    while (cache.size >= maxEntradas) {
      const masAntigua = cache.keys().next().value;
      if (masAntigua === undefined) {
        break;
      }
      cache.delete(masAntigua);
    }
    if (instante < expiraEn) {
      cache.set(llave, { expiraEn, resultado });
    }
  }

  return {
    configurado: clave.length > 0,
    async buscar(consulta) {
      if (!clave) {
        throw errorNoConfigurado(SERVICIO_SERPAPI);
      }
      const llave = llaveBusqueda(consulta);
      const almacenado = leerCache(llave);
      if (almacenado) {
        return { ...almacenado, desdeCache: true };
      }
      const pendiente = enCurso.get(llave);
      if (pendiente) {
        return { ...(await pendiente), desdeCache: true };
      }

      const promesa = (async () => {
        const inicio = ahora();
        const pagina = await consultarSerpApi(consulta, clave, fetchImpl, tiempoEsperaMs);
        const resultado: ResultadoBusquedaHoteles = {
          ...pagina,
          consulta: construirConsultaTexto(consulta.destino),
          consultadoEn: inicio.toISOString(),
          desdeCache: false,
        };
        guardar(llave, resultado, inicio.getTime() + ttlMs);
        return resultado;
      })();
      enCurso.set(llave, promesa);
      try {
        return await promesa;
      } finally {
        enCurso.delete(llave);
      }
    },
  };
}
