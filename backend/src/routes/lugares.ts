import express, { type Router } from "express";
import { validarConsultaLugares } from "../validacion/lugares";
import type { BuscarLugares } from "../geoapify/cliente";
import type { EnriquecerHorarios } from "../geoapify/enriquecer";

export function crearRutaLugares(buscarLugares: BuscarLugares, enriquecerHorarios: EnriquecerHorarios): Router {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const consulta = validarConsultaLugares(req.query);
    const encontrados = await buscarLugares(consulta);
    const lugares = await enriquecerHorarios(encontrados);
    res.json({ lugares });
  });

  return router;
}
