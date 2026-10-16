import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";

const authPluginAsync: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Registrar el manejador de JWT de Fastify
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || "guia_turistica_super_secret_key_2026",
    sign: {
      expiresIn: process.env.JWT_EXPIRES_IN || "2h",
    },
  });

  // Decorador para proteger rutas (devuelve 401 si falla)
  fastify.decorate(
    "verificarToken",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          mensaje: "Acceso no autorizado: Token inválido o expirado",
        });
      }
    }
  );
};

export default fp(authPluginAsync);