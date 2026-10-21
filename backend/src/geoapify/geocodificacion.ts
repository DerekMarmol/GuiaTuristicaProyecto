import { esZonaHorariaValida } from "../ai/zonaHoraria";
import { ErrorApi } from "../errores";
import { esObjeto, type FuncionFetch } from "../tipos";
import { errorPorEstado, errorTiempoAgotado } from "./cliente";

export const URL_GEOCODIFICACION = "https://api.geoapify.com/v1/geocode/search";
const TIEMPO_ESPERA_MS = 8000;
// La guía cubre solo Guatemala (Valhalla solo tiene ese mapa y los montos van en quetzales).
const PAIS = "gt";
// Geoapify devuelve algo aunque el texto no tenga sentido; por debajo de esta confianza se trata como no encontrado.
const CONFIANZA_MINIMA = 0.5;

export interface DestinoGeocodificado {
  nombre: string;
  lat: number;
  lng: number;
  zonaHoraria: string;
}

export type Geocodificar = (texto: string) => Promise<DestinoGeocodificado | null>;

interface OpcionesGeocodificador {
  apiKey?: string;
  fetch?: FuncionFetch;
  tiempoEsperaMs?: number;
}

function aDestino(resultado: unknown): DestinoGeocodificado | null {
  if (!esObjeto(resultado)) {
    return null;
  }
  const { lat, lon, formatted, timezone, rank } = resultado;
  const confianza = esObjeto(rank) ? rank.confidence : undefined;
  if (typeof confianza !== "number" || confianza < CONFIANZA_MINIMA) {
    return null;
  }
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  const zona = esObjeto(timezone) ? timezone.name : undefined;
  if (!esZonaHorariaValida(zona)) {
    return null;
  }
  return {
    nombre: typeof formatted === "string" && formatted.trim() !== "" ? formatted : "",
    lat,
    lng: lon,
    zonaHoraria: zona,
  };
}

export function crearGeocodificador({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
  tiempoEsperaMs = TIEMPO_ESPERA_MS,
}: OpcionesGeocodificador = {}): Geocodificar {
  const clave = typeof apiKey === "string" ? apiKey.trim() : "";

  return async function geocodificar(texto) {
    if (!clave) {
      throw new ErrorApi(500, "SERVICIO_NO_CONFIGURADO", "El servicio de lugares no está configurado.");
    }

    const url = new URL(URL_GEOCODIFICACION);
    url.search = new URLSearchParams({
      text: texto,
      filter: `countrycode:${PAIS}`,
      lang: "es",
      limit: "1",
      format: "json",
      apiKey: clave,
    }).toString();

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), tiempoEsperaMs);

    try {
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: controlador.signal });
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

      let datos: unknown;
      try {
        datos = await respuesta.json();
      } catch {
        if (controlador.signal.aborted) {
          throw errorTiempoAgotado();
        }
        throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de lugares devolvió una respuesta que no es JSON válido.");
      }

      if (!esObjeto(datos) || !Array.isArray(datos.results)) {
        throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de lugares devolvió una respuesta con formato inesperado.");
      }
      const destino = aDestino(datos.results[0]);
      return destino && { ...destino, nombre: destino.nombre || texto };
    } finally {
      clearTimeout(temporizador);
    }
  };
}
