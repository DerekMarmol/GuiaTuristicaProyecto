import type { FastifyPluginAsync } from "fastify";
import type { ObtenerClimaActual } from "../openweather/cliente";
import { validarConsultaClimaActual } from "../validacion/clima";
import type { Consulta } from "../tipos";

// Clima observado ahora en unas coordenadas. El frontend lo muestra junto al pronóstico del día para que
// no se confunda la temperatura de este momento con el rango previsto para todo el día.
export function crearRutaClimaActual(obtenerClimaActual: ObtenerClimaActual): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: Consulta }>("/", async (req) => {
      const ubicacion = validarConsultaClimaActual(req.query);
      const clima = await obtenerClimaActual(ubicacion);
      return {
        ubicacion,
        observadoEn: new Date(clima.dt * 1000).toISOString(),
        temperaturaC: clima.temperaturaC,
        descripcion: clima.descripcion,
        lluvia1hMm: clima.lluvia1hMm,
      };
    });
  };
}
