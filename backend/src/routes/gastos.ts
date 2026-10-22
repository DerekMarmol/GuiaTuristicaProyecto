import type { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "../../generated/prisma";
import { esquemaCrearGasto } from "../validacion/gasto";

const prisma = new PrismaClient();

export const rutasGastos: FastifyPluginAsync = async (app) => {
  // 1. POST /api/viajes/:viajeId/gastos -> Registrar un nuevo gasto real
  app.post<{
    Params: { viajeId: string };
  }>("/api/viajes/:viajeId/gastos", async (request, reply) => {
    const { viajeId } = request.params;

    // Verificar si el viaje existe
    const viaje = await prisma.viaje.findUnique({
      where: { id: viajeId },
    });

    if (!viaje) {
      return reply.status(404).send({
        codigo: "VIAJE_NO_ENCONTRADO",
        mensaje: "No se encontró el viaje especificado.",
      });
    }

    // Validar el cuerpo de la petición
    const resultadoValidacion = esquemaCrearGasto.safeParse(request.body);
    if (!resultadoValidacion.success) {
      return reply.status(400).send({
        codigo: "DATOS_INVALIDOS",
        mensaje: "Los datos del gasto no cumplen con el formato esperado.",
        detalles: resultadoValidacion.error.issues.map((i) => i.message),
      });
    }

    const { monto, categoria, paradaId, descripcion } = resultadoValidacion.data;

    // Si enviaron paradaId, verificar que pertenezca a este viaje
    if (paradaId) {
      const parada = await prisma.parada.findFirst({
        where: {
          id: paradaId,
          itinerario: { viajeId },
        },
      });

      if (!parada) {
        return reply.status(400).send({
          codigo: "PARADA_NO_VALIDA",
          mensaje: "La parada especificada no existe o no pertenece a este viaje.",
        });
      }
    }

    // Guardar el gasto en PostgreSQL
    const nuevoGasto = await prisma.gasto.create({
      data: {
        viajeId,
        monto,
        categoria,
        paradaId: paradaId ?? null,
        descripcion: descripcion ?? null,
      },
    });

    return reply.status(201).send({
      mensaje: "Gasto registrado exitosamente.",
      gasto: nuevoGasto,
    });
  });

  // 2. GET /api/viajes/:viajeId/gastos -> Obtener historial y total para el panel de presupuesto
  app.get<{
    Params: { viajeId: string };
  }>("/api/viajes/:viajeId/gastos", async (request, reply) => {
    const { viajeId } = request.params;

    const viaje = await prisma.viaje.findUnique({
      where: { id: viajeId },
      include: {
        gastos: {
          include: {
            parada: {
              select: { id: true, nombre: true },
            },
          },
          orderBy: { fecha: "desc" },
        },
      },
    });

    if (!viaje) {
      return reply.status(404).send({
        codigo: "VIAJE_NO_ENCONTRADO",
        mensaje: "No se encontró el viaje especificado.",
      });
    }

    const totalGastado = viaje.gastos.reduce((acum, g) => acum + g.monto, 0);
    const presupuestoRestante = viaje.presupuesto - totalGastado;

    return reply.send({
      presupuestoAsignado: viaje.presupuesto,
      totalGastado,
      presupuestoRestante,
      cantidadGastos: viaje.gastos.length,
      gastos: viaje.gastos,
    });
  });
};