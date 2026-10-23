// Cadena de modelos de Gemini: la cuota gratuita es por modelo, así que cuando uno responde «límite alcanzado»
// (429) se prueba el siguiente de la lista antes de rendirse. GEMINI_MODEL acepta uno o varios separados por comas.

export const MODELO_PREDETERMINADO = "gemini-3.8-flash";

// Tras un 429 el modelo se salta durante este tiempo, para no gastar una solicitud en cada consulta sabiendo
// que va a fallar. Un minuto cubre el límite por minuto; si lo agotado era la cuota del día, se vuelve a saltar.
const PAUSA_TRAS_LIMITE_MS = 60_000;

export function leerModelos(valor = process.env.GEMINI_MODEL): string[] {
  const modelos = (valor ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return modelos.length > 0 ? [...new Set(modelos)] : [MODELO_PREDETERMINADO];
}

// Código HTTP de un error de Gemini: el SDK lo da en `status` y además viene en el mensaje ("code":429).
export function estadoHttp(error: unknown): number | null {
  const estado = (error as { status?: unknown } | null)?.status;
  if (typeof estado === "number") return estado;
  const texto = error instanceof Error ? error.message : String(error);
  const encontrado = /"code"\s*:\s*(\d{3})/.exec(texto) ?? /(429|503)/.exec(texto);
  return encontrado ? Number(encontrado[1]) : null;
}

// 429: cuota del modelo agotada. 404: el nombre del modelo no existe (o ya no está disponible).
const pasarAlSiguiente = (estado: number | null) => estado === 429 || estado === 404;

export type ConCadenaDeModelos = <T>(llamar: (modelo: string) => Promise<T>) => Promise<T>;

// Llama con el primer modelo disponible; ante un 429 o 404 sigue con el próximo. Cualquier otro error se
// relanza tal cual. Si todos están agotados, se relanza el error del último (un 429), y quien llama lo trata
// como cuota agotada.
export function crearCadenaDeModelos(modelos: string[], ahora: () => number = Date.now): ConCadenaDeModelos {
  const pausadosHasta = new Map<string, number>();

  return async function conCadenaDeModelos(llamar) {
    const disponibles = modelos.filter((m) => (pausadosHasta.get(m) ?? 0) <= ahora());
    let ultimoError: unknown = null;
    for (const modelo of disponibles) {
      try {
        return await llamar(modelo);
      } catch (error) {
        const estado = estadoHttp(error);
        if (!pasarAlSiguiente(estado)) throw error;
        if (estado === 429) pausadosHasta.set(modelo, ahora() + PAUSA_TRAS_LIMITE_MS);
        console.warn(`Gemini ${modelo} respondió ${estado}; se prueba el siguiente modelo de GEMINI_MODEL.`);
        ultimoError = error;
      }
    }
    throw ultimoError ?? Object.assign(new Error("Todos los modelos de GEMINI_MODEL agotaron su cuota."), { status: 429 });
  };
}
