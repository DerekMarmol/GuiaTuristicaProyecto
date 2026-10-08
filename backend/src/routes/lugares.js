const express = require("express");
const { validarConsultaLugares } = require("../validacion/lugares");

function crearRutaLugares(buscarLugares) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const consulta = validarConsultaLugares(req.query);
    const lugares = await buscarLugares(consulta);
    res.json({ lugares });
  });

  return router;
}

module.exports = { crearRutaLugares };
