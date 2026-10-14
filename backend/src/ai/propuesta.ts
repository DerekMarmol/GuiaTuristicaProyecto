import { z } from "zod";
import type { HorarioLugar, LugarInteres } from "../../../shared/types";
import { diasEntre } from "./fechas";
import { SalidaIASchema } from "./schemas";
import type { DescarteParada, DiaSinParadas, ItinerarioIA, LugarReal } from "./tipos";
import type { EstimadorTraslado } from "./validacionApertura";
import { HORA_INICIO_PREDETERMINADA, validarSalida, type LugarNoResuelto } from "./validator";
import { esFechaValida, esHoraValida, esZonaHorariaValida } from "./zonaHoraria";

export const MAX_LUGARES_PROPUESTA = 20;
export const MAX_DIAS_PROPUESTA = 14;

export interface LugarResuelto {
  lugar: Omit<LugarInteres, "horario"> | null;
  horario: HorarioLugar;
}

export type ResolverLugares = (identificadores: string[]) => Promise<Map<string, LugarResuelto>>;

export interface DetalleParametro {
  parametro: string;
  mensaje: string;
}

export interface PlanValidado {
  zonaHoraria: string;
  horaInicio: string;
  viable: boolean;
  itinerarios: ItinerarioIA[];
  descartes: DescarteParada[];
  diasSinParadas: DiaSinParadas[];
  errores: string[];
  advertencias: string[];
}

export type ResultadoPropuesta =
  | { valido: true; plan: PlanValidado }
  | { valido: false; detalles: DetalleParametro[] };

const PropuestaSchema = z
  .object({
    viaje: z.object({
      id: z.string().trim().min(1).max(100),
      fechaInicio: z.string().refine(esFechaValida, "Debe ser una fecha real con formato AAAA-MM-DD."),
      fechaFin: z.string().refine(esFechaValida, "Debe ser una fecha real con formato AAAA-MM-DD."),
      zonaHoraria: z.string().refine(esZonaHorariaValida, "Debe ser un identificador de zona horaria IANA válido, por ejemplo America/Guatemala."),
      horaInicio: z.string().refine(esHoraValida, "Debe tener el formato HH:MM.").optional(),
    }),
    propuesta: SalidaIASchema,
  })
  .superRefine(({ viaje, propuesta }, contexto) => {
    if (viaje.fechaFin < viaje.fechaInicio) {
      contexto.addIssue({ code: z.ZodIssueCode.custom, path: ["viaje", "fechaFin"], message: "Debe ser igual o posterior a fechaInicio." });
    } else if (esFechaValida(viaje.fechaInicio) && esFechaValida(viaje.fechaFin) && diasEntre(viaje.fechaInicio, viaje.fechaFin) > MAX_DIAS_PROPUESTA) {
      contexto.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viaje", "fechaFin"],
        message: `El viaje no puede durar más de ${MAX_DIAS_PROPUESTA} días.`,
      });
    }
    const lugares = new Set(propuesta.dias.flatMap((dia) => dia.paradas.map((parada) => parada.placeId)));
    if (lugares.size > MAX_LUGARES_PROPUESTA) {
      contexto.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["propuesta", "dias"],
        message: `La propuesta no puede incluir más de ${MAX_LUGARES_PROPUESTA} lugares distintos.`,
      });
    }
  });

function aLugarReal(idExterno: string, lugar: Omit<LugarInteres, "horario">, horario: HorarioLugar): LugarReal {
  return {
    placeId: idExterno,
    nombre: lugar.nombre,
    lat: lugar.lat,
    lng: lugar.lng,
    categoria: lugar.categorias[0],
    direccion: lugar.direccion,
    horario,
  };
}

function motivoNoResuelto(resuelto: LugarResuelto | undefined): LugarNoResuelto {
  if (!resuelto || resuelto.horario.estado === "error_consulta") {
    return { motivo: "error_consulta", horario: resuelto?.horario ?? null };
  }
  return { motivo: "lugar_no_resuelto", horario: resuelto.horario };
}

export function crearValidadorPropuestas({
  resolverLugares,
  estimarTraslado,
}: {
  resolverLugares: ResolverLugares;
  estimarTraslado?: EstimadorTraslado;
}) {
  return async function validarPropuesta(cuerpo: unknown): Promise<ResultadoPropuesta> {
    const parsed = PropuestaSchema.safeParse(cuerpo);
    if (!parsed.success) {
      return {
        valido: false,
        detalles: parsed.error.issues.map((issue) => ({
          parametro: issue.path.join(".") || "cuerpo",
          mensaje: issue.message,
        })),
      };
    }

    const { viaje, propuesta } = parsed.data;
    const identificadores = [...new Set(propuesta.dias.flatMap((dia) => dia.paradas.map((parada) => parada.placeId)))];
    const resueltos = await resolverLugares(identificadores);

    const candidatos: LugarReal[] = [];
    const lugaresNoResueltos = new Map<string, LugarNoResuelto>();
    for (const idExterno of identificadores) {
      const resuelto = resueltos.get(idExterno);
      if (resuelto?.lugar) {
        candidatos.push(aLugarReal(idExterno, resuelto.lugar, resuelto.horario));
      } else {
        lugaresNoResueltos.set(idExterno, motivoNoResuelto(resuelto));
      }
    }

    const resultado = validarSalida(propuesta, candidatos, viaje, { lugaresNoResueltos, estimarTraslado });

    return {
      valido: true,
      plan: {
        zonaHoraria: viaje.zonaHoraria,
        horaInicio: viaje.horaInicio ?? HORA_INICIO_PREDETERMINADA,
        viable: resultado.viable,
        itinerarios: resultado.itinerarios,
        descartes: resultado.descartes,
        diasSinParadas: resultado.diasSinParadas,
        errores: resultado.errores,
        advertencias: resultado.advertencias,
      },
    };
  };
}
