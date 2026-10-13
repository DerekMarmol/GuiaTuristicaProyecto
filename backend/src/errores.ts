import type { ErrorRequestHandler } from "express";
import type { ErrorParametro } from "./tipos";

export class ErrorApi extends Error {
  estado: number;
  codigo: string;
  detalles: ErrorParametro[] | undefined;

  constructor(estado: number, codigo: string, mensaje: string, detalles?: ErrorParametro[]) {
    super(mensaje);
    this.name = "ErrorApi";
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export const manejarErrores: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ErrorApi) {
    const error: { codigo: string; mensaje: string; detalles?: ErrorParametro[] } = { codigo: err.codigo, mensaje: err.message };
    if (err.detalles) {
      error.detalles = err.detalles;
    }
    res.status(err.estado).json({ error });
    return;
  }

  console.error("Error interno no controlado:", err && err.name);
  res.status(500).json({
    error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error interno en el servidor." },
  });
};
