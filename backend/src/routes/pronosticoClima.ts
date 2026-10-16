import type { FastifyPluginAsync } from "fastify";
import { validarConsultaClima } from "../validacion/clima";
import type { ConsultarClima } from "../clima/servicio";
import type { Consulta } from "../tipos";

export function crearRutaPronosticoClima(consultarClima: ConsultarClima): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: Consulta }>("/", async (req) => {
      const consulta = validarConsultaClima(req.query);
      return consultarClima(consulta);
    });
  };
}
