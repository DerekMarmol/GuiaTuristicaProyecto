import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crearApp } from "../src/app";
import { clasificarEntorno } from "../src/clima/clasificacion";
import { CLASIFICACION_POR_DEFECTO, REGLAS_ENTORNO_CLIMA } from "../src/config/entornoClima";
import { transformarDetalles, transformarLugares } from "../src/geoapify/transformar";

const CLAVE_CATEGORIA = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const POR_DEFECTO = { tipo_entorno: "outdoor", sensibilidad_clima: "alta", regla_clima: null };

describe("clasificarEntorno", () => {
  test("clasifica un museo como indoor con sensibilidad baja", () => {
    assert.deepEqual(clasificarEntorno(["entertainment", "entertainment.museum"]), {
      tipo_entorno: "indoor",
      sensibilidad_clima: "baja",
      regla_clima: "entertainment.museum",
    });
  });

  test("clasifica parques, jardines y playas como outdoor con sensibilidad alta", () => {
    assert.deepEqual(clasificarEntorno(["leisure", "leisure.park"]), { tipo_entorno: "outdoor", sensibilidad_clima: "alta", regla_clima: "leisure.park" });
    assert.deepEqual(clasificarEntorno(["leisure.park.garden"]), { tipo_entorno: "outdoor", sensibilidad_clima: "alta", regla_clima: "leisure.park" });
    assert.deepEqual(clasificarEntorno(["beach"]), { tipo_entorno: "outdoor", sensibilidad_clima: "alta", regla_clima: "beach" });
    assert.deepEqual(clasificarEntorno(["natural", "natural.mountain", "natural.mountain.volcano"]), {
      tipo_entorno: "outdoor",
      sensibilidad_clima: "alta",
      regla_clima: "natural",
    });
  });

  test("clasifica restaurantes y cafeterías como indoor con sensibilidad baja usando su regla específica", () => {
    assert.deepEqual(clasificarEntorno(["catering", "catering.restaurant", "catering.restaurant.italian"]), {
      tipo_entorno: "indoor",
      sensibilidad_clima: "baja",
      regla_clima: "catering.restaurant",
    });
    assert.deepEqual(clasificarEntorno(["catering.cafe.coffee_shop"]), { tipo_entorno: "indoor", sensibilidad_clima: "baja", regla_clima: "catering.cafe" });
  });

  test("usa todas las categorías: una categoría genérica como building no anula la regla del museo", () => {
    for (const categorias of [
      ["building", "entertainment", "entertainment.museum"],
      ["entertainment.museum", "building"],
      ["building.historic", "entertainment.museum"],
    ]) {
      assert.equal(clasificarEntorno(categorias).regla_clima, "entertainment.museum", categorias.join(","));
    }
  });

  test("la regla más específica prevalece sobre la de su categoría padre", () => {
    assert.deepEqual(clasificarEntorno(["catering", "catering.biergarten"]), {
      tipo_entorno: "outdoor",
      sensibilidad_clima: "alta",
      regla_clima: "catering.biergarten",
    });
    assert.deepEqual(clasificarEntorno(["beach", "beach.beach_resort"]), {
      tipo_entorno: "outdoor",
      sensibilidad_clima: "media",
      regla_clima: "beach.beach_resort",
    });
    assert.deepEqual(clasificarEntorno(["tourism", "tourism.sights", "tourism.sights.place_of_worship", "tourism.sights.place_of_worship.church", "building"]), {
      tipo_entorno: "indoor",
      sensibilidad_clima: "baja",
      regla_clima: "tourism.sights.place_of_worship",
    });
  });

  test("entre reglas igual de específicas y contradictorias elige la más conservadora sin depender del orden", () => {
    const esperado = { tipo_entorno: "outdoor", sensibilidad_clima: "alta", regla_clima: "leisure.park" };
    assert.deepEqual(clasificarEntorno(["catering.restaurant", "leisure.park"]), esperado);
    assert.deepEqual(clasificarEntorno(["leisure.park", "catering.restaurant"]), esperado);
    assert.deepEqual(clasificarEntorno(["entertainment.museum", "commercial.marketplace"]), {
      tipo_entorno: "outdoor",
      sensibilidad_clima: "media",
      regla_clima: "commercial.marketplace",
    });
  });

  test("aplica la política por defecto explícita a categorías desconocidas o ausentes", () => {
    assert.deepEqual(CLASIFICACION_POR_DEFECTO, { tipo_entorno: "outdoor", sensibilidad_clima: "alta" });
    for (const categorias of [[], ["building"], ["commercial.supermarket"], ["tourism", "tourism.sights"], ["heritage"]]) {
      assert.deepEqual(clasificarEntorno(categorias), POR_DEFECTO, categorias.join(",") || "sin categorías");
    }
  });

  test("no interpreta coincidencias parciales de texto como categorías", () => {
    assert.deepEqual(clasificarEntorno(["beachfront"]), POR_DEFECTO);
    assert.deepEqual(clasificarEntorno(["entertainment.museumx"]), POR_DEFECTO);
  });

  test("es determinista y no modifica las categorías recibidas", () => {
    const categorias = Object.freeze(["leisure.park", "catering.restaurant", "building"]);
    assert.deepEqual(clasificarEntorno(categorias), clasificarEntorno(categorias));
    assert.deepEqual(categorias, ["leisure.park", "catering.restaurant", "building"]);
  });
});

