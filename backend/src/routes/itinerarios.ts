import express, { type ErrorRequestHandler, type Request, type Response, type Router } from "express";
import { ErrorApi } from "../errores";
import type { ResultadoPropuesta } from "../ai/propuesta";
import type { ResultadoPrioridadClima } from "../ai/prioridadClima";

const LIMITE_CUERPO = "100kb";

export type ValidarPropuesta = (cuerpo: unknown) => Promise<ResultadoPropuesta>;
export type PriorizarPorClima = (cuerpo: unknown) => Promise<ResultadoPrioridadClima>;

const errorCuerpoInvalido: ErrorRequestHandler = (err, req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || err.type === "entity.too.large")) {
    return next(new ErrorApi(400, "PARAMETRO_INVALIDO", "El cuerpo de la solicitud debe ser un JSON válido de hasta 100 KB."));
  }
  return next(err);
};

export function crearRutaItinerarios(validarPropuesta: ValidarPropuesta, priorizarPorClima: PriorizarPorClima): Router {
  const router = express.Router();
  const leerJson = express.json({ limit: LIMITE_CUERPO, strict: true });

  router.post("/validar", leerJson, errorCuerpoInvalido, async (req: Request, res: Response) => {
    const resultado = await validarPropuesta(req.body);
    if (!resultado.valido) {
      throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La propuesta de itinerario no es válida.", resultado.detalles);
    }
    res.json(resultado.plan);
  });

  router.post("/priorizar-clima", leerJson, errorCuerpoInvalido, async (req: Request, res: Response) => {
    const resultado = await priorizarPorClima(req.body);
    if (!resultado.valido) {
      throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La propuesta de itinerario no es válida.", resultado.detalles);
    }
    res.json(resultado.plan);
  });

  return router;
}
