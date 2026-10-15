import type { FastifyPluginAsync } from "fastify";
import { validarConsultaLugares } from "../validacion/lugares";
import type { BuscarLugares } from "../geoapify/cliente";
import type { EnriquecerHorarios } from "../geoapify/enriquecer";
import type { Consulta } from "../tipos";

export function crearRutaLugares(buscarLugares: BuscarLugares, enriquecerHorarios: EnriquecerHorarios): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: Consulta }>("/", async (req) => {
      const consulta = validarConsultaLugares(req.query);
      const encontrados = await buscarLugares(consulta);
      const lugares = await enriquecerHorarios(encontrados);
      return { lugares };
    });
  };
}
