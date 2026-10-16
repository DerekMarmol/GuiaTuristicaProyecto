import type { MomentoLocal } from "../geoapify/horario";

export type { MomentoLocal };

export interface MomentoResuelto {
  instante: number;
  existe: boolean;
}

const PATRON_ZONA = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;
const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const PATRON_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MS_POR_MINUTO = 60_000;
const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  let formato = formateadores.get(zona);
  if (!formato) {
    formato = new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formateadores.set(zona, formato);
  }
  return formato;
}

export function esZonaHorariaValida(zona: unknown): zona is string {
  if (typeof zona !== "string" || !PATRON_ZONA.test(zona)) {
    return false;
  }
  try {
    formateador(zona);
    return true;
  } catch {
    return false;
  }
}

export function esFechaValida(fecha: unknown): fecha is string {
  const partes = typeof fecha === "string" ? PATRON_FECHA.exec(fecha) : null;
  if (!partes) {
    return false;
  }
  const [anio, mes, dia] = partes.slice(1).map(Number);
  const reloj = new Date(Date.UTC(anio, mes - 1, dia));
  return reloj.getUTCFullYear() === anio && reloj.getUTCMonth() === mes - 1 && reloj.getUTCDate() === dia;
}

export function esHoraValida(hora: unknown): hora is string {
  return typeof hora === "string" && PATRON_HORA.test(hora);
}

export function momentoEnZona(instante: number, zona: string): MomentoLocal {
  const partes = formateador(zona).formatToParts(new Date(instante));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((parte) => parte.type === tipo)?.value);
  return { anio: valor("year"), mes: valor("month"), dia: valor("day"), hora: valor("hour"), minuto: valor("minute") };
}

function relojUtc(momento: MomentoLocal): number {
  return Date.UTC(momento.anio, momento.mes - 1, momento.dia, momento.hora, momento.minuto);
}

function desplazamientoMs(instante: number, zona: string): number {
  const minuto = Math.floor(instante / MS_POR_MINUTO) * MS_POR_MINUTO;
  return relojUtc(momentoEnZona(minuto, zona)) - minuto;
}

export function resolverMomento(momento: MomentoLocal, zona: string): MomentoResuelto {
  const reloj = relojUtc(momento);
  const aproximado = reloj - desplazamientoMs(reloj, zona);
  const instante = reloj - desplazamientoMs(aproximado, zona);
  return { instante, existe: relojUtc(momentoEnZona(instante, zona)) === reloj };
}

export function momentoDesdeFechaHora(fecha: string, hora: string): MomentoLocal {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const [horas, minutos] = hora.split(":").map(Number);
  return { anio, mes, dia, hora: horas, minuto: minutos };
}

const dosDigitos = (valor: number) => String(valor).padStart(2, "0");

export function fechaDeMomento(momento: MomentoLocal): string {
  return `${String(momento.anio).padStart(4, "0")}-${dosDigitos(momento.mes)}-${dosDigitos(momento.dia)}`;
}

export function formatearInstante(instante: number, zona: string): string {
  const momento = momentoEnZona(instante, zona);
  const desplazamiento = Math.round(desplazamientoMs(instante, zona) / MS_POR_MINUTO);
  const signo = desplazamiento < 0 ? "-" : "+";
  const absoluto = Math.abs(desplazamiento);
  return (
    `${fechaDeMomento(momento)}T${dosDigitos(momento.hora)}:${dosDigitos(momento.minuto)}` +
    `${signo}${dosDigitos(Math.floor(absoluto / 60))}:${dosDigitos(absoluto % 60)}`
  );
}
