import type { LugarAbiertoAhora, RespuestaLugaresAbiertosAhora } from "../../../shared/types";

const RUTA = "/api/lugares/abiertos-ahora";

// Límites del backend (backend/src/config/abiertosAhora.ts).
export const RADIO_ABIERTOS_METROS = 2000;
export const LIMITE_ABIERTOS = 10;
// La búsqueda tarda como máximo 10 s y los horarios otros 10 s en el backend.
export const TIEMPO_ESPERA_ABIERTOS_MS = 25_000;

export interface ConsultaAbiertosAhora {
  lat: number;
  lng: number;
  radio?: number;
  limite?: number;
  intereses?: string[];
}

export class ErrorAbiertosAhora extends Error {
  codigo: string;
  estado: number;

  constructor(mensaje: string, codigo: string, estado: number) {
    super(mensaje);
    this.name = "ErrorAbiertosAhora";
    this.codigo = codigo;
    this.estado = estado;
  }
}

export function coordenadasValidas(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function esRespuestaValida(datos: unknown): datos is RespuestaLugaresAbiertosAhora {
  if (!datos || typeof datos !== "object") return false;
  const respuesta = datos as RespuestaLugaresAbiertosAhora;
  return Array.isArray(respuesta.lugares) && typeof respuesta.evaluadoEn === "string" && Boolean(respuesta.cobertura);
}

// Une la cancelación del llamador con un tiempo máximo de espera propio.
function senalConTiempo(senal: AbortSignal | undefined, tiempoMs: number) {
  const controlador = new AbortController();
  let agotado = false;
  const temporizador = setTimeout(() => {
    agotado = true;
    controlador.abort();
  }, tiempoMs);
  const abortar = () => controlador.abort();
  if (senal?.aborted) abortar();
  else senal?.addEventListener("abort", abortar, { once: true });
  return {
    signal: controlador.signal,
    agotado: () => agotado,
    liberar() {
      clearTimeout(temporizador);
      senal?.removeEventListener("abort", abortar);
    },
  };
}

export async function consultarAbiertosAhora(
  { lat, lng, radio = RADIO_ABIERTOS_METROS, limite = LIMITE_ABIERTOS, intereses = [] }: ConsultaAbiertosAhora,
  signal?: AbortSignal,
  { fetchImpl = fetch, tiempoEsperaMs = TIEMPO_ESPERA_ABIERTOS_MS }: { fetchImpl?: typeof fetch; tiempoEsperaMs?: number } = {},
): Promise<RespuestaLugaresAbiertosAhora> {
  if (!coordenadasValidas(lat, lng)) {
    throw new ErrorAbiertosAhora("La ubicación de referencia no es válida.", "COORDENADAS_INVALIDAS", 0);
  }

  // El backend solo acepta notación decimal simple (sin exponente).
  const parametros = new URLSearchParams({ lat: lat.toFixed(6), lng: lng.toFixed(6), radio: String(radio), limite: String(limite) });
  if (intereses.length > 0) parametros.set("intereses", intereses.join(","));

  const control = senalConTiempo(signal, tiempoEsperaMs);
  try {
    let respuesta: Response;
    try {
      respuesta = await fetchImpl(`${RUTA}?${parametros.toString()}`, { headers: { Accept: "application/json" }, signal: control.signal });
    } catch (error) {
      if (control.agotado()) throw new ErrorAbiertosAhora("El servidor tardó demasiado en responder.", "TIEMPO_AGOTADO", 0);
      if (signal?.aborted) throw error;
      throw new ErrorAbiertosAhora("No se pudo conectar con el servidor.", "SIN_CONEXION", 0);
    }

    const datos: unknown = await respuesta.json().catch(() => null);
    if (control.agotado()) throw new ErrorAbiertosAhora("El servidor tardó demasiado en responder.", "TIEMPO_AGOTADO", 0);
    if (!respuesta.ok) {
      const error = (datos as { error?: { mensaje?: string; codigo?: string } } | null)?.error;
      throw new ErrorAbiertosAhora(error?.mensaje ?? "No se pudieron consultar los lugares abiertos.", error?.codigo ?? "ERROR", respuesta.status);
    }
    if (!esRespuestaValida(datos)) {
      throw new ErrorAbiertosAhora("El servidor devolvió una respuesta inesperada.", "RESPUESTA_INVALIDA", respuesta.status);
    }
    return { ...datos, lugares: datos.lugares.filter((lugar) => lugar.open_now === true) };
  } finally {
    control.liberar();
  }
}

// Lugares con coordenadas válidas y sin repetir, en el orden recibido, para dibujarlos en el mapa.
export function lugaresParaMapa(lugares: readonly LugarAbiertoAhora[]): LugarAbiertoAhora[] {
  const vistos = new Set<string>();
  return lugares.filter((lugar) => {
    if (vistos.has(lugar.idExterno) || !coordenadasValidas(lugar.lat, lugar.lng)) return false;
    vistos.add(lugar.idExterno);
    return true;
  });
}

const CATEGORIAS: [prefijo: string, etiqueta: string][] = [
  ["entertainment.museum", "Museo"],
  ["entertainment.culture", "Cultura"],
  ["tourism.sights", "Sitio de interés"],
  ["tourism.attraction", "Atracción turística"],
  ["leisure.park", "Parque"],
  ["catering.restaurant", "Restaurante"],
  ["catering.cafe", "Cafetería"],
  ["catering", "Comida y bebida"],
  ["heritage", "Patrimonio"],
  ["natural", "Naturaleza"],
  ["commercial", "Comercio"],
  ["entertainment", "Entretenimiento"],
  ["beach", "Playa"],
];

export function etiquetaCategoria(categorias: readonly string[]): string {
  for (const [prefijo, etiqueta] of CATEGORIAS) {
    if (categorias.some((c) => c === prefijo || c.startsWith(`${prefijo}.`))) return etiqueta;
  }
  return "Lugar de interés";
}

export function formatearDistancia(metros: number): string {
  return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toLocaleString("es-GT", { maximumFractionDigits: 1 })} km`;
}

// El backend entrega la hora local del lugar con su desplazamiento (2026-10-19T16:00-06:00); se muestra tal cual.
export function horaDelLugar(instanteLocal: string | null): string | null {
  return instanteLocal ? /T(\d{2}:\d{2})/.exec(instanteLocal)?.[1] ?? null : null;
}
