
const express = require("express");
const { consultarClima } = require("../clima/climaService");

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
      return res.status(400).json({
        error: "Se requieren latitud, longitud y fechaHora"
      });
    }

    try {
      const clima = await consultarClima(
        latitud,
        longitud,
        fechaHora
      );

      if (!clima) {
        return res.json({
          disponible: false,
          clima: null
        });
      }

      return res.json({
        disponible: true,
        clima
      });

    } catch (error) {
      return res.status(400).json({
        error: error.message
      });
    }
  });

  return router;
}

module.exports = { crearRutaClima };
