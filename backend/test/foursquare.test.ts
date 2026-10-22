import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { categoriaEquivalente, crearBuscadorFoursquare, VERSION_API_FOURSQUARE } from "../src/foursquare/cliente";
import { crearGeneradorItinerario } from "../src/itinerarios/generacion";
import type { Lugar } from "../src/geoapify/transformar";

const JALAPA = { nombre: "Jalapa, JA, Guatemala", lat: 14.6344, lng: -89.9898, zonaHoraria: "America/Guatemala" };

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

const resultado = (id: string, nombre: string, lat: number, lng: number, categoria: string) => ({
  fsq_place_id: id,
  name: nombre,
  latitude: lat,
  longitude: lng,
  distance: 300,
  categories: [{ fsq_category_id: "x", name: categoria }],
  location: { formatted_address: `${nombre}, Jalapa` },
});

describe("Foursquare Places (GUI-117)", () => {
  test("sin clave no se usa", () => {
    assert.equal(crearBuscadorFoursquare({ apiKey: "" }), null);
    assert.equal(crearBuscadorFoursquare({}), null);
  });

  test("busca por la categoría del interés con la clave y la versión de la API", async () => {
    let url: URL | null = null;
    let encabezados: Record<string, string> = {};
    const buscar = crearBuscadorFoursquare({
      apiKey: "clave-de-prueba",
      fetch: async (u, opciones) => {
        url = u;
        encabezados = opciones?.headers as Record<string, string>;
        return respuestaJson({
          results: [
            resultado("a1", "Paca", 14.633, -89.99, "Clothing Store"),
            resultado("a2", "Ferretería Medina", 14.634, -89.989, "Hardware Store"),
            resultado("a3", "Plaza San Francisco", 14.6316, -89.9895, "Shopping Mall"),
            resultado("a4", "Supermercado La Torre", 14.635, -89.988, "Supermarket"),
            resultado("a5", "Mercado Municipal", 14.632, -89.99, "Market"),
            { name: "Sin id ni coordenadas" },
          ],
        });
      },
    })!;

    const lugares = await buscar({ lat: 14.6344, lng: -89.9898, radio: 5000, limite: 10, interes: "Compras" });

    assert.equal(url!.origin + url!.pathname, "https://places-api.foursquare.com/places/search");
    assert.equal(url!.searchParams.get("ll"), "14.63440,-89.98980");
    assert.equal(url!.searchParams.get("radius"), "5000");
    assert.equal(url!.searchParams.get("fsq_category_ids"), "4d4b7105d754a06378d81259");
    assert.ok(!url!.searchParams.get("fields")!.includes("hours"), "no pide campos que pueden ser de pago");
    assert.equal(encabezados.Authorization, "Bearer clave-de-prueba");
    assert.equal(encabezados["X-Places-Api-Version"], VERSION_API_FOURSQUARE);

    assert.deepEqual(
      lugares.map((l) => [l.idExterno, l.nombre, l.categorias.at(-1), l.proveedor]),
      [
        ["fsq:a1", "Paca", "commercial", "foursquare"],
        ["fsq:a3", "Plaza San Francisco", "commercial.shopping_mall", "foursquare"],
        ["fsq:a5", "Mercado Municipal", "commercial.marketplace", "foursquare"],
      ],
      "deja fuera ferreterías y supermercados: no son un paseo de compras",
    );
    assert.equal(lugares[1].direccion, "Plaza San Francisco, Jalapa");
  });

  test("cada interés acepta solo sus categorías: un café sirve para comer, no para compras", async () => {
    const buscar = crearBuscadorFoursquare({
      apiKey: "clave",
      fetch: async () => respuestaJson({ results: [resultado("c1", "Café Jalapa", 14.634, -89.989, "Café")] }),
    })!;
    const paraComer = await buscar({ lat: 14.6, lng: -90, radio: 5000, limite: 10, interes: "Gastronomía" });
    assert.equal(paraComer[0].categorias.at(-1), "catering.cafe");
    assert.deepEqual(await buscar({ lat: 14.6, lng: -90, radio: 5000, limite: 10, interes: "Compras" }), []);
  });

  test("si Foursquare falla, no rompe la búsqueda", async () => {
    const buscar = crearBuscadorFoursquare({ apiKey: "clave", fetch: async () => respuestaJson({ message: "no" }, 401) })!;
    assert.deepEqual(await buscar({ lat: 14.6, lng: -90, radio: 5000, limite: 10, interes: "Compras" }), []);
  });

  test("traduce las categorías de Foursquare a las que usa el generador", () => {
    assert.equal(categoriaEquivalente("Naturaleza", ["Waterfall"]), "natural.water");
    assert.equal(categoriaEquivalente("Aventura", ["Water Park"]), "entertainment.theme_park");
    assert.equal(categoriaEquivalente("Historia", ["Cemetery"]), "tourism.sights");
    assert.equal(categoriaEquivalente("Cultura", ["Museum"]), "entertainment.museum");
    assert.equal(categoriaEquivalente("Compras", ["Hardware Store"]), "commercial");
  });

  test("el generador suma los lugares de Foursquare a los de OpenStreetMap, sin duplicados", async () => {
    const plazaOsm: Lugar = {
      idExterno: "osm-plaza", proveedor: "geoapify", nombre: "Plaza San Francisco", direccion: null,
      lat: 14.6316, lng: -89.9895, categorias: ["commercial", "commercial.shopping_mall"],
      tipo_entorno: "indoor", sensibilidad_clima: "baja", regla_clima: null,
    };
    const consultadosEnDetalles: string[] = [];
    const generar = crearGeneradorItinerario({
      geocodificar: async () => JALAPA,
      buscarLugares: async (c) => (c.categorias[0] === "commercial.shopping_mall" ? [plazaOsm] : []),
      enriquecerHorarios: async (lugares) => {
        consultadosEnDetalles.push(...lugares.map((l) => l.idExterno));
        return lugares.map((l) => ({ ...l, horario: { estado: "no_publicado" as const, valorOriginal: null, fuente: "geoapify" as const } }));
      },
      buscarEnFoursquare: async () => [
        { ...plazaOsm, idExterno: "fsq:dup", proveedor: "foursquare", nombre: "PLAZA San Francisco", lat: 14.6317 },
        // Mismo lugar con nombre más corto en la otra fuente.
        { ...plazaOsm, idExterno: "fsq:dup2", proveedor: "foursquare", nombre: "Plaza Francisco", lat: 14.6318 },
        { ...plazaOsm, idExterno: "fsq:paca", proveedor: "foursquare", nombre: "Paca La Económica", lat: 14.633, categorias: ["commercial"] },
        { ...plazaOsm, idExterno: "fsq:zapateria", proveedor: "foursquare", nombre: "Zapatería El Paso", lat: 14.634, categorias: ["commercial"] },
      ],
      ahora: () => new Date("2026-11-01T15:00:00Z"),
    });

    const plan = await generar({
      destino: "Jalapa", fechaInicio: "2026-11-10", fechaFin: "2026-11-10", intereses: ["Compras"],
      tipoViaje: "solo", transporte: "Moto", presupuesto: 0, hospedaje: false,
    });

    const nombres = plan.itinerarios.flatMap((it) => it.paradas.map((p) => p.nombre));
    assert.deepEqual([...nombres].sort(), ["Paca La Económica", "Plaza San Francisco", "Zapatería El Paso"]);
    assert.ok(plan.itinerarios[0].paradas.some((p) => p.placeId === "osm-plaza"), "el duplicado se queda con el de OpenStreetMap");
    assert.deepEqual(consultadosEnDetalles, ["osm-plaza"], "solo se consulta el horario de los lugares de OpenStreetMap");
  });
});
