import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { PrismaClient } from "../../generated/prisma";

const prisma = new PrismaClient();

interface ActualizarPerfilBody {
  nombre?: string;
  correo?: string;
}

const usuariosRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. OBTENER PERFIL DEL USUARIO AUTENTICADO
  fastify.get(
    "/perfil",
    { preHandler: [fastify.verificarToken] },
    async (request, reply) => {
      const usuarioSesion = request.user as { id: string; correo: string };

      const usuario = await prisma.usuario.findUnique({
        where: { id: usuarioSesion.id },
        select: {
          id: true,
          nombre: true,
          correo: true,
          creadoEn: true,
          // La contraseña se omite deliberadamente por seguridad
        },
      });

      if (!usuario) {
        return reply.status(404).send({
          statusCode: 404,
          mensaje: "Usuario no encontrado",
        });
      }

      return reply.send({
        mensaje: "Perfil obtenido exitosamente",
        usuario,
      });
    }
  );

  // 2. ACTUALIZAR NOMBRE O CORREO
  fastify.put<{ Body: ActualizarPerfilBody }>(
    "/perfil",
    { preHandler: [fastify.verificarToken] },
    async (request, reply) => {
      const usuarioSesion = request.user as { id: string; correo: string };
      const { nombre, correo } = request.body || {};

      if (!nombre && !correo) {
        return reply.status(400).send({
          statusCode: 400,
          mensaje: "Debes proporcionar al menos el nombre o el correo a actualizar",
        });
      }

      // Si desea actualizar el correo, validar que no esté en uso por otro usuario
      if (correo) {
        const correoNormalizado = correo.toLowerCase().trim();
        const correoExistente = await prisma.usuario.findFirst({
          where: {
            correo: correoNormalizado,
            id: { not: usuarioSesion.id }, // Excluye al usuario actual
          },
        });

        if (correoExistente) {
          return reply.status(400).send({
            statusCode: 400,
            mensaje: "El correo electrónico ya se encuentra en uso por otra cuenta",
          });
        }
      }

      // Actualizar datos
      const usuarioActualizado = await prisma.usuario.update({
        where: { id: usuarioSesion.id },
        data: {
          ...(nombre && { nombre: nombre.trim() }),
          ...(correo && { correo: correo.toLowerCase().trim() }),
        },
        select: {
          id: true,
          nombre: true,
          correo: true,
          creadoEn: true,
        },
      });

      return reply.send({
        mensaje: "Perfil actualizado exitosamente",
        usuario: usuarioActualizado,
      });
    }
  );
};

export default usuariosRoutes;