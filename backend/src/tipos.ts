export type FuncionFetch = (url: URL, opciones?: RequestInit) => Promise<Response>;

export type Consulta = Record<string, unknown>;

export interface ErrorParametro {
  parametro: string;
  mensaje: string;
}

export function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}
