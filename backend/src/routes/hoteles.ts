import express, { type ErrorRequestHandler, type Request, type Response, type Router } from "express";
import { ErrorApi } from "../errores";
import type { RecomendarHoteles } from "../hoteles/recomendaciones";
import { validarSolicitudHoteles } from "../validacion/hoteles";

const LIMITE_CUERPO = "32kb";

const errorCuerpoInvalido: ErrorRequestHandler = (err, req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || err.type === "entity.too.large")) {
    return next(new ErrorApi(400, "PARAMETRO_INVALIDO", "El cuerpo de la solicitud debe ser un JSON válido de hasta 32 KB."));
  }
  return next(err);
};

export function crearRutaHoteles(recomendarHoteles: RecomendarHoteles): Router {
  const router = express.Router();
  const leerJson = express.json({ limit: LIMITE_CUERPO, strict: true });

  router.post("/recomendaciones", leerJson, errorCuerpoInvalido, async (req: Request, res: Response) => {
    const solicitud = validarSolicitudHoteles(req.body);
    res.json(await recomendarHoteles(solicitud));
  });

  return router;
}
