import type { FastifyPluginAsync } from "fastify";
import { ErrorApi, manejarErrores } from "../errores";
import type { RecomendarRestaurantes } from "../restaurantes/recomendaciones";
import { validarSolicitudRestaurantes } from "../validacion/restaurantes";

const LIMITE_CUERPO_BYTES = 32 * 1024;

const ERRORES_CUERPO = new Set([
  "FST_ERR_CTP_INVALID_JSON_BODY",
  "FST_ERR_CTP_EMPTY_JSON_BODY",
  "FST_ERR_CTP_BODY_TOO_LARGE",
  "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
  "FST_ERR_CTP_INVALID_MEDIA_TYPE",
]);

function esErrorCuerpo(err: unknown): boolean {
  return err instanceof Error && "code" in err && typeof err.code === "string" && ERRORES_CUERPO.has(err.code);
}

export function crearRutaRestaurantes(recomendarRestaurantes: RecomendarRestaurantes): FastifyPluginAsync {
  return async (app) => {
    app.setErrorHandler((err, req, reply) => {
      if (esErrorCuerpo(err)) {
        return manejarErrores(
          new ErrorApi(400, "PARAMETRO_INVALIDO", "El cuerpo de la solicitud debe ser un JSON válido de hasta 32 KB."),
          req,
          reply,
        );
      }
      return manejarErrores(err, req, reply);
    });

    app.post("/recomendaciones", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => {
      const solicitud = validarSolicitudRestaurantes(req.body);
      return recomendarRestaurantes(solicitud);
    });
  };
}
