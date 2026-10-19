import type { FastifyPluginAsync } from "fastify";
import type { ServicioClimaReactivo } from "../clima/reactivo/servicio";
import { ErrorApi, manejarErrores } from "../errores";
import { validarAceptacionPropuesta, validarSolicitudClimaReactivo } from "../validacion/climaReactivo";

const LIMITE_CUERPO_BYTES = 64 * 1024;

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

export function crearRutaClimaReactivo(servicio: ServicioClimaReactivo): FastifyPluginAsync {
  return async (app) => {
    app.setErrorHandler((err, req, reply) => {
      if (esErrorCuerpo(err)) {
        return manejarErrores(
          new ErrorApi(400, "PARAMETRO_INVALIDO", "El cuerpo de la solicitud debe ser un JSON válido de hasta 64 KB."),
          req,
          reply,
        );
      }
      return manejarErrores(err, req, reply);
    });

    app.post("/evaluar", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => servicio.evaluar(validarSolicitudClimaReactivo(req.body)));
    app.post("/propuesta", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => servicio.proponer(validarSolicitudClimaReactivo(req.body)));
    app.post("/aceptar", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => servicio.aceptar(validarAceptacionPropuesta(req.body)));
  };
}
