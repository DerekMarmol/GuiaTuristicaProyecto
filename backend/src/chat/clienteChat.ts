import { GoogleGenAI, Type } from "@google/genai";

export interface ClienteChat {
  /** Devuelve el JSON (ya parseado) con la respuesta del asistente y los ajustes propuestos. */
  responder(args: { systemInstruction: string; prompt: string }): Promise<unknown>;
}

export function crearClienteChatGemini(
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash"
): ClienteChat {
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY en las variables de entorno.");
  const ai = new GoogleGenAI({ apiKey });

  return {
    async responder({ systemInstruction, prompt }) {
      const respuesta = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              respuesta: { type: Type.STRING, description: "Respuesta breve para el viajero, en español." },
              ajustes: {
                type: Type.ARRAY,
                description: "Cambios propuestos al plan. Vacío si el usuario solo conversa.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tipo: {
                      type: Type.STRING,
                      enum: ["quitar_parada", "cambiar_tiempo", "reordenar", "buscar_alternativa"],
                    },
                    paradaId: { type: Type.STRING, description: "id EXACTO de una parada de la lista." },
                    minutos: { type: Type.INTEGER, description: "Nuevos minutos de estancia (solo cambiar_tiempo)." },
                    motivo: { type: Type.STRING, description: "Una frase: por qué se propone." },
                  },
                  required: ["tipo", "motivo"],
                },
              },
            },
            required: ["respuesta", "ajustes"],
          },
        },
      });
      if (!respuesta.text) throw new Error("Gemini no devolvió texto.");
      return JSON.parse(respuesta.text);
    },
  };
}