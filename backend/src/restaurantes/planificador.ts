export type ResultadoTarea<R> =
  | { estado: "completada"; valor: R }
  | { estado: "fallida"; error: unknown }
  | { estado: "omitida"; causa: unknown };

export interface OpcionesPlanificador {
  concurrencia: number;
  intervaloMs: number;
  detenerTras: (error: unknown) => boolean;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ejecutarConLimite<T, R>(
  elementos: readonly T[],
  tarea: (elemento: T) => Promise<R>,
  { concurrencia, intervaloMs, detenerTras }: OpcionesPlanificador,
): Promise<ResultadoTarea<R>[]> {
  const resultados: ResultadoTarea<R>[] = new Array(elementos.length);
  let siguiente = 0;
  let proximoInicio = 0;
  let detenido = false;
  let causa: unknown;

  async function trabajador(): Promise<void> {
    while (siguiente < elementos.length) {
      const indice = siguiente++;
      if (!detenido) {
        const ahora = Date.now();
        const espera = proximoInicio - ahora;
        proximoInicio = Math.max(ahora, proximoInicio) + intervaloMs;
        if (espera > 0) {
          await esperar(espera);
        }
      }
      if (detenido) {
        resultados[indice] = { estado: "omitida", causa };
        continue;
      }
      try {
        resultados[indice] = { estado: "completada", valor: await tarea(elementos[indice]) };
      } catch (error) {
        resultados[indice] = { estado: "fallida", error };
        if (!detenido && detenerTras(error)) {
          detenido = true;
          causa = error;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrencia, elementos.length)) }, trabajador));
  return resultados;
}
