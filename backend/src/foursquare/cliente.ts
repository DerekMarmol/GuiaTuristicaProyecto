import { clasificarEntorno } from "../clima/clasificacion";
import type { Lugar } from "../geoapify/transformar";
import type { CacheJson } from "../lib/redis";
import { esObjeto, type FuncionFetch } from "../tipos";

// GUI-117: segunda fuente de lugares. OpenStreetMap (Geoapify) tiene poca información de comercios y
// restaurantes en Guatemala (en Jalapa, 4 lugares de compras); Foursquare Places cubre mucho mejor los
// negocios. Solo se piden los campos básicos (los que Foursquare cobra como «Pro», con cuota gratuita):
// sin horarios, fotos ni calificaciones, que pueden contar como «Premium».

export const URL_BUSQUEDA_FOURSQUARE = "https://places-api.foursquare.com/places/search";
export const VERSION_API_FOURSQUARE = "2025-06-17";
const TIEMPO_ESPERA_MS = 8000;
const TTL_CACHE_SEGUNDOS = 86_400;
const MAX_RESULTADOS = 50;
const CAMPOS = "fsq_place_id,name,latitude,longitude,categories,location,distance";

export type LugarFoursquare = Omit<Lugar, "proveedor"> & { proveedor: "foursquare" };

export interface ConsultaFoursquare {
  lat: number;
  lng: number;
  radio: number;
  limite: number;
  interes: string;
}

export type BuscarEnFoursquare = (consulta: ConsultaFoursquare) => Promise<LugarFoursquare[]>;

// Categorías de Foursquare por interés: las raíz son amplias (Retail incluye ferreterías; Landmarks and
// Outdoors, edificios y oficinas), así que además cada interés solo acepta los lugares cuya categoría
// encaja con él (CATEGORIAS_ACEPTADAS). Los balnearios están en Water Park, fuera de Landmarks.
const RETAIL = "4d4b7105d754a06378d81259";
const COMIDA_Y_BEBIDA = "63be6904847c3692a84b9bb5";
const ARTE_Y_ENTRETENIMIENTO = "4d4b7104d754a06370d81259";
const SITIOS_Y_AIRE_LIBRE = "4d4b7105d754a06377d81259";
const DEPORTES_Y_RECREACION = "4f4528bc4b90abdf24c9de85";
const VIDA_NOCTURNA = "4d4b7105d754a06376d81259";
const PARQUE_ACUATICO = "4bf58dd8d48988d193941735";

const CATEGORIAS_POR_INTERES: Record<string, string[]> = {
  Compras: [RETAIL],
  "Gastronomía": [COMIDA_Y_BEBIDA],
  Cultura: [ARTE_Y_ENTRETENIMIENTO, SITIOS_Y_AIRE_LIBRE],
  Arte: [ARTE_Y_ENTRETENIMIENTO],
  Historia: [SITIOS_Y_AIRE_LIBRE, ARTE_Y_ENTRETENIMIENTO],
  Naturaleza: [SITIOS_Y_AIRE_LIBRE, PARQUE_ACUATICO],
  Playa: [SITIOS_Y_AIRE_LIBRE, PARQUE_ACUATICO],
  Aventura: [DEPORTES_Y_RECREACION, SITIOS_Y_AIRE_LIBRE, PARQUE_ACUATICO],
  "Fotografía": [SITIOS_Y_AIRE_LIBRE],
  "Vida nocturna": [VIDA_NOCTURNA, COMIDA_Y_BEBIDA],
};

// Categorías de uso diario que no son un paseo de compras aunque estén en Retail (super, farmacia…).
const CATEGORIAS_DE_USO_DIARIO = /supermarket|grocery|convenience|pharmac|drugstore|hardware|automotive|auto parts|mobile phone|electronics|furniture|discount|gas station|bank|hospital|office/i;

