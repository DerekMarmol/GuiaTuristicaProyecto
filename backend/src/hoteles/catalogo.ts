import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { interpretarFecha } from "../clima/fechas";
import { ErrorApi } from "../errores";

const RAIZ_BACKEND = path.resolve(__dirname, path.extname(__filename) === ".ts" ? "../.." : "../../../..");
export const RUTA_CATALOGO_TARIFAS = path.join(RAIZ_BACKEND, "data", "tarifas-hoteles.json");

export const MAX_OCUPACION_TARIFA = 10;
const MAX_IMPORTE_CENTAVOS = 100_000_000;

const fechaReal = z.string().refine((texto) => interpretarFecha(texto) !== null, "Debe ser una fecha real con formato AAAA-MM-DD.");
const textoNoVacio = (maximo: number) => z.string().trim().min(1).max(maximo);

const FuenteSchema = z.discriminatedUnion("tipo", [
  z
    .object({
      tipo: z.literal("url"),
      referencia: z
        .string()
        .max(2000)
        .url()
        .refine((referencia) => /^https?:\/\//i.test(referencia), "La URL debe usar http o https."),
    })
    .strict(),
  z.object({ tipo: z.literal("cotizacion"), referencia: textoNoVacio(500) }).strict(),
]);

const TarifaSchema = z
  .object({
    id: textoNoVacio(100),
    idExterno: textoNoVacio(500),
    nombreReferencia: textoNoVacio(200).optional(),
    importeCentavos: z.number().int().positive().max(MAX_IMPORTE_CENTAVOS),
    moneda: z.string().regex(/^[A-Z]{3}$/),
    unidad: z.literal("habitacion_noche"),
    ocupacion: z.number().int().min(1).max(MAX_OCUPACION_TARIFA),
    importeTotal: z.boolean(),
    impuestosIncluidos: z.boolean().nullable(),
    vigenciaDesde: fechaReal,
    vigenciaHasta: fechaReal,
    verificadoEn: fechaReal,
    fuente: FuenteSchema,
  })
  .strict()
  .refine(({ vigenciaDesde, vigenciaHasta }) => vigenciaDesde <= vigenciaHasta, {
    message: "vigenciaHasta debe ser igual o posterior a vigenciaDesde.",
    path: ["vigenciaHasta"],
  });

const CatalogoSchema = z
  .object({ tarifas: z.array(TarifaSchema) })
  .strict()
  .superRefine(({ tarifas }, contexto) => {
    const vistos = new Set<string>();
    tarifas.forEach((tarifa, indice) => {
      if (vistos.has(tarifa.id)) {
        contexto.addIssue({ code: z.ZodIssueCode.custom, path: ["tarifas", indice, "id"], message: "El identificador de tarifa está repetido." });
      }
      vistos.add(tarifa.id);
    });
  });

export type TarifaHotel = z.infer<typeof TarifaSchema>;

export type LeerCatalogo = () => Promise<unknown>;

function errorCatalogoInvalido(): ErrorApi {
  return new ErrorApi(
    500,
    "CATALOGO_TARIFAS_INVALIDO",
    "El catálogo de tarifas de hoteles no está configurado correctamente. Contacta al administrador del sistema.",
  );
}

export function validarCatalogo(datos: unknown): TarifaHotel[] {
  const resultado = CatalogoSchema.safeParse(datos);
  if (!resultado.success) {
    const ubicaciones = resultado.error.issues.map((issue) => issue.path.join(".") || "raiz");
    console.error("Catálogo de tarifas de hoteles inválido en:", [...new Set(ubicaciones)].join(", "));
    throw errorCatalogoInvalido();
  }
  return resultado.data.tarifas;
}

export function crearLectorCatalogo(ruta: string = RUTA_CATALOGO_TARIFAS): LeerCatalogo {
  return async function leerCatalogo() {
    let texto: string;
    try {
      texto = await readFile(ruta, "utf8");
    } catch {
      console.error("No fue posible leer el catálogo de tarifas de hoteles.");
      throw new ErrorApi(
        500,
        "CATALOGO_TARIFAS_NO_DISPONIBLE",
        "El catálogo de tarifas de hoteles no está disponible. Contacta al administrador del sistema.",
      );
    }
    try {
      return JSON.parse(texto.replace(/^\uFEFF/, "")) as unknown;
    } catch {
      console.error("El catálogo de tarifas de hoteles no es un JSON válido.");
      throw errorCatalogoInvalido();
    }
  };
}
