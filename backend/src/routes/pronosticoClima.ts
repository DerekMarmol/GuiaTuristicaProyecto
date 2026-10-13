import express, { type Router } from "express";
import { validarConsultaClima } from "../validacion/clima";
import type { ConsultarClima } from "../clima/servicio";

export function crearRutaPronosticoClima(consultarClima: ConsultarClima): Router {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const consulta = validarConsultaClima(req.query);
    res.json(await consultarClima(consulta));
  });

  return router;
}
