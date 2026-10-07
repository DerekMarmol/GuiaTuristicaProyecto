import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { declaracionCrearItinerario, NOMBRE_FUNCION } from "./schemas";

export interface ClienteLLM {
  generarPlan(args: { systemInstruction: string; prompt: string }): Promise<unknown>;
}

export function crearClienteGemini(apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash"): ClienteLLM {
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY en las variables de entorno.");
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generarPlan({ systemInstruction, prompt }) {
      const respuesta = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.4,
          tools: [{ functionDeclarations: [declaracionCrearItinerario] }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: [NOMBRE_FUNCION],
            },
          },
        },
      });
      const llamada = respuesta.functionCalls?.find((c) => c.name === NOMBRE_FUNCION);
      if (!llamada) throw new Error("Gemini no llamó a la función crear_itinerario.");
      return llamada.args;
    },
  };
}
