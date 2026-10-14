import OpeningHours, { type nominatim_object, type optional_conf } from "opening_hours";

const FUENTE = "geoapify";
const SIN_UBICACION = {} as nominatim_object;
const MODO_RANGOS_HORARIOS = 0;
const HORIZONTE_CAMBIO_MS = 2 * 24 * 60 * 60 * 1000;
const HORAS_SOLARES = /\b(sunrise|sunset|dawn|dusk)\b/i;
const ESTADOS_NO_VERIFICABLES = new Set<string>(["no_publicado", "no_interpretable", "error_consulta"]);

export type EstadoHorario = "disponible" | "no_publicado" | "no_interpretable" | "error_consulta";

export type Horario =
  | { estado: "disponible"; valorOriginal: string; fuente: typeof FUENTE }
  | { estado: "no_interpretable"; valorOriginal: string | null; fuente: typeof FUENTE }
  | { estado: "no_publicado" | "error_consulta"; valorOriginal: null; fuente: typeof FUENTE };

export interface MomentoLocal {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

export type MotivoAperturaDesconocida = "no_publicado" | "no_interpretable" | "error_consulta" | "estado_desconocido";

export type EvaluacionApertura =
  | { estado: "abierto"; cierre: MomentoLocal | null }
  | { estado: "cerrado" }
  | { estado: "desconocido"; motivo: MotivoAperturaDesconocida };

export function horarioErrorConsulta(): Horario {
  return { estado: "error_consulta", valorOriginal: null, fuente: FUENTE };
}

function crearInterprete(valor: string): OpeningHours | null {
  const horario = new OpeningHours(valor, SIN_UBICACION, { mode: MODO_RANGOS_HORARIOS } as optional_conf);
  return horario.getWarnings().length === 0 ? horario : null;
}

function expresionValida(valor: string): boolean {
  try {
    return crearInterprete(valor) !== null;
  } catch {
    return false;
  }
}

export function interpretarHorario(valor: unknown): Horario {
  if (valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "")) {
    return { estado: "no_publicado", valorOriginal: null, fuente: FUENTE };
  }
  if (typeof valor !== "string") {
    return { estado: "no_interpretable", valorOriginal: null, fuente: FUENTE };
  }
  if (!expresionValida(valor)) {
    return { estado: "no_interpretable", valorOriginal: valor, fuente: FUENTE };
  }
  return { estado: "disponible", valorOriginal: valor, fuente: FUENTE };
}

function fechaDesdeMomento({ anio, mes, dia, hora, minuto }: MomentoLocal): Date | null {
  const fecha = new Date(anio, mes - 1, dia, hora, minuto);
  const coincide =
    fecha.getFullYear() === anio &&
    fecha.getMonth() === mes - 1 &&
    fecha.getDate() === dia &&
    fecha.getHours() === hora &&
    fecha.getMinutes() === minuto;
  return coincide ? fecha : null;
}

function momentoDesdeFecha(fecha: Date): MomentoLocal {
  return {
    anio: fecha.getFullYear(),
    mes: fecha.getMonth() + 1,
    dia: fecha.getDate(),
    hora: fecha.getHours(),
    minuto: fecha.getMinutes(),
  };
}

function desconocido(motivo: MotivoAperturaDesconocida): EvaluacionApertura {
  return { estado: "desconocido", motivo };
}

export function evaluarApertura(horario: Horario | null | undefined, momento: MomentoLocal): EvaluacionApertura {
  if (!horario || horario.estado !== "disponible" || typeof horario.valorOriginal !== "string") {
    return desconocido(horario && ESTADOS_NO_VERIFICABLES.has(horario.estado) ? (horario.estado as MotivoAperturaDesconocida) : "error_consulta");
  }

  let interprete: OpeningHours | null;
  try {
    interprete = crearInterprete(horario.valorOriginal);
  } catch {
    interprete = null;
  }
  if (!interprete) {
    return desconocido("no_interpretable");
  }
  if (HORAS_SOLARES.test(horario.valorOriginal)) {
    return desconocido("estado_desconocido");
  }

  const fecha = fechaDesdeMomento(momento);
  if (!fecha) {
    return desconocido("estado_desconocido");
  }

  try {
    if (interprete.getUnknown(fecha)) {
      return desconocido("estado_desconocido");
    }
    if (!interprete.getState(fecha)) {
      return { estado: "cerrado" };
    }
    const cambio = interprete.getNextChange(fecha, new Date(fecha.getTime() + HORIZONTE_CAMBIO_MS));
    return { estado: "abierto", cierre: cambio ? momentoDesdeFecha(cambio) : null };
  } catch {
    return desconocido("estado_desconocido");
  }
}
