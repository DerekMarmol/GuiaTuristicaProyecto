const express = require("express");
const { validarConsultaLugares } = require("../validacion/lugares");

function crearRutaLugares(buscarLugares, enriquecerHorarios) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const consulta = validarConsultaLugares(req.query);
    const encontrados = await buscarLugares(consulta);
    const lugares = await enriquecerHorarios(encontrados);
    res.json({ lugares });
  });

  return router;
}

module.exports = { crearRutaLugares };
