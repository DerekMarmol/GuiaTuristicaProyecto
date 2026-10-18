import { formatearFecha, interpretarFecha } from "../clima/fechas";

export const NOCHES_POR_SOLICITUD = 1;
export const NINOS_POR_SOLICITUD = 0;
const MS_POR_DIA = 86_400_000;

export function fechaSalida(fecha: string): string | null {
  const numero = interpretarFecha(fecha);
  if (numero === null) {
    return null;
  }
  const salida = formatearFecha(numero + NOCHES_POR_SOLICITUD);
  return interpretarFecha(salida) === null ? null : salida;
}

export function fechaMinimaEntrada(ahora: Date): number {
  return Math.floor(ahora.getTime() / MS_POR_DIA) - 1;
}

export function esFechaPasadaEnTodasLasZonas(fecha: string, ahora: Date): boolean {
  const numero = interpretarFecha(fecha);
  return numero !== null && numero < fechaMinimaEntrada(ahora);
}
