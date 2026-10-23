import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "../../generated/prisma";

const prisma = new PrismaClient();

interface RegistroBody {
  nombre: string;
  correo: string;
  contrasena: string;
}

interface LoginBody {
  correo: string;
  contrasena: string;
}

interface RenovarBody {
  refreshToken: string;
}

const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. REGISTRO
  fastify.post(
    "/registro",
    async (request: FastifyRequest<{ Body: RegistroBody }>, reply: FastifyReply) => {
      const { nombre, correo, contrasena } = request.body;

      if (!nombre || !correo || !contrasena) {
        return reply.status(400).send({
          statusCode: 400,
          mensaje: "Nombre, correo y contraseña son obligatorios",
        });
      }

      // Validar si el correo ya existe
      const usuarioExistente = await prisma.usuario.findUnique({
        where: { correo: correo.toLowerCase() },
      });

      if (usuarioExistente) {
        return reply.status(400).send({
          statusCode: 400,
          mensaje: "El correo electrónico ya se encuentra registrado",
        });
      }

      // Encriptar la contraseña
      const salt = await bcrypt.genSalt(10);
      const contrasenaHash = await bcrypt.hash(contrasena, salt);

      // Crear el registro en la base de datos
      const nuevoUsuario = await prisma.usuario.create({
        data: {
          nombre,
          correo: correo.toLowerCase(),
          contrasena: contrasenaHash,
        },
        select: {
          id: true,
          nombre: true,
          correo: true,
          creadoEn: true,
        },
      });

      return reply.status(201).send({
        mensaje: "Usuario registrado exitosamente",
        usuario: nuevoUsuario,
      });
    }
  );

  // 2. LOGIN
  fastify.post(
    "/login",
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { correo, contrasena } = request.body;

      if (!correo || !contrasena) {
        return reply.status(400).send({
          statusCode: 400,
          mensaje: "Correo y contraseña requeridos",
        });
      }

      const usuario = await prisma.usuario.findUnique({
        where: { correo: correo.toLowerCase() },
      });

      if (!usuario) {
        return reply.status(401).send({
          statusCode: 401,
          mensaje: "Credenciales inválidas",
        });
      }

      // Validar contraseña hasheada
      const coincide = await bcrypt.compare(contrasena, usuario.contrasena);
      if (!coincide) {
        return reply.status(401).send({
          statusCode: 401,
          mensaje: "Credenciales inválidas",
        });
      }

      // Generar token principal con Fastify JWT
      const token = fastify.jwt.sign({
        id: usuario.id,
        correo: usuario.correo,
      });

      // Generar refresh token para renovación
      const refreshToken = jwt.sign(
        { id: usuario.id },
        process.env.JWT_REFRESH_SECRET || "guia_turistica_refresh_secret_key_2026",
        { expiresIn: "7d" }
      );

      return reply.send({
        mensaje: "Inicio de sesión exitoso",
        token,
        refreshToken,
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
          correo: usuario.correo,
        },
      });
    }
  );

  // 3. RENOVAR TOKEN
  fastify.post(
    "/renovar",
    async (request: FastifyRequest<{ Body: RenovarBody }>, reply: FastifyReply) => {
      const { refreshToken } = request.body;

      if (!refreshToken) {
        return reply.status(401).send({
          statusCode: 401,
          mensaje: "Refresh token no proporcionado",
        });
      }

      try {
        const payload = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET || "guia_turistica_refresh_secret_key_2026"
        ) as { id: string };

        const usuario = await prisma.usuario.findUnique({
          where: { id: payload.id },
        });

        if (!usuario) {
          return reply.status(401).send({
            statusCode: 401,
            mensaje: "Usuario no encontrado",
          });
        }

        const nuevoToken = fastify.jwt.sign({
          id: usuario.id,
          correo: usuario.correo,
        });

        return reply.send({
          mensaje: "Token renovado con éxito",
          token: nuevoToken,
        });
      } catch (err) {
        return reply.status(401).send({
          statusCode: 401,
          mensaje: "Refresh token inválido o expirado",
        });
      }
    }
  );

  // 4. RUTA PROTEGIDA DE VERIFICACIÓN 
  fastify.get(
    "/verificar",
    { preHandler: [fastify.verificarToken] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        mensaje: "Token válido",
        usuarioAutenticado: request.user,
      });
    }
  );
};

export default authRoutes;