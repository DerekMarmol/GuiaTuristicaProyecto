import type { FastifyPluginAsync } from "fastify";
import {
  recalcularEta,
  recalcularEtasItinerario,
  type SolicitudRecalculoEta,
  type TramoItinerario,
} from "./recalcularEta";

interface CuerpoRecalculoEta {
  horaActual: string;
  tiempoTranscurridoMinutos: number;
  tiempoTrasladoPrevistoMinutos: number;
  tramos: TramoItinerario[];
}

export const rutaEta: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CuerpoRecalculoEta }>(
    "/recalcular-eta",
    {
      schema: {
        body: {
          type: "object",
          required: [
            "horaActual",
            "tiempoTranscurridoMinutos",
            "tiempoTrasladoPrevistoMinutos",
            "tramos",
          ],
          additionalProperties: false,
          properties: {
            horaActual: { type: "string" },
            tiempoTranscurridoMinutos: {
              type: "number",
              minimum: 0,
            },
            tiempoTrasladoPrevistoMinutos: {
              type: "number",
              minimum: 0,
            },
            tramos: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "paradaId",
                  "tiempoTrasladoMinutos",
                  "tiempoEstanciaMinutos",
                ],
                additionalProperties: false,
                properties: {
                  paradaId: { type: "string", minLength: 1 },
                  tiempoTrasladoMinutos: {
                    type: "number",
                    minimum: 0,
                  },
                  tiempoEstanciaMinutos: {
                    type: "number",
                    minimum: 0,
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const {
        horaActual,
        tiempoTranscurridoMinutos,
        tiempoTrasladoPrevistoMinutos,
        tramos,
      } = request.body;

      const solicitud: SolicitudRecalculoEta = {
        horaActual,
        tiempoTranscurridoMinutos,
        tiempoTrasladoPrevistoMinutos,
      };

      try {
        const resultado = recalcularEta(solicitud);

        const proximasParadas = recalcularEtasItinerario(
          resultado.etaActualizada,
          tramos
        );

        return {
          ...resultado,
          proximasParadas,
        };
      } catch {
        return reply.code(400).send({
          error: "Datos inválidos para recalcular la ETA.",
        });
      }
    }
  );
};
