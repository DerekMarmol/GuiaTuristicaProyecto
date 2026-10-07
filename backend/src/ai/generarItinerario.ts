import type { ClienteLLM } from "./cliente";
import { construirPrompt, SYSTEM_INSTRUCTION } from "./prompts";
import { validarSalida, type ResultadoValidacion } from "./validator";
import type { LugarReal, ResultadoGeneracion, ViajeIA } from "./tipos";

export class ErrorGeneracionIA extends Error {
  constructor(mensaje: string, public readonly detalles: string[]) {
    super(mensaje);
    this.name = "ErrorGeneracionIA";
  }
}

interface Params {
  viaje: ViajeIA;
  candidatos: LugarReal[];
  cliente: ClienteLLM;
  maxIntentos?: number;
}


export async function generarItinerarios({ viaje, candidatos, cliente, maxIntentos = 3 }: Params): Promise<ResultadoGeneracion> {
  if (candidatos.length === 0) {
    throw new ErrorGeneracionIA("No hay lugares reales para armar el itinerario.", []);
  }

  let errores: string[] = [];
  let ultimo: ResultadoValidacion | null = null;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    const prompt = construirPrompt(viaje, candidatos, errores);
    try {
      const raw = await cliente.generarPlan({ systemInstruction: SYSTEM_INSTRUCTION, prompt });
      ultimo = validarSalida(raw, candidatos, viaje);
      if (ultimo.errores.length === 0) {
        return { itinerarios: ultimo.itinerarios, intentos: intento, advertencias: [] };
      }
      errores = ultimo.errores;
    } catch (e) {
      errores = [`Error al llamar al modelo: ${e instanceof Error ? e.message : String(e)}`];
    }
  }

  if (ultimo?.viable) {
    return { itinerarios: ultimo.itinerarios, intentos: maxIntentos, advertencias: ultimo.errores };
  }
  throw new ErrorGeneracionIA(`No se obtuvo un itinerario válido tras ${maxIntentos} intentos.`, errores);
}
