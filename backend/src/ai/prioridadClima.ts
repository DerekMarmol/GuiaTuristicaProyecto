import { z } from "zod";
import type { ClasificacionClima, ConsultaClimaPrioridad, DecisionClimaDia, ResumenPrioridadClima } from "../../../shared/types";
import { clasificarEntorno } from "../clima/clasificacion";
import { priorizarPorClima, type PronosticoDia } from "../clima/priorizacion";
import type { ConsultarClima } from "../clima/servicio";
import { ErrorApi } from "../errores";
import { diasEntre, sumarDias } from "./fechas";
import {
  PropuestaBaseSchema,
  construirPlan,
  detallesInvalidos,
  refinarPropuesta,
  resolverCandidatos,
  type DetalleParametro,
  type PlanValidado,
  type ResolverLugares,
} from "./propuesta";
import type { ItinerarioIA, ParadaIA } from "./tipos";
import type { EstimadorTraslado } from "./validacionApertura";
import { validarSalida } from "./validator";

export type ParadaPriorizada = ParadaIA & ClasificacionClima;

export type ItinerarioPriorizado = Omit<ItinerarioIA, "paradas"> & { paradas: ParadaPriorizada[] };

export type PlanPriorizado = Omit<PlanValidado, "itinerarios"> & {
  itinerarios: ItinerarioPriorizado[];
  clima: ResumenPrioridadClima;
};

export type ResultadoPrioridadClima =
  | { valido: true; plan: PlanPriorizado }
  | { valido: false; detalles: DetalleParametro[] };

type ConsultaPronostico =
  | { consulta: { estado: "completada" }; dias: Map<string, PronosticoDia> }
  | { consulta: Extract<ConsultaClimaPrioridad, { estado: "fallida" }>; dias: null };

const PropuestaClimaSchema = PropuestaBaseSchema.extend({
  destino: z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  }),
}).superRefine(refinarPropuesta);

async function consultarPronostico(
  consultarClima: ConsultarClima,
  consulta: Parameters<ConsultarClima>[0],
): Promise<ConsultaPronostico> {
  try {
    const respuesta = await consultarClima(consulta);
    return {
      consulta: { estado: "completada" },
      dias: new Map(respuesta.dias.map((dia) => [dia.fecha, { estado: dia.estado, lluviaMm: dia.lluviaMm }])),
    };
  } catch (error) {
    if (error instanceof ErrorApi) {
      return { consulta: { estado: "fallida", codigo: error.codigo, mensaje: error.message }, dias: null };
    }
    return {
      consulta: { estado: "fallida", codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado al consultar el pronóstico." },
      dias: null,
    };
  }
}

export function crearPriorizadorClima({
  resolverLugares,
  consultarClima,
  estimarTraslado,
}: {
  resolverLugares: ResolverLugares;
  consultarClima: ConsultarClima;
  estimarTraslado?: EstimadorTraslado;
}) {
  return async function priorizarItinerarioPorClima(cuerpo: unknown): Promise<ResultadoPrioridadClima> {
    const parsed = PropuestaClimaSchema.safeParse(cuerpo);
    if (!parsed.success) {
      return { valido: false, detalles: detallesInvalidos(parsed.error) };
    }

    const { viaje, propuesta, destino } = parsed.data;
    const [{ candidatos, lugaresNoResueltos, lugares }, pronostico] = await Promise.all([
      resolverCandidatos(resolverLugares, propuesta),
      consultarPronostico(consultarClima, { lat: destino.lat, lng: destino.lng, fechaInicio: viaje.fechaInicio, fechaFin: viaje.fechaFin }),
    ]);

    const clasificacionDe = (placeId: string): ClasificacionClima => {
      const lugar = lugares.get(placeId);
      return lugar
        ? { tipo_entorno: lugar.tipo_entorno, sensibilidad_clima: lugar.sensibilidad_clima, regla_clima: lugar.regla_clima }
        : clasificarEntorno([]);
    };

    const totalDias = diasEntre(viaje.fechaInicio, viaje.fechaFin);
    const decisiones: DecisionClimaDia[] = [];
    const diasAtendidos = new Set<number>();
    const dias = propuesta.dias.map((dia) => {
      if (dia.numeroDia > totalDias || diasAtendidos.has(dia.numeroDia)) {
        return dia;
      }
      diasAtendidos.add(dia.numeroDia);
      const fecha = sumarDias(viaje.fechaInicio, dia.numeroDia - 1);
      const pronosticoDia = pronostico.dias ? pronostico.dias.get(fecha) ?? { estado: "sin_datos" as const, lluviaMm: null } : null;
      const { lugares: ordenadas, decision } = priorizarPorClima(
        dia.paradas.map((parada) => ({ parada, ...clasificacionDe(parada.placeId) })),
        pronosticoDia,
      );
      decisiones.push({ numeroDia: dia.numeroDia, fecha, ...decision });
      return { ...dia, paradas: ordenadas.map(({ parada }) => parada) };
    });
    decisiones.sort((a, b) => a.numeroDia - b.numeroDia);

    const resultado = validarSalida({ dias }, candidatos, viaje, { lugaresNoResueltos, estimarTraslado });
    const plan = construirPlan(viaje, resultado);

    return {
      valido: true,
      plan: {
        ...plan,
        itinerarios: plan.itinerarios.map((itinerario) => ({
          ...itinerario,
          paradas: itinerario.paradas.map((parada) => ({ ...parada, ...clasificacionDe(parada.placeId) })),
        })),
        clima: {
          fuente: "openweathermap",
          ubicacion: { lat: destino.lat, lng: destino.lng },
          consulta: pronostico.consulta,
          dias: decisiones,
        },
      },
    };
  };
}