describe("reglas de entorno climático", () => {
  test("cada regla usa una clave de categoría válida, única y valores del contrato", () => {
    const vistas = new Set<string>();
    for (const regla of REGLAS_ENTORNO_CLIMA) {
      assert.match(regla.categoria, CLAVE_CATEGORIA, regla.categoria);
      assert.ok(!vistas.has(regla.categoria), `regla repetida: ${regla.categoria}`);
      vistas.add(regla.categoria);
      assert.ok(["indoor", "outdoor"].includes(regla.tipo_entorno), regla.categoria);
      assert.ok(["baja", "media", "alta"].includes(regla.sensibilidad_clima), regla.categoria);
    }
    assert.ok(Object.isFrozen(REGLAS_ENTORNO_CLIMA));
  });
});

describe("clasificación en lugares de Geoapify", () => {
  const PROPIEDADES = [
    { place_id: "museo", name: "Museo", lat: 14.6, lon: -90.5, categories: ["building", "entertainment", "entertainment.museum"] },
    { place_id: "parque", name: "Parque", lat: 14.6, lon: -90.5, categories: ["leisure", "leisure.park"] },
    { place_id: "playa", name: "Playa", lat: 13.9, lon: -91.0, categories: ["beach"] },
    { place_id: "otro", name: "Supermercado", lat: 14.6, lon: -90.5, categories: ["commercial", "commercial.supermarket"] },
  ];

  test("Places y Place Details producen la misma clasificación para las mismas categorías", () => {
    const desdeBusqueda = transformarLugares({ features: PROPIEDADES.map((properties) => ({ properties })) });
    for (const lugar of desdeBusqueda) {
      const propiedades = PROPIEDADES.find((p) => p.place_id === lugar.idExterno);
      const desdeDetalles = transformarDetalles({ ...propiedades, place_id: "codificacion-distinta" }, lugar.idExterno);
      assert.ok(desdeDetalles);
      assert.deepEqual(
        [desdeDetalles.tipo_entorno, desdeDetalles.sensibilidad_clima, desdeDetalles.regla_clima],
        [lugar.tipo_entorno, lugar.sensibilidad_clima, lugar.regla_clima],
      );
    }
    assert.deepEqual(
      desdeBusqueda.map((lugar) => [lugar.idExterno, lugar.tipo_entorno, lugar.sensibilidad_clima, lugar.regla_clima]),
      [
        ["museo", "indoor", "baja", "entertainment.museum"],
        ["parque", "outdoor", "alta", "leisure.park"],
        ["playa", "outdoor", "alta", "beach"],
        ["otro", "outdoor", "alta", null],
      ],
    );
  });

  test("GET /api/lugares devuelve tipo_entorno y sensibilidad_clima en todos los lugares", async () => {
    const app = crearApp({
      apiKey: "clave-de-prueba-no-real-clasificacion",
      detalles: { tiempoEsperaMs: 50, intervaloMs: 0, presupuestoMs: 1000 },
      fetch: async (url: string | URL) => {
        const direccion = new URL(url);
        const cuerpo =
          direccion.pathname === "/v2/place-details"
            ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { feature_type: "details", place_id: direccion.searchParams.get("id") } }] }
            : { type: "FeatureCollection", features: PROPIEDADES.map((properties) => ({ type: "Feature", properties })) };
        return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const servidor: Server = app.server;
    try {
      const respuesta = await fetch(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/lugares?lat=14.6&lng=-90.5&intereses=Cultura,Naturaleza`);
      const cuerpo = (await respuesta.json()) as { lugares: Record<string, unknown>[] };

      assert.equal(respuesta.status, 200);
      assert.equal(cuerpo.lugares.length, PROPIEDADES.length);
      for (const lugar of cuerpo.lugares) {
        assert.ok(["indoor", "outdoor"].includes(lugar.tipo_entorno as string), String(lugar.idExterno));
        assert.ok(["baja", "media", "alta"].includes(lugar.sensibilidad_clima as string), String(lugar.idExterno));
        assert.ok("regla_clima" in lugar);
      }
      assert.deepEqual(
        cuerpo.lugares.map((lugar) => [lugar.idExterno, lugar.tipo_entorno, lugar.sensibilidad_clima, lugar.regla_clima]),
        [
          ["museo", "indoor", "baja", "entertainment.museum"],
          ["parque", "outdoor", "alta", "leisure.park"],
          ["playa", "outdoor", "alta", "beach"],
          ["otro", "outdoor", "alta", null],
        ],
      );
    } finally {
      servidor.closeAllConnections();
      servidor.close();
    }
  });
});
