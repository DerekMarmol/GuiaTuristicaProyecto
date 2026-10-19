import type { FastifyPluginAsync } from "fastify";
import { ErrorApi } from "../errores";
import type { ResultadoPropuesta } from "../ai/propuesta";
import type { ResultadoPrioridadClima } from "../ai/prioridadClima";
import { PrismaClient } from "../../generated/prisma";

const prisma = new PrismaClient();
const LIMITE_CUERPO_BYTES = 100 * 1024;

// Errores del analizador de cuerpo de Fastify que se informan como parámetros inválidos.
const ERRORES_CUERPO = new Set([
  "FST_ERR_CTP_INVALID_JSON_BODY",
  "FST_ERR_CTP_EMPTY_JSON_BODY",
  "FST_ERR_CTP_BODY_TOO_LARGE",
  "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
  "FST_ERR_CTP_INVALID_MEDIA_TYPE",
]);

export type ValidarPropuesta = (cuerpo: unknown) => Promise<ResultadoPropuesta>;
export type PriorizarPorClima = (cuerpo: unknown) => Promise<ResultadoPrioridadClima>;

function esErrorCuerpo(err: unknown): boolean {
  return err instanceof Error && "code" in err && typeof err.code === "string" && ERRORES_CUERPO.has(err.code);
}

export function crearRutaItinerarios(validarPropuesta: ValidarPropuesta, priorizarPorClima: PriorizarPorClima): FastifyPluginAsync {
  return async (app) => {
    // Lo que se relanza aquí lo atiende el manejador de errores general de la aplicación.
    app.setErrorHandler((err) => {
      if (esErrorCuerpo(err)) {
        throw new ErrorApi(400, "PARAMETRO_INVALIDO", "El cuerpo de la solicitud debe ser un JSON válido de hasta 100 KB.");
      }
      throw err;
    });

    app.post("/validar", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => {
      const resultado = await validarPropuesta(req.body);
      if (!resultado.valido) {
        throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La propuesta de itinerario no es válida.", resultado.detalles);
      }
      return resultado.plan;
    });
// Guarda  plan el de viaje e itinerario completo
    app.post("/priorizar-clima", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => {
      const resultado = await priorizarPorClima(req.body);
      if (!resultado.valido) {
        throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La propuesta de itinerario no es válida.", resultado.detalles);
      }
      return resultado.plan;
    });
    app.post(
      "/guardar",
      { preHandler: [app.verificarToken] },
      async (req, reply) => {
        const usuarioSesion = req.user as { id: string; correo: string };
        const body = (req.body as any) || {};
        const plan = body.plan || body;

        const destino = plan.destino || body.destino;
        if (!destino) {
          return reply.status(400).send({
            statusCode: 400,
            mensaje: "El destino del viaje es requerido para guardar el plan",
          });
        }

        const dias = Array.isArray(plan.dias)
          ? plan.dias
          : Array.isArray(plan.itinerarios)
          ? plan.itinerarios
          : [];

        if (dias.length === 0) {
          return reply.status(400).send({
            statusCode: 400,
            mensaje: "El plan debe contener al menos un día con paradas en el itinerario",
          });
        }

        // Es para obtener las fechas y coordenadas base
        const fechaInicio = plan.fechaInicio ? new Date(plan.fechaInicio) : new Date();
        const fechaFin = plan.fechaFin ? new Date(plan.fechaFin) : new Date(Date.now() + 86400000 * dias.length);
        const primeraParada = dias[0]?.paradas?.[0];
        const lat = typeof plan.lat === "number" ? plan.lat : (primeraParada?.lat ?? 0);
        const lng = typeof plan.lng === "number" ? plan.lng : (primeraParada?.lng ?? 0);

        // Guardado anidado en PostgreSQL con Prisma
        const nuevoViaje = await prisma.viaje.create({
          data: {
            destino,
            tipoViaje: plan.tipoViaje || "solo",
            lat,
            lng,
            presupuesto: plan.presupuesto ?? 0,
            transporte: plan.transporte || "Automovil",
            intereses: plan.intereses || [],
            fechaInicio,
            fechaFin,
            hospedaje: plan.hospedaje ?? false,
            nombreHotel: plan.nombreHotel || null,
            usuarioId: usuarioSesion.id,
            itinerarios: {
              create: dias.map((dia: any, index: number) => ({
                numeroDia: dia.numeroDia ?? index + 1,
                fecha: dia.fecha ? new Date(dia.fecha) : fechaInicio,
                paradas: {
                  create: (dia.paradas || []).map((p: any) => ({
                    nombre: p.nombre,
                    lat: p.lat,
                    lng: p.lng,
                    horaApertura: p.horaApertura || "08:00",
                    horaCierre: p.horaCierre || "18:00",
                    tiempoEstanciaMinutos: p.tiempoEstanciaMinutos ?? 60,
                    placeId: p.placeId || null,
                    ...(p.restriccion
                      ? {
                          restriccion: {
                            create: {
                              tipoEntorno: p.restriccion.tipoEntorno || "Al aire libre",
                              sensibilidadClima: p.restriccion.sensibilidadClima || "media",
                            },
                          },
                        }
                      : {}),
                  })),
                },
              })),
            },
          },
          include: {
            itinerarios: {
              include: {
                paradas: {
                  include: {
                    restriccion: true,
                  },
                },
              },
            },
          },
        });

        return reply.status(201).send({
          mensaje: "Plan de viaje e itinerario guardados exitosamente",
          id: nuevoViaje.id,
          viajeId: nuevoViaje.id,
          viaje: nuevoViaje,
        });
      }
    );
  };
}
