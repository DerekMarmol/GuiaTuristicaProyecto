import type { ClasificacionClima } from "../../../shared/types";
import { clasificarEntorno } from "../clima/clasificacion";
import { ErrorApi } from "../errores";
import { esObjeto } from "../tipos";

const PROVEEDOR = "geoapify";
const CLAVE_CATEGORIA = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

export interface Lugar extends ClasificacionClima {
  idExterno: string;
  proveedor: typeof PROVEEDOR;
  nombre: string;
  direccion: string | null;
  lat: number;
  lng: number;
  categorias: string[];
}

function textoNoVacio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== "";
}

function coordenadaValida(valor: unknown, limite: number): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && Math.abs(valor) <= limite;
}

function categoriasValidas(valor: unknown): string[] {
  if (!Array.isArray(valor)) {
    return [];
  }
  return [
    ...new Set(valor.filter((categoria): categoria is string => typeof categoria === "string" && CLAVE_CATEGORIA.test(categoria))),
  ];
}

function transformarLugar(feature: unknown): Lugar | null {
  const propiedades = feature && typeof feature === "object" ? (feature as { properties?: unknown }).properties : null;
  if (!propiedades || typeof propiedades !== "object") {
    return null;
  }

  const { place_id: idExterno, name: nombre, lat, lon } = propiedades as Record<string, unknown>;
  if (!textoNoVacio(idExterno) || !textoNoVacio(nombre)) {
    return null;
  }
  if (!coordenadaValida(lat, 90) || !coordenadaValida(lon, 180)) {
    return null;
  }

  const { categories, formatted } = propiedades as Record<string, unknown>;
  const categorias = categoriasValidas(categories);
  if (categorias.length === 0) {
    return null;
  }

  return {
    idExterno,
    proveedor: PROVEEDOR,
    nombre,
    direccion: textoNoVacio(formatted) ? formatted : null,
    lat,
    lng: lon,
    categorias,
    ...clasificarEntorno(categorias),
  };
}

export function transformarLugares(datos: unknown): Lugar[] {
  if (!esObjeto(datos) || !Array.isArray(datos.features)) {
    throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de lugares devolvió una respuesta con formato inesperado.");
  }

  const vistos = new Set<string>();
  const lugares: Lugar[] = [];

  for (const feature of datos.features) {
    const lugar = transformarLugar(feature);
    if (!lugar || vistos.has(lugar.idExterno)) {
      continue;
    }
    vistos.add(lugar.idExterno);
    lugares.push(lugar);
  }

  return lugares;
}

export function transformarDetalles(propiedades: unknown, idExterno: string): Lugar | null {
  if (!propiedades || typeof propiedades !== "object") {
    return null;
  }
  return transformarLugar({ properties: { ...propiedades, place_id: idExterno } });
}
