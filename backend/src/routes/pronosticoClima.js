const express = require("express");
const { validarConsultaClima } = require("../validacion/clima");

function crearRutaPronosticoClima(consultarClima) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const consulta = validarConsultaClima(req.query);
    res.json(await consultarClima(consulta));
  });

  return router;
}

module.exports = { crearRutaPronosticoClima };
