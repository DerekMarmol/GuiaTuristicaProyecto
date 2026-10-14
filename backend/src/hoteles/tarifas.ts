import type { TarifaHotel } from "./catalogo";

export const PORCENTAJE_HOSPEDAJE = 40;

export interface CondicionesTarifa {
  fecha: string;
  moneda: string;
  ocupacion: number;
  presupuestoHospedajeCentavos: number;
}

export function aCentavos(quetzales: number): number | null {
  const centavos = Math.round(quetzales * 100);
  if (!Number.isSafeInteger(centavos) || Math.abs(quetzales * 100 - centavos) > 1e-6) {
    return null;
  }
  return centavos;
}

export function calcularPresupuestoHospedajeCentavos(presupuestoDiarioCentavos: number): number {
  return Math.floor((presupuestoDiarioCentavos * PORCENTAJE_HOSPEDAJE) / 100);
}

export function tarifaAplica(tarifa: TarifaHotel, { fecha, moneda, ocupacion }: Omit<CondicionesTarifa, "presupuestoHospedajeCentavos">): boolean {
  return (
    tarifa.moneda === moneda &&
    tarifa.unidad === "habitacion_noche" &&
    tarifa.ocupacion === ocupacion &&
    tarifa.importeTotal === true &&
    tarifa.impuestosIncluidos === true &&
    tarifa.vigenciaDesde <= fecha &&
    fecha <= tarifa.vigenciaHasta
  );
}

function esMasEconomica(candidata: TarifaHotel, actual: TarifaHotel): boolean {
  if (candidata.importeCentavos !== actual.importeCentavos) {
    return candidata.importeCentavos < actual.importeCentavos;
  }
  return candidata.id < actual.id;
}

export function seleccionarTarifas(tarifas: readonly TarifaHotel[], condiciones: CondicionesTarifa): Map<string, TarifaHotel> {
  const seleccion = new Map<string, TarifaHotel>();
  for (const tarifa of tarifas) {
    if (!tarifaAplica(tarifa, condiciones) || tarifa.importeCentavos > condiciones.presupuestoHospedajeCentavos) {
      continue;
    }
    const actual = seleccion.get(tarifa.idExterno);
    if (!actual || esMasEconomica(tarifa, actual)) {
      seleccion.set(tarifa.idExterno, tarifa);
    }
  }
  return seleccion;
}
