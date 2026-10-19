import { z } from "zod";
import { detallesInvalidos } from "../ai/propuesta";
import { interpretarFecha } from "../clima/fechas";
import { ErrorApi } from "../errores";
import { aCentavos } from "../hoteles/tarifas";
import { CARACTERES_DE_CONTROL, MAX_PARADAS_DIA, MAX_PRESUPUESTO_DIARIO, enteroEntre, numeroFinito } from "./hoteles";

export const MAX_PARADAS_RESTAURANTES = MAX_PARADAS_DIA;
export const MAX_COMENSALES = 10;
export const MAX_LARGO_ID_PARADA = 100;
export const RADIO_PREDETERMINADO_RESTAURANTES = 2000;
export const RADIO_MAXIMO_RESTAURANTES = 10000;
export const LIMITE_PREDETERMINADO_RESTAURANTES = 10;
export const LIMITE_MAXIMO_RESTAURANTES = 20;

const IdParadaSchema = z
  .string({ required_error: "id es obligatorio.", invalid_type_error: "id debe ser un texto." })
  .refine((texto) => !CARACTERES_DE_CONTROL.test(texto), "id no puede contener caracteres de control.")
  .transform((texto) => texto.trim())
  .pipe(
    z
      .string()
      .min(1, "id no puede estar vacío.")
      .max(MAX_LARGO_ID_PARADA, `id debe tener como máximo ${MAX_LARGO_ID_PARADA} caracteres.`),
  );

const ParadaSchema = z.object(
  {
    id: IdParadaSchema,
    lat: numeroFinito("lat").min(-90, "lat debe estar entre -90 y 90.").max(90, "lat debe estar entre -90 y 90."),
    lng: numeroFinito("lng").min(-180, "lng debe estar entre -180 y 180.").max(180, "lng debe estar entre -180 y 180."),
  },
  { invalid_type_error: "Cada parada debe ser un objeto con id, lat y lng." },
);

const SolicitudSchema = z.object(
  {
    fecha: z
      .string({ invalid_type_error: "fecha debe ser un texto." })
      .refine((texto) => interpretarFecha(texto) !== null, "fecha debe ser una fecha real con formato AAAA-MM-DD.")
      .optional(),
    paradas: z
      .array(ParadaSchema, { required_error: "paradas es obligatorio.", invalid_type_error: "paradas debe ser una lista." })
      .max(MAX_PARADAS_RESTAURANTES, `paradas no puede tener más de ${MAX_PARADAS_RESTAURANTES} elementos.`)
      .superRefine((paradas, contexto) => {
        const vistos = new Set<string>();
        paradas.forEach(({ id }, indice) => {
          if (vistos.has(id)) {
            contexto.addIssue({ code: z.ZodIssueCode.custom, path: [indice, "id"], message: `id está repetido: ${id}.` });
          }
          vistos.add(id);
        });
      }),
    presupuestoDiario: numeroFinito("presupuestoDiario")
      .positive("presupuestoDiario debe ser mayor que cero.")
      .max(MAX_PRESUPUESTO_DIARIO, `presupuestoDiario no puede superar ${MAX_PRESUPUESTO_DIARIO}.`)
      .refine((valor) => aCentavos(valor) !== null, "presupuestoDiario debe tener como máximo dos decimales."),
    moneda: z.literal("GTQ", { errorMap: () => ({ message: "moneda debe ser GTQ." }) }),
    comensales: enteroEntre("comensales", 1, MAX_COMENSALES),
    radio: enteroEntre("radio", 1, RADIO_MAXIMO_RESTAURANTES).optional().default(RADIO_PREDETERMINADO_RESTAURANTES),
    limite: enteroEntre("limite", 1, LIMITE_MAXIMO_RESTAURANTES).optional().default(LIMITE_PREDETERMINADO_RESTAURANTES),
  },
  { invalid_type_error: "El cuerpo de la solicitud debe ser un objeto JSON." },
);

export interface ParadaSolicitudRestaurantes {
  id: string;
  lat: number;
  lng: number;
}

export interface SolicitudRestaurantes {
  fecha: string | null;
  paradas: ParadaSolicitudRestaurantes[];
  presupuestoDiarioCentavos: number;
  moneda: "GTQ";
  comensales: number;
  radio: number;
  limite: number;
}

export function validarSolicitudRestaurantes(cuerpo: unknown): SolicitudRestaurantes {
  const resultado = SolicitudSchema.safeParse(cuerpo);
  if (!resultado.success) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La solicitud de recomendaciones de restaurantes no es válida.", detallesInvalidos(resultado.error));
  }
  const { fecha, paradas, presupuestoDiario, ...resto } = resultado.data;
  return {
    ...resto,
    fecha: fecha ?? null,
    paradas: paradas.map(({ id, lat, lng }) => ({ id, lat, lng })),
    presupuestoDiarioCentavos: aCentavos(presupuestoDiario) as number,
  };
}
