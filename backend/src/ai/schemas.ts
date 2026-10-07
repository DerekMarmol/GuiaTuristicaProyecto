import { z } from "zod";
import { Type, type FunctionDeclaration } from "@google/genai";

export const NOMBRE_FUNCION = "crear_itinerario";

export const MIN_ESTANCIA = 15;
export const MAX_ESTANCIA = 360;
export const MAX_PARADAS_POR_DIA = 5;

/**
 * Lo que la IA devuelve. A propósito NO incluye nombre, coordenadas ni horarios:
 * solo referencia lugares por placeId, y el resto se toma de los datos reales.
 */
export const ParadaIASchema = z.object({
  placeId: z.string().min(1),
  tiempoEstanciaMinutos: z.number().int().min(MIN_ESTANCIA).max(MAX_ESTANCIA),
  motivo: z.string().max(300).optional(),
});

export const DiaIASchema = z.object({
  numeroDia: z.number().int().min(1),
  paradas: z.array(ParadaIASchema).min(1),
});

export const SalidaIASchema = z.object({
  dias: z.array(DiaIASchema).min(1),
});

export type SalidaIA = z.infer<typeof SalidaIASchema>;

/** Declaración de la función que Gemini está obligado a llamar (function calling). */
export const declaracionCrearItinerario: FunctionDeclaration = {
  name: NOMBRE_FUNCION,
  description:
    "Registra el itinerario del viaje, organizado por día. Solo puede usar lugares de la lista de candidatos, referenciados por su placeId.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      dias: {
        type: Type.ARRAY,
        description: "Un elemento por cada día del viaje, en orden.",
        items: {
          type: Type.OBJECT,
          properties: {
            numeroDia: { type: Type.INTEGER, description: "Número de día, empezando en 1." },
            paradas: {
              type: Type.ARRAY,
              description: `Entre 1 y ${MAX_PARADAS_POR_DIA} paradas, en el orden sugerido.`,
              items: {
                type: Type.OBJECT,
                properties: {
                  placeId: {
                    type: Type.STRING,
                    description: "placeId EXACTO de un lugar de la lista de candidatos. Nunca inventarlo.",
                  },
                  tiempoEstanciaMinutos: {
                    type: Type.INTEGER,
                    description: `Minutos de visita (${MIN_ESTANCIA} a ${MAX_ESTANCIA}).`,
                  },
                  motivo: { type: Type.STRING, description: "Una frase: por qué encaja con el viaje." },
                },
                required: ["placeId", "tiempoEstanciaMinutos"],
              },
            },
          },
          required: ["numeroDia", "paradas"],
        },
      },
    },
    required: ["dias"],
  },
};
