import { z } from "zod";
import { ErrorApi } from "../errores";
import type { LlamarOptimizador } from "../optimizador/cliente";

export interface ParadaOptimizador {
  id: string;
  lat: number;
  lng: number;
  horaApertura: string;
  horaCierre: string;
  tiempoEstanciaMinutos: number;
}

export type ResultadoReoptimizacion =
  | { alcanza: true; ordenOptimo: string[]; distanciaTotalKm: number }
  | { alcanza: false; detalle: string };

export interface ClienteOptimizador {
  reoptimizar(args: { paradas: ParadaOptimizador[]; horaActualMinutos: number }): Promise<ResultadoReoptimizacion>;
}

export class ErrorOptimizador extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorOptimizador";
  }
}

const RespuestaSchema = z.object({
  orden_optimo: z.array(z.string()),
  distancia_total_km: z.number(),
});


export function crearReoptimizadorChat(llamarOptimizador: LlamarOptimizador): ClienteOptimizador {
  return {
    async reoptimizar({ paradas, horaActualMinutos }) {
      let datos: unknown;
      try {
        datos = await llamarOptimizador("/reoptimize", {
          paradas: paradas.map((p) => ({
            id: p.id,
            lat: p.lat,
            lng: p.lng,
            hora_apertura: p.horaApertura,
            hora_cierre: p.horaCierre,
            tiempo_estancia_minutos: p.tiempoEstanciaMinutos,
          })),
          hora_actual_minutos: horaActualMinutos,
        });
      } catch (err) {
        if (err instanceof ErrorApi && err.codigo === "REOPTIMIZACION_NO_DISPONIBLE") {
          return { alcanza: false, detalle: err.message };
        }
        throw new ErrorOptimizador(err instanceof ErrorApi ? err.message : "No fue posible consultar al optimizador.");
      }

      const parsed = RespuestaSchema.safeParse(datos);
      if (!parsed.success) throw new ErrorOptimizador("El optimizador devolvió una respuesta inválida.");
      return { alcanza: true, ordenOptimo: parsed.data.orden_optimo, distanciaTotalKm: parsed.data.distancia_total_km };
    },
  };
}