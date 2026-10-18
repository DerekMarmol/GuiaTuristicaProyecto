export type MedioTransporte =
  | "detenido"
  | "caminando"
  | "vehiculo"
  | "desconocido";

/**
 * Detecta el estado de movimiento según
 * la velocidad proporcionada por el GPS.
 */
export function detectarTransporte(
  velocidadKmh: number | null
): MedioTransporte {
  if (
    velocidadKmh === null ||
    !Number.isFinite(velocidadKmh) ||
    velocidadKmh < 0
  ) {
    return "desconocido";
  }

  if (velocidadKmh < 1) {
    return "detenido";
  }

  if (velocidadKmh <= 7) {
    return "caminando";
  }

  return "vehiculo";
}
