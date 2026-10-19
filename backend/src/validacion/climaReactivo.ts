import { z } from "zod";
import type { SolicitudAceptarPropuestaClima, SolicitudClimaReactivo } from "../../../shared/types";
import { detallesInvalidos } from "../ai/propuesta";
import { interpretarFecha } from "../clima/fechas";
import { NIVELES } from "../clima/reactivo/deteccion";
import { INTERESES_PERMITIDOS } from "../config/intereses";
import { ErrorApi } from "../errores";
import { CARACTERES_DE_CONTROL, MAX_PARADAS_DIA, enteroEntre, numeroFinito } from "./hoteles";

const HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const CATEGORIA = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const MAX_LARGO_TOKEN = 32 * 1024;

const texto = (campo: string, maximo: number) =>
  z
    .string({ required_error: `${campo} es obligatorio.`, invalid_type_error: `${campo} debe ser un texto.` })
    .refine((valor) => !CARACTERES_DE_CONTROL.test(valor), `${campo} no puede contener caracteres de control.`)
    .transform((valor) => valor.trim())
    .pipe(z.string().min(1, `${campo} no puede estar vacío.`).max(maximo, `${campo} debe tener como máximo ${maximo} caracteres.`));

const hora = (campo: string) =>
  z.string({ required_error: `${campo} es obligatorio.`, invalid_type_error: `${campo} debe ser un texto.` }).regex(HORA, `${campo} debe tener formato HH:MM.`);

const latitud = numeroFinito("lat").min(-90, "lat debe estar entre -90 y 90.").max(90, "lat debe estar entre -90 y 90.");
const longitud = numeroFinito("lng").min(-180, "lng debe estar entre -180 y 180.").max(180, "lng debe estar entre -180 y 180.");
const instante = (campo: string) => z.string({ invalid_type_error: `${campo} debe ser un texto.` }).datetime({ offset: true, message: `${campo} debe ser una fecha y hora ISO 8601.` });
const nivel = z.enum(NIVELES as [string, ...string[]], { errorMap: () => ({ message: `nivel debe ser uno de: ${NIVELES.join(", ")}.` }) });

const ParadaSchema = z
  .object(
    {
      id: texto("id", 100),
      nombre: texto("nombre", 200),
      lat: latitud,
      lng: longitud,
      horaApertura: hora("horaApertura"),
      horaCierre: hora("horaCierre"),
      tiempoEstanciaMinutos: enteroEntre("tiempoEstanciaMinutos", 0, 1440),
      estado: z.enum(["completada", "en_curso", "pendiente", "cancelada"], {
        errorMap: () => ({ message: "estado debe ser completada, en_curso, pendiente o cancelada." }),
      }),
      placeId: texto("placeId", 512).optional(),
      categorias: z.array(z.string().regex(CATEGORIA, "Cada categoría debe tener formato de Geoapify."), { invalid_type_error: "categorias debe ser una lista." }).max(30).optional(),
      tipo_entorno: z.enum(["indoor", "outdoor"]).optional(),
      sensibilidad_clima: z.enum(["baja", "media", "alta"]).optional(),
      horaFinProgramada: hora("horaFinProgramada").optional(),
    },
    { invalid_type_error: "Cada parada debe ser un objeto." },
  )
  .refine((p) => p.horaApertura <= p.horaCierre, { message: "horaApertura no puede ser posterior a horaCierre.", path: ["horaCierre"] });

const ItinerarioSchema = z.object(
  {
    id: texto("id", 100),
    fecha: z.string({ required_error: "fecha es obligatoria." }).refine((valor) => interpretarFecha(valor) !== null, "fecha debe ser una fecha real con formato AAAA-MM-DD."),
    paradas: z
      .array(ParadaSchema, { required_error: "paradas es obligatorio.", invalid_type_error: "paradas debe ser una lista." })
      .min(1, "paradas debe tener al menos una parada.")
      .max(MAX_PARADAS_DIA, `paradas no puede tener más de ${MAX_PARADAS_DIA} elementos.`)
      .superRefine((paradas, contexto) => {
        const vistos = new Set<string>();
        paradas.forEach(({ id }, indice) => {
          if (vistos.has(id)) contexto.addIssue({ code: z.ZodIssueCode.custom, path: [indice, "id"], message: `id está repetido: ${id}.` });
          vistos.add(id);
        });
        if (paradas.filter((p) => p.estado === "en_curso").length > 1) {
          contexto.addIssue({ code: z.ZodIssueCode.custom, message: "Solo puede haber una parada en curso." });
        }
      }),
  },
  { required_error: "itinerario es obligatorio.", invalid_type_error: "itinerario debe ser un objeto." },
);

const SolicitudSchema = z.object(
  {
    itinerario: ItinerarioSchema,
    modoTransporte: z.enum(["auto", "pedestrian"], { errorMap: () => ({ message: "modoTransporte debe ser auto o pedestrian." }) }).optional(),
    ubicacionActual: z.object({ lat: latitud, lng: longitud, registradaEn: instante("registradaEn") }).optional(),
    intereses: z
      .array(z.enum(INTERESES_PERMITIDOS as [string, ...string[]], { errorMap: () => ({ message: `Intereses admitidos: ${INTERESES_PERMITIDOS.join(", ")}.` }) }))
      .max(INTERESES_PERMITIDOS.length)
      .optional(),
    referencia: z
      .object({
        nivel,
        eventoId: z.string().max(200).nullable(),
        evaluadoEn: instante("evaluadoEn"),
        nivelNotificado: nivel.nullable(),
        ultimaPropuestaEn: instante("ultimaPropuestaEn").nullable(),
      })
      .nullable()
      .optional(),
  },
  { invalid_type_error: "El cuerpo de la solicitud debe ser un objeto JSON." },
);

const AceptarSchema = z.object(
  {
    token: z.string({ required_error: "token es obligatorio.", invalid_type_error: "token debe ser un texto." }).min(1).max(MAX_LARGO_TOKEN),
    itinerario: ItinerarioSchema,
  },
  { invalid_type_error: "El cuerpo de la solicitud debe ser un objeto JSON." },
);

export function validarSolicitudClimaReactivo(cuerpo: unknown): SolicitudClimaReactivo {
  const resultado = SolicitudSchema.safeParse(cuerpo);
  if (!resultado.success) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La solicitud de monitoreo del clima no es válida.", detallesInvalidos(resultado.error));
  }
  return resultado.data as SolicitudClimaReactivo;
}

export function validarAceptacionPropuesta(cuerpo: unknown): SolicitudAceptarPropuestaClima {
  const resultado = AceptarSchema.safeParse(cuerpo);
  if (!resultado.success) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La solicitud para aceptar la propuesta no es válida.", detallesInvalidos(resultado.error));
  }
  return resultado.data as SolicitudAceptarPropuestaClima;
}
