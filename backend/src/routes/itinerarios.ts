import type { FastifyPluginAsync } from "fastify";
import { ErrorApi } from "../errores";
import type { ResultadoPropuesta } from "../ai/propuesta";
import type { ResultadoPrioridadClima } from "../ai/prioridadClima";
import type { GenerarItinerario } from "../itinerarios/generacion";
import { validarSolicitudGeneracion } from "../validacion/generacion";
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

export function crearRutaItinerarios(
  validarPropuesta: ValidarPropuesta,
  priorizarPorClima: PriorizarPorClima,
  generarItinerario: GenerarItinerario,
): FastifyPluginAsync {
  return async (app) => {
    // Lo que se relanza aquí lo atiende el manejador de errores general de la aplicación.
    app.setErrorHandler((err) => {
      if (esErrorCuerpo(err)) {
        throw new ErrorApi(400, "PARAMETRO_INVALIDO", "El cuerpo de la solicitud debe ser un JSON válido de hasta 100 KB.");
      }
      throw err;
    });

    app.post("/generar", { bodyLimit: LIMITE_CUERPO_BYTES }, async (req) => {
      return generarItinerario(validarSolicitudGeneracion(req.body));
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
    // GET /:id/exportar
    app.get(
      "/:id/exportar",
      { preHandler: [app.verificarToken] },
      async (req, reply) => {
        const { id } = req.params as { id: string };

        if (!id) {
          return reply.status(400).send({
            statusCode: 400,
            mensaje: "El ID del plan es requerido para la exportación",
          });
        }

        // Consultar el plan con todos sus días, paradas y restricciones
        const viaje = await prisma.viaje.findUnique({
          where: { id },
          include: {
            itinerarios: {
              orderBy: { numeroDia: "asc" },
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

        if (!viaje) {
          return reply.status(404).send({
            statusCode: 404,
            mensaje: "No se encontró ningún plan de viaje con ese ID",
          });
        }

        // Estructurar el archivo exportable con días, paradas, horarios y notas
        const exportacion = {
          metadatos: {
            sistema: "GuiaTuristicaProyecto",
            version: "1.0",
            fechaExportacion: new Date().toISOString(),
          },
          viaje: {
            id: viaje.id,
            destino: viaje.destino,
            tipoViaje: viaje.tipoViaje,
            presupuesto: viaje.presupuesto,
            transporte: viaje.transporte,
            fechaInicio: viaje.fechaInicio,
            fechaFin: viaje.fechaFin,
            coordenadas: {
              lat: viaje.lat,
              lng: viaje.lng,
            },
            intereses: viaje.intereses,
            notasGenerales: [
              viaje.nombreHotel ? `Hospedaje asignado: ${viaje.nombreHotel}` : "Hospedaje no asignado",
              `Tipo de grupo: ${viaje.tipoViaje}`,
              `Medio de transporte: ${viaje.transporte}`,
            ],
            totalDias: viaje.itinerarios.length,
            dias: viaje.itinerarios.map((it) => ({
              numeroDia: it.numeroDia,
              fecha: it.fecha,
              totalParadas: it.paradas.length,
              notasDia: `Itinerario programado para el día ${it.numeroDia}`,
              paradas: it.paradas.map((p) => ({
                id: p.id,
                lugar: p.nombre,
                coordenadas: { lat: p.lat, lng: p.lng },
                horarios: {
                  apertura: p.horaApertura || "N/A",
                  cierre: p.horaCierre || "N/A",
                  estanciaMinutos: p.tiempoEstanciaMinutos,
                },
                restriccionClima: p.restriccion
                  ? {
                      entorno: p.restriccion.tipoEntorno,
                      sensibilidad: p.restriccion.sensibilidadClima,
                    }
                  : null,
                placeId: p.placeId,
                notasParada: p.restriccion?.tipoEntorno
                  ? `Visita en entorno ${p.restriccion.tipoEntorno}`
                  : "Sin notas adicionales",
              })),
            })),
          },
        };

        const nombreSeguro = viaje.destino.toLowerCase().replace(/[^a-z0-9]/gi, "_");
        const nombreArchivo = `itinerario_${nombreSeguro}_${viaje.id.slice(0, 8)}.json`;

        reply.header("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
        reply.type("application/json");

        return reply.send(JSON.stringify(exportacion, null, 2));
      }
    );

  };
}