// Nombres de categoría de Foursquare que sí le interesan a un viajero con ese interés.
const CATEGORIAS_ACEPTADAS: Record<string, RegExp> = {
  Compras: /mall|shopping|market|mercado|souvenir|gift|craft|artesan|clothing|apparel|boutique|shoe|jewelry|bookstore|department|antique|textile|candy|chocolate|coffee roaster/i,
  "Gastronomía": /restaurant|caf[eé]|coffee|bakery|pastry|dessert|ice cream|food|pizz|taco|grill|steak|burger|diner|eatery|bistro|bbq|barbecue|seafood|comedor|pupus/i,
  Cultura: /museum|gallery|theater|theatre|cultural|art|historic|monument|library|church|cathedral|plaza|memorial|landmark/i,
  Arte: /museum|gallery|art|theater|theatre|cultural|sculpture|mural|craft/i,
  Historia: /historic|monument|memorial|church|cathedral|chapel|ruins|archaeolog|museum|plaza|landmark|castle|fort|palace|cemetery/i,
  Naturaleza: /park|nature|preserve|reserve|forest|volcano|mountain|waterfall|lake|river|beach|campground|garden|scenic|lookout|trail|hot spring|cave|water park/i,
  Playa: /beach|lake|river|water park|swimming|waterfront|pier|hot spring/i,
  Aventura: /water park|theme park|amusement|zip|canopy|climb|campground|trail|volcano|mountain|adventure|paintball|kart|rafting|kayak|horse|bike|surf|dive|cave/i,
  "Fotografía": /scenic|lookout|viewpoint|monument|church|cathedral|plaza|park|volcano|lake|waterfall|historic|garden|bridge/i,
  "Vida nocturna": /bar|pub|brewery|nightclub|lounge|karaoke|cocktail|wine|beer|dance|club|cantina/i,
};

// Palabras del nombre de la categoría de Foursquare → categoría equivalente de Geoapify. La primera que
// coincide gana; si ninguna, se usa la del interés.
const EQUIVALENCIAS: [RegExp, string][] = [
  [/caf[eé]|coffee|bakery|panader/i, "catering.cafe"],
  [/\bbar\b|pub|brewery|cantina|nightclub|lounge/i, "catering.bar"],
  [/restaurant|food|comida|pizza|taco|grill|steak|burger|diner|eatery/i, "catering.restaurant"],
  [/museum|museo/i, "entertainment.museum"],
  [/gallery|galer[ií]a/i, "entertainment.culture.gallery"],
  [/theater|theatre|teatro|cultural|arts/i, "entertainment.culture"],
  [/mall|shopping|centro comercial/i, "commercial.shopping_mall"],
  [/market|mercado/i, "commercial.marketplace"],
  [/souvenir|gift|artesan|craft/i, "commercial.gift_and_souvenir"],
  [/water park|theme park|amusement/i, "entertainment.theme_park"],
  [/beach|playa/i, "beach"],
  [/waterfall|cascada|river|r[ií]o|lake|lago|spring|balneario/i, "natural.water"],
  [/mountain|volcano|volc[aá]n|trail|sendero|hiking|cerro/i, "natural.mountain"],
  [/national park|nature|reserve|reserva|forest|bosque/i, "national_park"],
  [/park|parque|plaza|garden|jard[ií]n/i, "leisure.park"],
  [/scenic|lookout|mirador|viewpoint/i, "tourism.attraction.viewpoint"],
  [/church|iglesia|cathedral|catedral|temple|templo/i, "tourism.sights.place_of_worship"],
  [/monument|monumento|historic|hist[oó]ric|ruins|ruinas|archaeolog/i, "tourism.sights"],
];
const CATEGORIA_POR_INTERES: Record<string, string> = {
  Compras: "commercial",
  "Gastronomía": "catering.restaurant",
  Cultura: "entertainment.culture",
  Arte: "entertainment.culture",
  Historia: "tourism.sights",
  Naturaleza: "leisure.park",
  Playa: "beach",
  Aventura: "entertainment.activity_park",
  "Fotografía": "tourism.attraction",
  "Vida nocturna": "catering.bar",
};

