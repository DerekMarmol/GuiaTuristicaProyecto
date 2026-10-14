import { z } from "zod";
import { detallesInvalidos } from "../ai/propuesta";
import { interpretarFecha } from "../clima/fechas";
import { ErrorApi } from "../errores";
import { MAX_OCUPACION_TARIFA } from "../hoteles/catalogo";
import { calcularCentro } from "../hoteles/geografia";
import { aCentavos } from "../hoteles/tarifas";

export const MAX_PARADAS_DIA = 25;
export const MAX_PRESUPUESTO_DIARIO = 1_000_000;
export const RADIO_PREDETERMINADO = 5000;
export const RADIO_MAXIMO = 50000;
export const LIMITE_PREDETERMINADO = 10;
export const LIMITE_MAXIMO = 20;

const numeroFinito = (campo: string) =>
  z.number({ required_error: `${campo} es obligatorio.`, invalid_type_error: `${campo} debe ser un número.` }).finite(`${campo} debe ser un número finito.`);

const enteroEntre = (campo: string, minimo: number, maximo: number) =>
  numeroFinito(campo)
    .int(`${campo} debe ser un número entero.`)
    .min(minimo, `${campo} debe estar entre ${minimo} y ${maximo}.`)
    .max(maximo, `${campo} debe estar entre ${minimo} y ${maximo}.`);

const booleano = (campo: string) =>
  z.boolean({ required_error: `${campo} es obligatorio.`, invalid_type_error: `${campo} debe ser true o false.` });

const ParadaSchema = z.object(
  {
    lat: numeroFinito("lat").min(-90, "lat debe estar entre -90 y 90.").max(90, "lat debe estar entre -90 y 90."),
    lng: numeroFinito("lng").min(-180, "lng debe estar entre -180 y 180.").max(180, "lng debe estar entre -180 y 180."),
  },
  { invalid_type_error: "Cada parada debe ser un objeto con lat y lng." },
);

const SolicitudSchema = z
  .object(
    {
      fecha: z
        .string({ required_error: "fecha es obligatoria.", invalid_type_error: "fecha debe ser un texto." })
        .refine((texto) => interpretarFecha(texto) !== null, "fecha debe ser una fecha real con formato AAAA-MM-DD."),
      paradas: z
        .array(ParadaSchema, { required_error: "paradas es obligatorio.", invalid_type_error: "paradas debe ser una lista." })
        .max(MAX_PARADAS_DIA, `paradas no puede tener más de ${MAX_PARADAS_DIA} elementos.`),
      presupuestoDiario: numeroFinito("presupuestoDiario")
        .positive("presupuestoDiario debe ser mayor que cero.")
        .max(MAX_PRESUPUESTO_DIARIO, `presupuestoDiario no puede superar ${MAX_PRESUPUESTO_DIARIO}.`)
        .refine((valor) => aCentavos(valor) !== null, "presupuestoDiario debe tener como máximo dos decimales."),
      moneda: z.literal("GTQ", { errorMap: () => ({ message: "moneda debe ser GTQ." }) }),
      ocupacion: enteroEntre("ocupacion", 1, MAX_OCUPACION_TARIFA),
      hospedaje: booleano("hospedaje"),
      sinHotel: booleano("sinHotel").optional().default(false),
      radio: enteroEntre("radio", 1, RADIO_MAXIMO).optional().default(RADIO_PREDETERMINADO),
      limite: enteroEntre("limite", 1, LIMITE_MAXIMO).optional().default(LIMITE_PREDETERMINADO),
    },
    { invalid_type_error: "El cuerpo de la solicitud debe ser un objeto JSON." },
  )
  .superRefine(({ paradas }, contexto) => {
    if (paradas.length > 0 && calcularCentro(paradas) === null) {
      contexto.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paradas"],
        message: "Las paradas no permiten calcular un centro geográfico (son puntos opuestos del globo).",
      });
    }
  });

export interface SolicitudHoteles {
  fecha: string;
  paradas: { lat: number; lng: number }[];
  presupuestoDiarioCentavos: number;
  moneda: "GTQ";
  ocupacion: number;
  hospedaje: boolean;
  sinHotel: boolean;
  radio: number;
  limite: number;
}

export function validarSolicitudHoteles(cuerpo: unknown): SolicitudHoteles {
  const resultado = SolicitudSchema.safeParse(cuerpo);
  if (!resultado.success) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La solicitud de recomendaciones de hoteles no es válida.", detallesInvalidos(resultado.error));
  }
  const { presupuestoDiario, paradas, ...resto } = resultado.data;
  return {
    ...resto,
    paradas: paradas.map(({ lat, lng }) => ({ lat, lng })),
    presupuestoDiarioCentavos: aCentavos(presupuestoDiario) as number,
  };
}
