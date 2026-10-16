import type { FastifyPluginAsync } from "fastify";
import { ErrorApi } from "../errores";
import type { ResultadoPropuesta } from "../ai/propuesta";
import type { ResultadoPrioridadClima } from "../ai/prioridadClima";

const LIMITE_CUERPO_BYTES = 100 * 1024;

// Errores del analizador de cuerpo de Fastify que se informan como parámetros inválidos.
const ERRORES_CUERPO = new Set([
  "FST_ERR_CTP_INVALID_JSON_BODY",
  "FST_ERR_CTP_EMPTY_JSON_BODY",
  "FST_ERR_CTP_BODY_TOO_LARGE",
  "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
  "FST_ERR_CTP_INVALID_MEDIA_TYPE",
]);

export type ValidarPropuesta = (cuerpo: unknown) => Promise<ResultadoPropuesta>;
export type PriorizarPorClima = (cuerpo: unknown) => Promise<ResultadoPrioridadClima>;

function esErrorCuerpo(err: unknown): boolean {
  return err instanceof Error && "code" in err && typeof err.code === "string" && ERRORES_CUERPO.has(err.code);
}

export function crearRutaItinerarios(validarPropuesta: ValidarPropuesta, priorizarPorClima: PriorizarPorClima): FastifyPluginAsync {
  return async (app) => {
    // Lo que se relanza aquí lo atiende el manejador de errores general de la aplicación.
    app.setErrorHandler((err) => {
      if (esErrorCuerpo(err)) {
        throw new ErrorApi(400, "PARAMETRO_INVALIDO", "El cuerpo de la solicitud debe ser un JSON válido de hasta 100 KB.");
      }
      throw err;
    });

    app.post("/validar", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => {
      const resultado = await validarPropuesta(req.body);
      if (!resultado.valido) {
        throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La propuesta de itinerario no es válida.", resultado.detalles);
      }
      return resultado.plan;
    });

    app.post("/priorizar-clima", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => {
      const resultado = await priorizarPorClima(req.body);
      if (!resultado.valido) {
        throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La propuesta de itinerario no es válida.", resultado.detalles);
      }
      return resultado.plan;
    });
  };
}
