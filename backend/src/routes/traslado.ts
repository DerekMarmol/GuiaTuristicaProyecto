import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { detallesInvalidos } from "../ai/propuesta";
import type { LugarReal } from "../ai/tipos";
import { estimarTraslado } from "../ai/validacionApertura";
import { ErrorApi } from "../errores";

const LIMITE_CUERPO_BYTES = 4 * 1024;

const PuntoSchema = (campo: string) =>
  z.object(
    {
      lat: z.number({ invalid_type_error: `${campo}.lat debe ser un número.`, required_error: `${campo}.lat es obligatorio.` }).min(-90).max(90),
      lng: z.number({ invalid_type_error: `${campo}.lng debe ser un número.`, required_error: `${campo}.lng es obligatorio.` }).min(-180).max(180),
    },
    { required_error: `${campo} es obligatorio.`, invalid_type_error: `${campo} debe ser un objeto con lat y lng.` },
  );

const SolicitudSchema = z.object({ origen: PuntoSchema("origen"), destino: PuntoSchema("destino") });

function comoLugar(id: string, { lat, lng }: { lat: number; lng: number }): LugarReal {
  return { placeId: id, nombre: id, lat, lng, categoria: "punto" };
}

// Traslado desde el punto de partida del usuario (su ubicación o un punto elegido en el mapa) hasta la
// primera parada. Usa el mismo estimador que los tramos entre paradas del itinerario, para que el desglose
// de «Traslado y margen de seguridad» sea comparable.
export function crearRutaTraslado(): FastifyPluginAsync {
  return async (app) => {
    app.post("/traslado", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => {
      const resultado = SolicitudSchema.safeParse(req.body);
      if (!resultado.success) {
        throw new ErrorApi(400, "PARAMETRO_INVALIDO", "Los puntos del traslado no son válidos.", detallesInvalidos(resultado.error));
      }
      const { origen, destino } = resultado.data;
      return { traslado: estimarTraslado(comoLugar("origen", origen), comoLugar("destino", destino)) };
    });
  };
}
