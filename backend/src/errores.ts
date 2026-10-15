import type { FastifyReply, FastifyRequest } from "fastify";
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

function esErrorDelCliente(err: unknown): err is Error & { statusCode: number } {
  if (!(err instanceof Error) || !("statusCode" in err)) {
    return false;
  }
  const { statusCode } = err;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

export function manejarErrores(err: unknown, req: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (err instanceof ErrorApi) {
    const error: { codigo: string; mensaje: string; detalles?: ErrorParametro[] } = { codigo: err.codigo, mensaje: err.message };
    if (err.detalles) {
      error.detalles = err.detalles;
    }
    return reply.code(err.estado).send({ error });
  }

  // Errores propios de Fastify causados por la solicitud (URL mal formada, tipo de contenido no admitido, etc.).
  if (esErrorDelCliente(err)) {
    return reply.code(err.statusCode).send({
      error: { codigo: "SOLICITUD_INVALIDA", mensaje: "La solicitud no es válida." },
    });
  }

  console.error("Error interno no controlado:", err instanceof Error ? err.name : err);
  return reply.code(500).send({
    error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error interno en el servidor." },
  });
}
