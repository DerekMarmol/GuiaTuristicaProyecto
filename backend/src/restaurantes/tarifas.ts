export const PORCENTAJE_ALIMENTACION = 30;
export const COMIDAS_PRINCIPALES_POR_DIA = 1;

export function calcularPresupuestoAlimentacionCentavos(presupuestoDiarioCentavos: number): number {
  return Math.floor((presupuestoDiarioCentavos * PORCENTAJE_ALIMENTACION) / 100);
}

export function calcularPresupuestoPorPersonaCentavos(presupuestoAlimentacionCentavos: number, comensales: number): number {
  return Math.floor(presupuestoAlimentacionCentavos / comensales);
}

export function calcularCostoGrupoCentavos(precioPorPersonaCentavos: number, comensales: number): number | null {
  if (!Number.isSafeInteger(precioPorPersonaCentavos) || precioPorPersonaCentavos <= 0 || !Number.isSafeInteger(comensales) || comensales <= 0) {
    return null;
  }
  const costo = precioPorPersonaCentavos * comensales;
  return Number.isSafeInteger(costo) ? costo : null;
}

export function cabeEnPresupuesto(costoGrupoCentavos: number | null, presupuestoAlimentacionCentavos: number): costoGrupoCentavos is number {
  return costoGrupoCentavos !== null && costoGrupoCentavos <= presupuestoAlimentacionCentavos;
}
