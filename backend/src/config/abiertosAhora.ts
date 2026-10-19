// Búsqueda general de «Abierto ahora» cuando no se indican categoria ni intereses.
// Todas pertenecen a CATEGORIAS_PERMITIDAS; se excluyen hospedaje y gastronomía para no mezclar servicios con atracciones.
export const CATEGORIAS_TURISTICAS_PREDETERMINADAS: readonly string[] = Object.freeze([
  "tourism.attraction",
  "tourism.sights",
  "entertainment.museum",
  "entertainment.culture",
  "leisure.park",
]);

export const RADIO_PREDETERMINADO_ABIERTOS = 2000;
export const RADIO_MAXIMO_ABIERTOS = 10000;
export const LIMITE_PREDETERMINADO_ABIERTOS = 10;
export const LIMITE_MAXIMO_ABIERTOS = 20;

// Cada candidato cuesta una consulta a Place Details; con el ritmo de enriquecer.ts, 30 caben en el presupuesto de 10 s.
export const FACTOR_CANDIDATOS_ABIERTOS = 3;
export const MAX_CANDIDATOS_ABIERTOS = 30;

export const VIGENCIA_CACHE_APERTURA_MS = 30 * 60 * 1000;
export const MAX_ENTRADAS_CACHE_APERTURA = 1000;

export function limiteCandidatos(limite: number): number {
  return Math.min(MAX_CANDIDATOS_ABIERTOS, limite * FACTOR_CANDIDATOS_ABIERTOS);
}
