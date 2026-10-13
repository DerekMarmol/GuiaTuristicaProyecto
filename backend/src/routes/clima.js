const express = require("express");
const { consultarClima } = require("../clima/climaService");
const { ErrorApi } = require("../errores");

function crearRutaClima() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const { latitud, longitud, fechaHora } = req.query;

    if (
      typeof latitud !== "string" ||
      typeof longitud !== "string" ||
      typeof fechaHora !== "string" ||
      !latitud.trim() ||
      !longitud.trim() ||
      !fechaHora.trim()
    ) {
      throw new ErrorApi(400, "PARAMETRO_INVALIDO", "Se requieren latitud, longitud y fechaHora.");
    }

    let clima;
    try {
      clima = await consultarClima(latitud, longitud, fechaHora);
    } catch (error) {
      throw new ErrorApi(400, "PARAMETRO_INVALIDO", error.message);
    }

    if (!clima) {
      return res.json({ disponible: false, clima: null });
    }

    return res.json({ disponible: true, clima });
  });

  return router;
}

module.exports = { crearRutaClima };
