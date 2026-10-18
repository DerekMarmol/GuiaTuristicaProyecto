import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    verificarToken: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id: string; correo: string };
    user: { id: string; correo: string };
  }
}