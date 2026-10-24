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
  // Qué tan conocido es el lugar (ver calcularImportancia); 0 si no destaca.
  importancia?: number;
}

// Categorías de los lugares que justifican un viaje: patrimonio, parques nacionales, sitios arqueológicos…
const CATEGORIAS_DESTACADAS: [prefijo: string, puntos: number][] = [
  ["heritage.unesco", 4],
  ["national_park", 2],
  ["natural.protected_area", 2],
  ["leisure.park.nature_reserve", 2],
  ["tourism.sights.archaeological_site", 2],
  ["tourism.sights.castle", 2],
  ["tourism.sights.fort", 2],
  ["natural.water", 1],
  ["natural.mountain.volcano", 1],
  ["tourism.attraction", 1],
  ["beach", 1],
];

// La importancia de un lugar ordena los candidatos antes que la cercanía: sin ella, el sitio más cercano al
// centro del destino (una plaza, una banca) desplaza a Tikal. OpenStreetMap enlaza los lugares conocidos con
// su ficha de Wikipedia o Wikidata, la mejor señal disponible de que un turista los buscaría.
export function calcularImportancia(categorias: string[], propiedades: Record<string, unknown> = {}): number {
  const crudo = esObjeto(propiedades.datasource) && esObjeto(propiedades.datasource.raw) ? propiedades.datasource.raw : {};
  const conFicha = textoNoVacio(crudo.wikidata) || textoNoVacio(crudo.wikipedia) || esObjeto(propiedades.wiki_and_media);
  const porCategoria = Math.max(
    0,
    ...CATEGORIAS_DESTACADAS.filter(([prefijo]) => categorias.some((c) => c === prefijo || c.startsWith(`${prefijo}.`))).map(([, puntos]) => puntos),
  );
  // Lo que abunda en el mapa y casi nunca es un destino: un parque de colonia, la estatua de un prócer, el
  // templo del barrio (las iglesias coloniales conocidas tienen ficha y suman por ella) o una cadena de
  // comida rápida (OpenStreetMap les pone la marca).
  const esMenor =
    !conFicha &&
    (categorias.some((c) => c.startsWith("religion")) ||
      (textoNoVacio(crudo.brand) && categorias.some((c) => c.startsWith("catering"))) ||
      (categorias.every((c) => CATEGORIAS_MENORES.has(c)) && categorias.some((c) => c === "leisure.park" || c === "tourism.sights.memorial")));
  return (conFicha ? 3 : 0) + (porCategoria > 0 ? porCategoria : esMenor ? -1 : 0);
}

const CATEGORIAS_MENORES = new Set(["leisure", "leisure.park", "tourism", "tourism.sights", "tourism.sights.memorial"]);

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

function transformarLugar(feature: unknown, conImportancia = false): Lugar | null {
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
    ...(conImportancia ? { importancia: calcularImportancia(categorias, propiedades as Record<string, unknown>) } : {}),
    ...clasificarEntorno(categorias),
  };
}

// `conImportancia` agrega la importancia de cada lugar; solo la usa la generación de itinerarios, así que
// no aparece en las respuestas de /api/lugares ni en las demás que devuelven lugares.
export function transformarLugares(datos: unknown, conImportancia = false): Lugar[] {
  if (!esObjeto(datos) || !Array.isArray(datos.features)) {
    throw new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de lugares devolvió una respuesta con formato inesperado.");
  }

  const vistos = new Set<string>();
  const lugares: Lugar[] = [];

  for (const feature of datos.features) {
    const lugar = transformarLugar(feature, conImportancia);
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
