import type { FastifyPluginAsync } from "fastify";
import { ErrorApi, manejarErrores } from "../errores";
import type { RecomendarHoteles } from "../hoteles/recomendaciones";
import { validarSolicitudHoteles } from "../validacion/hoteles";

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

export function crearRutaHoteles(recomendarHoteles: RecomendarHoteles, ahora: () => Date = () => new Date()): FastifyPluginAsync {
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
      const solicitud = validarSolicitudHoteles(req.body, ahora());
      return recomendarHoteles(solicitud);
    });
  };
}
