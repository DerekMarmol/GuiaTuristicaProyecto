const express = require("express");
const { crearClienteGeoapify } = require("./geoapify/cliente");
const { crearClienteDetalles } = require("./geoapify/detalles");
const { crearEnriquecedorHorarios } = require("./geoapify/enriquecer");
const { crearRutaLugares } = require("./routes/lugares");
const { manejarErrores } = require("./errores");

function crearApp({ apiKey = process.env.GEOAPIFY_API_KEY, fetch, tiempoEsperaMs, detalles = {} } = {}) {
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

  app.use((req, res) => {
    res.status(404).json({
      error: { codigo: "RUTA_NO_ENCONTRADA", mensaje: "La ruta solicitada no existe." },
    });
  });

  app.use(manejarErrores);

  return app;
}

module.exports = { crearApp };
