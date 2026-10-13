const { ErrorApi } = require("../errores");
const { interpretarPronostico } = require("./transformar");

const URL_PRONOSTICO = "https://api.openweathermap.org/data/2.5/forecast";
const TIEMPO_ESPERA_MS = 10000;

function formatearCoordenada(valor) {
  return valor.toFixed(7).replace(/\.?0+$/, "");
}

function errorPorEstado(estado) {
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

function errorTiempoAgotado() {
  return new ErrorApi(504, "PROVEEDOR_TIEMPO_AGOTADO", "El proveedor de clima tardó demasiado en responder.");
}

function crearClienteOpenWeather({ apiKey, fetch: fetchImpl = globalThis.fetch, tiempoEsperaMs = TIEMPO_ESPERA_MS } = {}) {
  const clave = typeof apiKey === "string" ? apiKey.trim() : "";

  return async function obtenerPronostico({ lat, lng }) {
    if (!clave) {
      throw new ErrorApi(503, "SERVICIO_NO_CONFIGURADO", "El servicio de clima no está configurado.");
    }

    const url = new URL(URL_PRONOSTICO);
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
        throw new ErrorApi(502, "PROVEEDOR_NO_DISPONIBLE", "No fue posible conectar con el proveedor de clima.");
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
        throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de clima devolvió una respuesta que no es JSON válido.");
      }

      return interpretarPronostico(datos);
    } finally {
      clearTimeout(temporizador);
    }
  };
}

module.exports = { crearClienteOpenWeather, URL_PRONOSTICO, TIEMPO_ESPERA_MS };
