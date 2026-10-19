import { z } from "zod";
import {
  CATEGORIAS_TURISTICAS_PREDETERMINADAS,
  LIMITE_MAXIMO_ABIERTOS,
  LIMITE_PREDETERMINADO_ABIERTOS,
  RADIO_MAXIMO_ABIERTOS,
  RADIO_PREDETERMINADO_ABIERTOS,
} from "../config/abiertosAhora";
import { CATEGORIAS_PERMITIDAS } from "../config/categorias";
import { INTERESES_PERMITIDOS } from "../config/intereses";
import { ErrorApi } from "../errores";
import type { Consulta, ErrorParametro } from "../tipos";
import { combinarCategorias, interesAdmitido } from "./lugares";

const DECIMAL = /^-?\d+(\.\d+)?$/;
const ENTERO = /^\d+$/;

export interface ConsultaAbiertosAhora {
  lat: number;
  lng: number;
  radio: number;
  limite: number;
  categorias: string[];
  intereses: string[];
  categoriasPredeterminadas: boolean;
}

function invalido(contexto: z.RefinementCtx, mensaje: string): typeof z.NEVER {
  contexto.addIssue({ code: z.ZodIssueCode.custom, message: mensaje });
  return z.NEVER;
}

// Los parámetros repetidos llegan como arreglo y los vacíos como "": ambos se rechazan antes de convertir.
function leerTexto(valor: unknown, nombre: string, contexto: z.RefinementCtx): string | null {
  if (typeof valor !== "string") {
    invalido(contexto, `El parámetro ${nombre} debe enviarse una sola vez como valor simple.`);
    return null;
  }
  if (valor === "") {
    invalido(contexto, `El parámetro ${nombre} no puede estar vacío.`);
    return null;
  }
  return valor;
}

const decimal = (nombre: string, minimo: number, maximo: number) =>
  z.unknown().transform((valor, contexto) => {
    if (valor === undefined) {
      return invalido(contexto, `El parámetro ${nombre} es obligatorio.`);
    }
    const texto = leerTexto(valor, nombre, contexto);
    if (texto === null) {
      return z.NEVER;
    }
    const numero = Number(texto);
    if (!DECIMAL.test(texto) || !Number.isFinite(numero)) {
      return invalido(contexto, `El parámetro ${nombre} debe ser un número decimal válido.`);
    }
    if (numero < minimo || numero > maximo) {
      return invalido(contexto, `El parámetro ${nombre} debe estar entre ${minimo} y ${maximo}.`);
    }
    return numero;
  });

const entero = (nombre: string, minimo: number, maximo: number, predeterminado: number) =>
  z.unknown().transform((valor, contexto) => {
    if (valor === undefined) {
      return predeterminado;
    }
    const texto = leerTexto(valor, nombre, contexto);
    if (texto === null) {
      return z.NEVER;
    }
    const numero = Number(texto);
    if (!ENTERO.test(texto) || !Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
      return invalido(contexto, `El parámetro ${nombre} debe ser un número entero entre ${minimo} y ${maximo}.`);
    }
    return numero;
  });

const categoria = z.unknown().transform((valor, contexto): string | null => {
  if (valor === undefined) {
    return null;
  }
  const texto = leerTexto(valor, "categoria", contexto);
  if (texto === null) {
    return z.NEVER;
  }
  if (!CATEGORIAS_PERMITIDAS.includes(texto)) {
    return invalido(contexto, `La categoría no es admitida. Valores permitidos: ${CATEGORIAS_PERMITIDAS.join(", ")}.`);
  }
  return texto;
});

const intereses = z.unknown().transform((valor, contexto): string[] | null => {
  if (valor === undefined) {
    return null;
  }
  const texto = leerTexto(valor, "intereses", contexto);
  if (texto === null) {
    return z.NEVER;
  }
  const elementos = texto.split(",").map((elemento) => elemento.trim());
  if (elementos.some((elemento) => elemento === "")) {
    return invalido(contexto, "El parámetro intereses no puede contener elementos vacíos.");
  }
  const desconocidos = elementos.filter((elemento) => !interesAdmitido(elemento));
  if (desconocidos.length > 0) {
    return invalido(contexto, `Intereses no admitidos: ${desconocidos.join(", ")}. Valores permitidos: ${INTERESES_PERMITIDOS.join(", ")}.`);
  }
  return [...new Set(elementos.map((elemento) => interesAdmitido(elemento) as string))];
});

const ConsultaSchema = z
  .object({
    lat: decimal("lat", -90, 90),
    lng: decimal("lng", -180, 180),
    radio: entero("radio", 1, RADIO_MAXIMO_ABIERTOS, RADIO_PREDETERMINADO_ABIERTOS),
    limite: entero("limite", 1, LIMITE_MAXIMO_ABIERTOS, LIMITE_PREDETERMINADO_ABIERTOS),
    categoria,
    intereses,
  })
  .strict();

function detalles(error: z.ZodError): ErrorParametro[] {
  return error.issues.flatMap((issue) =>
    issue.code === z.ZodIssueCode.unrecognized_keys
      ? issue.keys.map((clave) => ({ parametro: clave, mensaje: `El parámetro ${clave} no es admitido.` }))
      : [{ parametro: issue.path.join(".") || "consulta", mensaje: issue.message }],
  );
}

export function validarConsultaAbiertosAhora(query: Consulta): ConsultaAbiertosAhora {
  const resultado = ConsultaSchema.safeParse(query ?? {});
  if (!resultado.success) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "Los parámetros de la consulta no son válidos.", detalles(resultado.error));
  }

  const { categoria: categoriaElegida, intereses: interesesElegidos, ...resto } = resultado.data;
  const categoriasPredeterminadas = categoriaElegida === null && interesesElegidos === null;
  return {
    ...resto,
    categorias: categoriasPredeterminadas
      ? [...CATEGORIAS_TURISTICAS_PREDETERMINADAS]
      : combinarCategorias(categoriaElegida, interesesElegidos ?? []),
    intereses: interesesElegidos ?? [],
    categoriasPredeterminadas,
  };
}
