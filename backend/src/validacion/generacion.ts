import { z } from "zod";
import type { Viaje } from "../../../shared/types";
import { diasEntre } from "../ai/fechas";
import { detallesInvalidos, MAX_DIAS_PROPUESTA } from "../ai/propuesta";
import { esFechaValida, esHoraValida } from "../ai/zonaHoraria";
import { INTERESES_PERMITIDOS } from "../config/intereses";
import { ErrorApi } from "../errores";
import { CARACTERES_DE_CONTROL, MAX_LARGO_DESTINO, MIN_LARGO_DESTINO } from "./hoteles";
import { interesAdmitido } from "./lugares";

export interface SolicitudGeneracion {
  destino: string;
  fechaInicio: string;
  fechaFin: string;
  intereses: string[];
  tipoViaje: Viaje["tipoViaje"];
  transporte: Viaje["transporte"];
  presupuesto: number;
  presupuestoDiario?: number;
  hospedaje: boolean;
  nombreHotel?: string;
  horaInicio?: string;
  origen?: { lat: number; lng: number };
}

const TIPOS_VIAJE = ["solo", "pareja", "familia", "amigos"] as const;
const TRANSPORTES = ["A pie", "Transporte Publico", "Automovil", "Moto", "Transporte Aereo"] as const;

const texto = (campo: string, minimo: number, maximo: number) =>
  z
    .string({ required_error: `${campo} es obligatorio.`, invalid_type_error: `${campo} debe ser un texto.` })
    .refine((valor) => !CARACTERES_DE_CONTROL.test(valor), `${campo} no puede contener caracteres de control.`)
    .transform((valor) => valor.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(minimo, `${campo} debe tener entre ${minimo} y ${maximo} caracteres.`).max(maximo, `${campo} debe tener entre ${minimo} y ${maximo} caracteres.`));

const fecha = (campo: string) =>
  z
    .string({ required_error: `${campo} es obligatoria.`, invalid_type_error: `${campo} debe ser un texto.` })
    .refine(esFechaValida, `${campo} debe ser una fecha real con formato AAAA-MM-DD.`);

const monto = (campo: string) =>
  z.number({ invalid_type_error: `${campo} debe ser un número.` }).finite(`${campo} debe ser un número finito.`).min(0, `${campo} no puede ser negativo.`);

const SolicitudSchema = z
  .object({
    destino: texto("destino", MIN_LARGO_DESTINO, MAX_LARGO_DESTINO),
    fechaInicio: fecha("fechaInicio"),
    fechaFin: fecha("fechaFin"),
    intereses: z
      .array(z.string({ invalid_type_error: "Cada interés debe ser un texto." }), {
        required_error: "intereses es obligatorio.",
        invalid_type_error: "intereses debe ser una lista.",
      })
      .min(1, "Elige al menos un interés.")
      .transform((lista, contexto) => {
        const admitidos = new Set<string>();
        for (const elemento of lista) {
          const interes = interesAdmitido(elemento);
          if (!interes) {
            contexto.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Interés no admitido: ${elemento}. Valores permitidos: ${INTERESES_PERMITIDOS.join(", ")}.`,
            });
            return z.NEVER;
          }
          admitidos.add(interes);
        }
        return [...admitidos];
      }),
    tipoViaje: z.enum(TIPOS_VIAJE, { invalid_type_error: `tipoViaje debe ser uno de: ${TIPOS_VIAJE.join(", ")}.` }).default("solo"),
    transporte: z.enum(TRANSPORTES, { invalid_type_error: `transporte debe ser uno de: ${TRANSPORTES.join(", ")}.` }).default("Automovil"),
    presupuesto: monto("presupuesto").default(0),
    presupuestoDiario: monto("presupuestoDiario").optional(),
    hospedaje: z.boolean({ invalid_type_error: "hospedaje debe ser true o false." }).default(false),
    nombreHotel: texto("nombreHotel", 1, MAX_LARGO_DESTINO).optional(),
    horaInicio: z.string({ invalid_type_error: "horaInicio debe ser un texto." }).refine(esHoraValida, "horaInicio debe tener el formato HH:MM.").optional(),
    // Ubicación del viajero al generar; si está lejos del destino se ignora.
    origen: z
      .object(
        {
          lat: z.number({ invalid_type_error: "origen.lat debe ser un número." }).min(-90).max(90),
          lng: z.number({ invalid_type_error: "origen.lng debe ser un número." }).min(-180).max(180),
        },
        { invalid_type_error: "origen debe ser un objeto con lat y lng." },
      )
      .optional(),
  })
  .superRefine((solicitud, contexto) => {
    if (solicitud.fechaFin < solicitud.fechaInicio) {
      contexto.addIssue({ code: z.ZodIssueCode.custom, path: ["fechaFin"], message: "Debe ser igual o posterior a fechaInicio." });
    } else if (diasEntre(solicitud.fechaInicio, solicitud.fechaFin) > MAX_DIAS_PROPUESTA) {
      contexto.addIssue({ code: z.ZodIssueCode.custom, path: ["fechaFin"], message: `El viaje no puede durar más de ${MAX_DIAS_PROPUESTA} días.` });
    }
  });

export function validarSolicitudGeneracion(cuerpo: unknown): SolicitudGeneracion {
  const resultado = SolicitudSchema.safeParse(cuerpo);
  if (!resultado.success) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "Los datos del viaje no son válidos.", detallesInvalidos(resultado.error));
  }
  return resultado.data;
}
