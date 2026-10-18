import type { CampoPrecioHotel } from "../../../shared/types";
import { esObjeto } from "../tipos";

export const PORCENTAJE_HOSPEDAJE = 40;
const MAX_TEXTO_FUENTE = 200;

export type ImpuestosPrecio =
  | { estado: "informado"; antesImpuestosUsdCentavos: number }
  | { estado: "no_informado" };

export type FuentePrecio = { tipo: "resumen_propiedad" } | { tipo: "oferta"; nombre: string; oficial: boolean };

export interface PrecioReferencialUsd {
  importeUsdCentavos: number;
  campo: CampoPrecioHotel;
  impuestos: ImpuestosPrecio;
  fuente: FuentePrecio;
}

const CAMPOS_PRECIO: readonly CampoPrecioHotel[] = ["total_rate", "rate_per_night"];

export function aCentavos(importe: number): number | null {
  const centavos = Math.round(importe * 100);
  if (!Number.isSafeInteger(centavos) || Math.abs(importe * 100 - centavos) > 1e-6) {
    return null;
  }
  return centavos;
}

export function calcularPresupuestoHospedajeCentavos(presupuestoDiarioCentavos: number): number {
  return Math.floor((presupuestoDiarioCentavos * PORCENTAJE_HOSPEDAJE) / 100);
}

function descomponerDecimal(valor: number): { mantisa: bigint; escala: number } | null {
  const coincidencia = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(valor));
  if (!coincidencia) {
    return null;
  }
  const decimales = coincidencia[2] ?? "";
  let mantisa = BigInt(coincidencia[1] + decimales);
  let escala = decimales.length - Number(coincidencia[3] ?? 0);
  if (escala < 0) {
    mantisa *= 10n ** BigInt(-escala);
    escala = 0;
  }
  return { mantisa, escala };
}

export function convertirCentavos(importeCentavos: number, tasa: number): number | null {
  if (!Number.isSafeInteger(importeCentavos) || importeCentavos < 0 || !Number.isFinite(tasa) || tasa <= 0) {
    return null;
  }
  const decimal = descomponerDecimal(tasa);
  if (!decimal) {
    return null;
  }
  const numerador = BigInt(importeCentavos) * decimal.mantisa;
  const divisor = 10n ** BigInt(decimal.escala);
  const resultado = Number((2n * numerador + divisor) / (2n * divisor));
  return Number.isSafeInteger(resultado) ? resultado : null;
}

function centavosPositivos(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    return null;
  }
  return aCentavos(valor);
}

function leerBloque(bloque: unknown): { importeCentavos: number; impuestos: ImpuestosPrecio } | null {
  if (!esObjeto(bloque)) {
    return null;
  }
  const importeCentavos = centavosPositivos(bloque.extracted_lowest);
  if (importeCentavos === null) {
    return null;
  }
  if (bloque.extracted_before_taxes_fees === undefined) {
    return { importeCentavos, impuestos: { estado: "no_informado" } };
  }
  const antesImpuestosUsdCentavos = centavosPositivos(bloque.extracted_before_taxes_fees);
  if (antesImpuestosUsdCentavos === null) {
    return { importeCentavos, impuestos: { estado: "no_informado" } };
  }
  if (antesImpuestosUsdCentavos > importeCentavos) {
    return null;
  }
  return { importeCentavos, impuestos: { estado: "informado", antesImpuestosUsdCentavos } };
}

function precioDeElemento(elemento: Record<string, unknown>, fuente: FuentePrecio): PrecioReferencialUsd | null {
  for (const campo of CAMPOS_PRECIO) {
    const bloque = leerBloque(elemento[campo]);
    if (bloque) {
      return { importeUsdCentavos: bloque.importeCentavos, campo, impuestos: bloque.impuestos, fuente };
    }
  }
  return null;
}

function nombreFuente(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const nombre = valor.trim();
  return nombre.length > 0 && nombre.length <= MAX_TEXTO_FUENTE ? nombre : null;
}

function compararPrecios(a: PrecioReferencialUsd, b: PrecioReferencialUsd): number {
  const campo = CAMPOS_PRECIO.indexOf(a.campo) - CAMPOS_PRECIO.indexOf(b.campo);
  if (campo !== 0) {
    return campo;
  }
  if (a.importeUsdCentavos !== b.importeUsdCentavos) {
    return a.importeUsdCentavos - b.importeUsdCentavos;
  }
  if (a.fuente.tipo !== b.fuente.tipo) {
    return a.fuente.tipo === "resumen_propiedad" ? -1 : 1;
  }
  if (a.fuente.tipo === "oferta" && b.fuente.tipo === "oferta") {
    if (a.fuente.oficial !== b.fuente.oficial) {
      return a.fuente.oficial ? -1 : 1;
    }
    if (a.fuente.nombre !== b.fuente.nombre) {
      return a.fuente.nombre < b.fuente.nombre ? -1 : 1;
    }
  }
  return 0;
}

export function seleccionarPrecio(propiedad: Record<string, unknown>, adultos: number): PrecioReferencialUsd | null {
  const ofertas = [propiedad.featured_prices, propiedad.prices].flatMap((lista) => (Array.isArray(lista) ? lista : []));
  const candidatos: PrecioReferencialUsd[] = [];
  let hayOfertasIncompatibles = false;

  for (const oferta of ofertas) {
    if (!esObjeto(oferta)) {
      continue;
    }
    if (oferta.num_guests !== undefined && oferta.num_guests !== adultos) {
      hayOfertasIncompatibles = true;
      continue;
    }
    const nombre = nombreFuente(oferta.source);
    if (!nombre) {
      continue;
    }
    const precio = precioDeElemento(oferta, { tipo: "oferta", nombre, oficial: oferta.official === true });
    if (precio) {
      candidatos.push(precio);
    }
  }

  if (!hayOfertasIncompatibles) {
    const resumen = precioDeElemento(propiedad, { tipo: "resumen_propiedad" });
    if (resumen) {
      candidatos.push(resumen);
    }
  }

  if (candidatos.length === 0) {
    return null;
  }
  return candidatos.reduce((mejor, candidato) => (compararPrecios(candidato, mejor) < 0 ? candidato : mejor));
}
