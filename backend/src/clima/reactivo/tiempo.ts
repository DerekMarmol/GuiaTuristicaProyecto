import { fechaLocal } from "../fechas";

const SEGUNDOS_POR_DIA = 86400;

export interface RelojLocal {
  fecha: string;
  minutos: number;
  desplazamientoUtcSegundos: number;
  medianocheUtcSegundos: number;
}

// La hora del destino sale del desplazamiento que informa OpenWeather, no de la zona horaria del servidor.
export function relojLocal(ahora: Date, desplazamientoUtcSegundos: number): RelojLocal {
  const ahoraS = Math.floor(ahora.getTime() / 1000);
  const segundosDelDia = (((ahoraS + desplazamientoUtcSegundos) % SEGUNDOS_POR_DIA) + SEGUNDOS_POR_DIA) % SEGUNDOS_POR_DIA;
  return {
    fecha: fechaLocal(ahoraS, desplazamientoUtcSegundos),
    minutos: Math.floor(segundosDelDia / 60),
    desplazamientoUtcSegundos,
    medianocheUtcSegundos: ahoraS - segundosDelDia,
  };
}

export function minutosLocales(instante: string, reloj: RelojLocal): number {
  return Math.floor((Date.parse(instante) / 1000 - reloj.medianocheUtcSegundos) / 60);
}

export function aMinutos(hora: string): number {
  const [horas, minutos] = hora.split(":").map(Number);
  return horas * 60 + minutos;
}

export function formatearHora(minutos: number): string {
  const acotados = Math.max(0, Math.min(1440, Math.round(minutos)));
  return `${String(Math.floor(acotados / 60)).padStart(2, "0")}:${String(acotados % 60).padStart(2, "0")}`;
}

export function componentesFecha(fecha: string): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return { anio, mes, dia };
}
