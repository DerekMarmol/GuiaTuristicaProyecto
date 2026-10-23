import type { ClienteLLM } from "./cliente";
import { estadoHttp } from "./modelos";
import { construirPrompt, SYSTEM_INSTRUCTION } from "./prompts";
import { validarSalida, verificarZonaHoraria, type OpcionesValidacion, type ResultadoValidacion } from "./validator";
import type { LugarReal, ResultadoGeneracion, ViajeIA } from "./tipos";

// Por qué no se obtuvo el plan con IA: el generador lo usa para explicarle al usuario qué pasó.
export type MotivoFalloIA = "cuota_agotada" | "modelo_saturado" | "error_modelo" | "plan_invalido";

export class ErrorGeneracionIA extends Error {
  constructor(
    mensaje: string,
    public readonly detalles: string[],
    public readonly motivo: MotivoFalloIA = "plan_invalido"
  ) {
    super(mensaje);
    this.name = "ErrorGeneracionIA";
  }
}

// Con la cuota agotada reintentar solo gasta más solicitudes (el plan gratuito permite pocas al día). Con el
// modelo saturado vale la pena un reintento más, porque suele durar poco.
const MAX_INTENTOS_SATURADO = 2;

interface Params {
  viaje: ViajeIA;
  candidatos: LugarReal[];
  cliente: ClienteLLM;
  maxIntentos?: number;
  /** Espera base (ms) antes de reintentar si falló la llamada al modelo (ej. 503). Crece con cada intento. */
  esperaReintentoMs?: number;
  opcionesValidacion?: OpcionesValidacion;
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function generarItinerarios({ viaje, candidatos, cliente, maxIntentos = 3, esperaReintentoMs = 2000, opcionesValidacion }: Params): Promise<ResultadoGeneracion> {
  if (candidatos.length === 0) {
    throw new ErrorGeneracionIA("No hay lugares reales para armar el itinerario.", []);
  }

  const errorZona = verificarZonaHoraria(viaje, candidatos);
  if (errorZona) {
    throw new ErrorGeneracionIA("No se pueden validar los horarios del itinerario.", [errorZona]);
  }

  let errores: string[] = [];
  let errorModelo: string | null = null;
  let estadoModelo: number | null = null;
  let saturaciones = 0;
  let ultimo: ResultadoValidacion | null = null;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    const prompt = construirPrompt(viaje, candidatos, errores);
    try {
      const raw = await cliente.generarPlan({ systemInstruction: SYSTEM_INSTRUCTION, prompt });
      ultimo = validarSalida(raw, candidatos, viaje, opcionesValidacion);
      
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
      estadoModelo = estadoHttp(e);
      if (estadoModelo === 429) {
        throw new ErrorGeneracionIA("Se agotó la cuota de uso de la IA.", [errorModelo], "cuota_agotada");
      }
      if (estadoModelo === 503 && ++saturaciones >= MAX_INTENTOS_SATURADO) {
        break;
      }
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
  
  const motivo: MotivoFalloIA = !errorModelo ? "plan_invalido" : estadoModelo === 503 ? "modelo_saturado" : "error_modelo";
  throw new ErrorGeneracionIA(
    `No se obtuvo un itinerario válido tras ${maxIntentos} intentos.`,
    errorModelo ? [errorModelo, ...errores] : errores,
    motivo
  );
}