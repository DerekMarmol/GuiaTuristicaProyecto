import type { ClienteLLM } from "./cliente";
import { construirPrompt, SYSTEM_INSTRUCTION } from "./prompts";
import { validarSalida, verificarZonaHoraria, type ResultadoValidacion } from "./validator";
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
  /** Espera base (ms) antes de reintentar si falló la llamada al modelo (ej. 503). Crece con cada intento. */
  esperaReintentoMs?: number;
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function generarItinerarios({ viaje, candidatos, cliente, maxIntentos = 3, esperaReintentoMs = 2000 }: Params): Promise<ResultadoGeneracion> {
  if (candidatos.length === 0) {
    throw new ErrorGeneracionIA("No hay lugares reales para armar el itinerario.", []);
  }

  const errorZona = verificarZonaHoraria(viaje, candidatos);
  if (errorZona) {
    throw new ErrorGeneracionIA("No se pueden validar los horarios del itinerario.", [errorZona]);
  }

  let errores: string[] = [];
  let errorModelo: string | null = null;
  let ultimo: ResultadoValidacion | null = null;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    const prompt = construirPrompt(viaje, candidatos, errores);
    try {
      const raw = await cliente.generarPlan({ systemInstruction: SYSTEM_INSTRUCTION, prompt });
      ultimo = validarSalida(raw, candidatos, viaje);
      
      if (ultimo.errores.length === 0) {
        return { 
          itinerarios: ultimo.itinerarios, 
          intentos: intento, 
          advertencias: ultimo.advertencias,
          descartes: ultimo.descartes,
          diasSinParadas: ultimo.diasSinParadas,
        };
      }
      errores = ultimo.errores;
    } catch (e) {
      // Fallo del servicio (503, red, cuota...): no es culpa del plan, así que no se le pasa al modelo como error.
      errorModelo = `Error al llamar al modelo: ${e instanceof Error ? e.message : String(e)}`;
      if (intento < maxIntentos) await esperar(esperaReintentoMs * intento);
    }
  }

  if (ultimo?.viable) {
    return { 
      itinerarios: ultimo.itinerarios, 
      intentos: maxIntentos, 
      advertencias: [
        ...ultimo.errores,
        ...ultimo.advertencias,
      ],
      descartes: ultimo.descartes,
      diasSinParadas: ultimo.diasSinParadas,
    };
  }
  
  throw new ErrorGeneracionIA(
    `No se obtuvo un itinerario válido tras ${maxIntentos} intentos.`,
    errorModelo ? [errorModelo, ...errores] : errores
  );
}