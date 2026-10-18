import type { FastifyPluginAsync } from "fastify";
import type { ResponderChat } from "./agente";

const LIMITE_CUERPO_BYTES = 100 * 1024;

export function crearRutaChat(responderChat: ResponderChat): FastifyPluginAsync {
  return async (app) => {
    app.post("/", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => responderChat(req.body));
  };
}