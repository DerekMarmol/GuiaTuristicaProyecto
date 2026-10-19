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

function interpreteVerificable(horario: Horario | null | undefined): OpeningHours | { motivo: MotivoAperturaDesconocida } {
  if (!horario || horario.estado !== "disponible" || typeof horario.valorOriginal !== "string") {
    return { motivo: horario && ESTADOS_NO_VERIFICABLES.has(horario.estado) ? (horario.estado as MotivoAperturaDesconocida) : "error_consulta" };
  }
  let interprete: OpeningHours | null;
  try {
    interprete = crearInterprete(horario.valorOriginal);
  } catch {
    interprete = null;
  }
  if (!interprete) {
    return { motivo: "no_interpretable" };
  }
  if (HORAS_SOLARES.test(horario.valorOriginal)) {
    return { motivo: "estado_desconocido" };
  }
  return interprete;
}

export interface VentanaApertura {
  inicioMinutos: number;
  finMinutos: number;
}

export type VentanasDelDia =
  | { estado: "disponible"; ventanas: VentanaApertura[] }
  | { estado: "desconocido"; motivo: MotivoAperturaDesconocida };

// Intervalos abiertos del día local indicado, en minutos desde la medianoche (el último puede terminar en 1440).
export function ventanasDelDia(horario: Horario | null | undefined, { anio, mes, dia }: Pick<MomentoLocal, "anio" | "mes" | "dia">): VentanasDelDia {
  const interprete = interpreteVerificable(horario);
  if (!(interprete instanceof OpeningHours)) {
    return { estado: "desconocido", motivo: interprete.motivo };
  }
  const inicioDia = fechaDesdeMomento({ anio, mes, dia, hora: 0, minuto: 0 });
  if (!inicioDia) {
    return { estado: "desconocido", motivo: "estado_desconocido" };
  }
  const finDia = new Date(anio, mes - 1, dia + 1);
  const minutosDe = (fecha: Date) =>
    fecha.getTime() >= finDia.getTime() ? 1440 : fecha.getTime() <= inicioDia.getTime() ? 0 : fecha.getHours() * 60 + fecha.getMinutes();
  try {
    const ventanas: VentanaApertura[] = [];
    for (const [desde, hasta, incierto] of interprete.getOpenIntervals(inicioDia, finDia)) {
      if (incierto) {
        return { estado: "desconocido", motivo: "estado_desconocido" };
      }
      const ventana = { inicioMinutos: minutosDe(desde), finMinutos: minutosDe(hasta) };
      if (ventana.finMinutos > ventana.inicioMinutos) {
        ventanas.push(ventana);
      }
    }
    return { estado: "disponible", ventanas };
  } catch {
    return { estado: "desconocido", motivo: "estado_desconocido" };
  }
}

export function evaluarApertura(horario: Horario | null | undefined, momento: MomentoLocal): EvaluacionApertura {
  const interprete = interpreteVerificable(horario);
  if (!(interprete instanceof OpeningHours)) {
    return desconocido(interprete.motivo);
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