export function categoriaEquivalente(interes: string, nombresCategorias: string[]): string {
  for (const [patron, categoria] of EQUIVALENCIAS) {
    if (nombresCategorias.some((nombre) => patron.test(nombre))) return categoria;
  }
  return CATEGORIA_POR_INTERES[interes] ?? "tourism.attraction";
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

function aLugar(resultado: unknown, interes: string): LugarFoursquare | null {
  if (!esObjeto(resultado)) return null;
  const id = texto(resultado.fsq_place_id);
  const nombre = texto(resultado.name);
  const { latitude: lat, longitude: lng } = resultado;
  if (!id || !nombre || typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const nombresCategorias = Array.isArray(resultado.categories)
    ? resultado.categories.flatMap((c) => (esObjeto(c) && texto(c.name) ? [texto(c.name) as string] : []))
    : [];
  const aceptadas = CATEGORIAS_ACEPTADAS[interes];
  if (aceptadas && !nombresCategorias.some((nombre) => aceptadas.test(nombre) && !CATEGORIAS_DE_USO_DIARIO.test(nombre))) {
    return null;
  }
  const categoria = categoriaEquivalente(interes, nombresCategorias);
  const ubicacion = esObjeto(resultado.location) ? resultado.location : {};
  return {
    idExterno: `fsq:${id}`,
    proveedor: "foursquare",
    nombre,
    direccion: texto(ubicacion.formatted_address) ?? texto(ubicacion.address),
    lat,
    lng,
    categorias: [categoria.split(".")[0], ...(categoria.includes(".") ? [categoria] : [])],
    ...clasificarEntorno([categoria]),
  };
}

export function crearBuscadorFoursquare({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
  tiempoEsperaMs = TIEMPO_ESPERA_MS,
  cache = null,
}: {
  apiKey?: string;
  fetch?: FuncionFetch;
  tiempoEsperaMs?: number;
  cache?: CacheJson | null;
} = {}): BuscarEnFoursquare | null {
  const clave = apiKey?.trim();
  if (!clave) return null;

  return async function buscarEnFoursquare({ lat, lng, radio, limite, interes }) {
    const categorias = CATEGORIAS_POR_INTERES[interes];
    if (!categorias) return [];
    const url = new URL(URL_BUSQUEDA_FOURSQUARE);
    url.search = new URLSearchParams({
      ll: `${lat.toFixed(5)},${lng.toFixed(5)}`,
      radius: String(Math.round(radio)),
      fsq_category_ids: categorias.join(","),
      // Se piden todos los que permite una consulta (cuesta lo mismo): después del filtro por interés quedan menos.
      limit: String(MAX_RESULTADOS),
      sort: "RELEVANCE",
      fields: CAMPOS,
    }).toString();
    const claveCache = `cache:foursquare:${url.search}`;

    try {
      const guardado = await cache?.get<unknown[]>(claveCache);
      if (guardado) return guardado.flatMap((r) => aLugar(r, interes) ?? []).slice(0, limite);
    } catch {
      // Sin caché disponible se consulta directo.
    }

    // Si Foursquare falla, el itinerario se arma solo con OpenStreetMap: no es motivo para no generarlo.
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), tiempoEsperaMs);
    try {
      const respuesta = await fetchImpl(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${clave}`, "X-Places-Api-Version": VERSION_API_FOURSQUARE },
        signal: controlador.signal,
      });
      if (!respuesta.ok) {
        respuesta.body?.cancel().catch(() => {});
        console.warn(`Foursquare respondió ${respuesta.status}; se usan solo los lugares de OpenStreetMap.`);
        return [];
      }
      const datos = (await respuesta.json()) as unknown;
      const resultados = esObjeto(datos) && Array.isArray(datos.results) ? datos.results : [];
      try {
        await cache?.set(claveCache, resultados, TTL_CACHE_SEGUNDOS);
      } catch {
        // La caché es opcional.
      }
      return resultados.flatMap((r) => aLugar(r, interes) ?? []).slice(0, limite);
    } catch {
      return [];
    } finally {
      clearTimeout(temporizador);
    }
  };
}
