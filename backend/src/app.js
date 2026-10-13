const express = require("express");
const { crearClienteGeoapify } = require("./geoapify/cliente");
const { crearClienteDetalles } = require("./geoapify/detalles");
const { crearEnriquecedorHorarios } = require("./geoapify/enriquecer");
const { crearRutaLugares } = require("./routes/lugares");
const { crearClienteOpenWeather } = require("./openweather/cliente");
const { crearServicioClima } = require("./clima/servicio");
const { crearRutaPronosticoClima } = require("./routes/pronosticoClima");
const { manejarErrores } = require("./errores");

function crearApp({ apiKey = process.env.GEOAPIFY_API_KEY, fetch, tiempoEsperaMs, detalles = {}, clima = {} } = {}) {
  const app = express();
  app.disable("x-powered-by");

  const buscarLugares = crearClienteGeoapify({ apiKey, fetch, tiempoEsperaMs });
  const consultarDetalles = crearClienteDetalles({ apiKey, fetch, tiempoEsperaMs: detalles.tiempoEsperaMs });
  const enriquecerHorarios = crearEnriquecedorHorarios({
    consultarDetalles,
    concurrencia: detalles.concurrencia,
    intervaloMs: detalles.intervaloMs,
    presupuestoMs: detalles.presupuestoMs,
  });
  app.use("/api/lugares", crearRutaLugares(buscarLugares, enriquecerHorarios));

  const obtenerPronostico = crearClienteOpenWeather({
    apiKey: clima.apiKey === undefined ? process.env.OPENWEATHER_API_KEY : clima.apiKey,
    fetch: clima.fetch,
    tiempoEsperaMs: clima.tiempoEsperaMs,
  });
  const consultarClima = crearServicioClima({ obtenerPronostico, ahora: clima.ahora });
  app.use("/api/clima/pronostico", crearRutaPronosticoClima(consultarClima));

  app.use((req, res) => {
    res.status(404).json({
      error: { codigo: "RUTA_NO_ENCONTRADA", mensaje: "La ruta solicitada no existe." },
    });
  });

  app.use(manejarErrores);

  return app;
}

module.exports = { crearApp };
