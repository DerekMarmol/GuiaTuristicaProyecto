import OpeningHours, { type nominatim_object, type optional_conf } from "opening_hours";

const FUENTE = "geoapify";
const SIN_UBICACION = {} as nominatim_object;
const MODO_RANGOS_HORARIOS = 0;

export type EstadoHorario = "disponible" | "no_publicado" | "no_interpretable" | "error_consulta";

export interface Horario {
  estado: EstadoHorario;
  valorOriginal: string | null;
  fuente: typeof FUENTE;
}

function crearHorario(estado: EstadoHorario, valorOriginal: string | null): Horario {
  return { estado, valorOriginal, fuente: FUENTE };
}

export function horarioErrorConsulta(): Horario {
  return crearHorario("error_consulta", null);
}

function expresionValida(valor: string): boolean {
  try {
    const horario = new OpeningHours(valor, SIN_UBICACION, { mode: MODO_RANGOS_HORARIOS } as optional_conf);
    return horario.getWarnings().length === 0;
  } catch {
    return false;
  }
}

export function interpretarHorario(valor: unknown): Horario {
  if (valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "")) {
    return crearHorario("no_publicado", null);
  }
  if (typeof valor !== "string") {
    return crearHorario("no_interpretable", null);
  }
  if (!expresionValida(valor)) {
    return crearHorario("no_interpretable", valor);
  }
  return crearHorario("disponible", valor);
}
