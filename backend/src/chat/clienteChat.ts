import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { crearCadenaDeModelos, leerModelos } from "../ai/modelos";

export interface HerramientaChat {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
  ejecutar(args: Record<string, unknown>): Promise<unknown>;
}

export interface ClienteChat {
  responder(args: { systemInstruction: string; prompt: string; herramientas: HerramientaChat[] }): Promise<string>;
}

const MAX_RONDAS_HERRAMIENTAS = 4;

export function crearClienteChatGemini(
  apiKey = process.env.GEMINI_API_KEY,
  modelos = leerModelos()
): ClienteChat {
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY en las variables de entorno.");
  const ai = new GoogleGenAI({ apiKey });
  const conCadenaDeModelos = crearCadenaDeModelos(modelos);

  return {
    // Toda la conversación usa un mismo modelo: el turno del modelo lleva firmas de razonamiento que otro modelo
    // no acepta. Solo se cambia de modelo si falla la primera llamada, antes de ejecutar herramientas.
    responder: (args) => conCadenaDeModelos((model) => responderCon(model, args)),
  };

  async function responderCon(model: string, { systemInstruction, prompt, herramientas }: Parameters<ClienteChat["responder"]>[0]): Promise<string> {
    const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
    let usoHerramientas = false;
    const generar = async (parametros: Parameters<typeof ai.models.generateContent>[0]) => {
      try {
        return await ai.models.generateContent(parametros);
      } catch (error) {
        // Repetir la conversación con otro modelo duplicaría los ajustes ya propuestos: el error ya no pasa al siguiente.
        if (usoHerramientas) throw new Error("Gemini falló a mitad de la conversación.", { cause: error });
        throw error;
      }
    };
    const tools = [
      {
        functionDeclarations: herramientas.map((h) => ({
          name: h.nombre,
          description: h.descripcion,
          parametersJsonSchema: h.parametros,
        })),
      },
    ];

    for (let ronda = 0; ronda < MAX_RONDAS_HERRAMIENTAS; ronda++) {
      const respuesta = await generar({
        model,
        contents,
        config: { systemInstruction, temperature: 0.4, tools },
      });

      const llamadas = respuesta.functionCalls ?? [];
      if (llamadas.length === 0) {
        if (!respuesta.text) throw new Error("Gemini no devolvió texto.");
        return respuesta.text;
      }

      // Se devuelve tal cual el turno del modelo (incluye sus firmas de razonamiento).
      const turnoModelo = respuesta.candidates?.[0]?.content;
      if (!turnoModelo) throw new Error("Gemini no devolvió el turno con las llamadas a herramientas.");
      contents.push(turnoModelo);

      const resultados: Part[] = [];
      for (const llamada of llamadas) {
        const herramienta = herramientas.find((h) => h.nombre === llamada.name);
        let resultado: unknown;
        try {
          resultado = herramienta
            ? await herramienta.ejecutar((llamada.args ?? {}) as Record<string, unknown>)
            : { ok: false, error: `La herramienta ${llamada.name} no existe.` };
        } catch {
          resultado = { ok: false, error: "La herramienta falló al ejecutarse." };
        }
        resultados.push({
          functionResponse: { id: llamada.id, name: llamada.name, response: { resultado } },
        });
      }
      contents.push({ role: "user", parts: resultados });
      usoHerramientas = true;
    }

    const cierre = await generar({
      model,
      contents,
      config: { systemInstruction, temperature: 0.4 },
    });
    if (!cierre.text) throw new Error("Gemini no devolvió texto.");
    return cierre.text;
  }
}