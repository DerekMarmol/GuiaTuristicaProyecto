const express = require("express");
const { crearClienteGeoapify } = require("./geoapify/cliente");
const { crearRutaLugares } = require("./routes/lugares");
const { manejarErrores } = require("./errores");

function crearApp({ apiKey = process.env.GEOAPIFY_API_KEY, fetch, tiempoEsperaMs } = {}) {
  const app = express();
  app.disable("x-powered-by");

  const buscarLugares = crearClienteGeoapify({ apiKey, fetch, tiempoEsperaMs });
  app.use("/api/lugares", crearRutaLugares(buscarLugares));

  app.use((req, res) => {
    res.status(404).json({
      error: { codigo: "RUTA_NO_ENCONTRADA", mensaje: "La ruta solicitada no existe." },
    });
  });

  app.use(manejarErrores);

  return app;
}

module.exports = { crearApp };
