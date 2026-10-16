import { esObjeto, type FuncionFetch } from "../tipos";

export const URL_PLACE_DETAILS = "https://api.geoapify.com/v2/place-details";
export const TIEMPO_ESPERA_DETALLE_MS = 5000;

export type PropiedadesDetalles = Record<string, unknown>;

export type ConsultarDetalles = (idExterno: string, senal: AbortSignal) => Promise<PropiedadesDetalles>;

interface OpcionesCliente {
  apiKey?: string;
  fetch?: FuncionFetch;
  tiempoEsperaMs?: number;
}

export class ErrorDetalles extends Error {
  motivo: string;

  constructor(motivo: string) {
    super(`No se obtuvieron detalles válidos del lugar: ${motivo}.`);
    this.name = "ErrorDetalles";
    this.motivo = motivo;
  }
}

interface RegistroDetalles {
  properties: PropiedadesDetalles;
}

function esRegistroDetalles(feature: unknown): feature is RegistroDetalles {
  return esObjeto(feature) && esObjeto(feature.properties) && feature.properties.feature_type === "details";
}

export function extraerRegistroDetalles(datos: unknown, idExterno: string): PropiedadesDetalles {
  if (!esObjeto(datos) || !Array.isArray(datos.features)) {
    throw new ErrorDetalles("estructura inesperada");
  }

  const registros = datos.features.filter(esRegistroDetalles);
  if (registros.length === 1) {
    return registros[0].properties;
  }

  const coincidentes = registros.filter((feature) => feature.properties.place_id === idExterno);
  if (coincidentes.length === 1) {
    return coincidentes[0].properties;
  }
  throw new ErrorDetalles("registro de detalles ausente o ambiguo");
}

export function crearClienteDetalles({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
  tiempoEsperaMs = TIEMPO_ESPERA_DETALLE_MS,
}: OpcionesCliente = {}): ConsultarDetalles {
  const clave = typeof apiKey === "string" ? apiKey.trim() : "";

  return async function consultarDetalles(idExterno, senal) {
    if (!clave) {
      throw new ErrorDetalles("servicio no configurado");
    }

    const url = new URL(URL_PLACE_DETAILS);
    url.search = new URLSearchParams({
      id: idExterno,
      features: "details",
      apiKey: clave,
    }).toString();

    const controlador = new AbortController();
    const abortar = () => controlador.abort();
    const temporizador = setTimeout(abortar, tiempoEsperaMs);
    if (senal?.aborted) {
      abortar();
    } else {
      senal?.addEventListener("abort", abortar, { once: true });
    }

    try {
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: controlador.signal,
        });
      } catch {
        throw new ErrorDetalles(controlador.signal.aborted ? "tiempo agotado" : "fallo de red");
      }

      if (!respuesta.ok) {
        respuesta.body?.cancel().catch(() => {});
        throw new ErrorDetalles(`HTTP ${respuesta.status}`);
      }

      let datos: unknown;
      try {
        datos = await respuesta.json();
      } catch {
        throw new ErrorDetalles(controlador.signal.aborted ? "tiempo agotado" : "JSON inválido");
      }

      return extraerRegistroDetalles(datos, idExterno);
    } finally {
      clearTimeout(temporizador);
      senal?.removeEventListener("abort", abortar);
    }
  };
}
