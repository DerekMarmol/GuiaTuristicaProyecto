const { ErrorApi } = require("../errores");
const { transformarLugares } = require("./transformar");

const URL_PLACES = "https://api.geoapify.com/v2/places";
const TIEMPO_ESPERA_MS = 10000;

function formatearCoordenada(valor) {
  return valor.toFixed(7).replace(/\.?0+$/, "");
}

function errorPorEstado(estado) {
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

function errorTiempoAgotado() {
  return new ErrorApi(504, "PROVEEDOR_TIEMPO_AGOTADO", "El proveedor de lugares tardó demasiado en responder.");
}

function crearClienteGeoapify({ apiKey, fetch: fetchImpl = globalThis.fetch, tiempoEsperaMs = TIEMPO_ESPERA_MS } = {}) {
  const clave = typeof apiKey === "string" ? apiKey.trim() : "";

  return async function buscarLugares({ lat, lng, categorias, radio, limite }) {
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
      let respuesta;
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

      let datos;
      try {
        datos = await respuesta.json();
      } catch {
        if (controlador.signal.aborted) {
          throw errorTiempoAgotado();
        }
        throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de lugares devolvió una respuesta que no es JSON válido.");
      }

      return transformarLugares(datos).slice(0, limite);
    } finally {
      clearTimeout(temporizador);
    }
  };
}

module.exports = { crearClienteGeoapify, URL_PLACES };
