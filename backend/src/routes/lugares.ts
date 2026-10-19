import type { FastifyPluginAsync } from "fastify";
import { validarConsultaLugares } from "../validacion/lugares";
import { validarConsultaAbiertosAhora } from "../validacion/abiertosAhora";
import type { BuscarLugares } from "../geoapify/cliente";
import type { EnriquecerHorarios } from "../geoapify/enriquecer";
import type { BuscarAbiertosAhora } from "../lugares/abiertosAhora";
import type { Consulta } from "../tipos";

export function crearRutaLugares(
  buscarLugares: BuscarLugares,
  enriquecerHorarios: EnriquecerHorarios,
  buscarAbiertosAhora: BuscarAbiertosAhora,
): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: Consulta }>("/", async (req) => {
      const consulta = validarConsultaLugares(req.query);
      const encontrados = await buscarLugares(consulta);
      const lugares = await enriquecerHorarios(encontrados);
      return { lugares };
    });

    app.get<{ Querystring: Consulta }>("/abiertos-ahora", async (req) => {
      const consulta = validarConsultaAbiertosAhora(req.query);
      return buscarAbiertosAhora(consulta);
    });
  };
}
