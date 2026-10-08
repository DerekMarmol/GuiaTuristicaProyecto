const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validarConsultaLugares, normalizarInteres } = require("../src/validacion/lugares");
const { transformarLugares } = require("../src/geoapify/transformar");
const { CATEGORIAS_POR_INTERES, INTERESES_PERMITIDOS } = require("../src/config/intereses");
const { ErrorApi } = require("../src/errores");

const CLAVE_CATEGORIA = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

describe("configuración de intereses", () => {
  test("coincide con los intereses que ofrece el frontend", () => {
    const archivo = path.join(__dirname, "..", "..", "frontend", "src", "pages", "Paso3Contexto.tsx");
    const fuente = fs.readFileSync(archivo, "utf8");
    const bloque = fuente.match(/const INTERESES = \[([\s\S]*?)\];/);
    assert.ok(bloque, "no se encontró la lista INTERESES en Paso3Contexto.tsx");
    const delFrontend = [...bloque[1].matchAll(/"([^"]+)"/g)].map((coincidencia) => coincidencia[1]);

    assert.deepEqual([...INTERESES_PERMITIDOS].sort(), [...delFrontend].sort());
  });

  test("cada interés tiene categorías con formato de clave de Geoapify y sin repetir", () => {
    for (const [interes, categorias] of Object.entries(CATEGORIAS_POR_INTERES)) {
      assert.ok(categorias.length > 0, interes);
      assert.equal(new Set(categorias).size, categorias.length, interes);
      for (const categoria of categorias) {
        assert.match(categoria, CLAVE_CATEGORIA, `${interes}: ${categoria}`);
      }
    }
  });
});

describe("validarConsultaLugares", () => {
  test("conserva las consultas solo con categoria", () => {
    assert.deepEqual(validarConsultaLugares({ lat: "14.6", lng: "-90.5", categoria: "catering.cafe" }), {
      lat: 14.6,
      lng: -90.5,
      categorias: ["catering.cafe"],
      intereses: [],
      radio: 5000,
      limite: 20,
    });
  });

  test("traduce y deduplica intereses normalizados", () => {
    const consulta = validarConsultaLugares({ lat: "0", lng: "0", intereses: " playa ,PLAYA,Playa" });

    assert.deepEqual(consulta.intereses, ["Playa"]);
    assert.deepEqual(consulta.categorias, ["beach"]);
  });

  test("exige categoria o intereses", () => {
    assert.throws(
      () => validarConsultaLugares({ lat: "14.6", lng: "-90.5" }),
      (error) => error instanceof ErrorApi && error.estado === 400 && error.detalles[0].parametro === "categoria",
    );
  });

  test("normalizarInteres ignora mayúsculas, tildes y espacios exteriores", () => {
    assert.equal(normalizarInteres("  Fotografía "), "fotografia");
    assert.equal(normalizarInteres("VIDA NOCTURNA"), "vida nocturna");
    assert.equal(normalizarInteres("GastronomÍa"), "gastronomia");
  });
});

describe("transformarLugares", () => {
  test("transforma un lugar válido y deduplica sus categorías", () => {
    const lugares = transformarLugares({
      type: "FeatureCollection",
      features: [
        {
          properties: {
            place_id: "id-1",
            name: "Mercado Central",
            formatted: "8a Avenida, Zona 1",
            lat: 14.6417,
            lon: -90.5128,
            categories: ["commercial.marketplace", "commercial.marketplace", "building"],
          },
        },
      ],
    });

    assert.deepEqual(lugares, [
      {
        idExterno: "id-1",
        proveedor: "geoapify",
        nombre: "Mercado Central",
        direccion: "8a Avenida, Zona 1",
        lat: 14.6417,
        lng: -90.5128,
        categorias: ["commercial.marketplace", "building"],
      },
    ]);
  });

  test("devuelve vacío si todos los registros incumplen los campos mínimos", () => {
    const lugares = transformarLugares({
      features: [
        { properties: { place_id: "a", name: "", lat: 1, lon: 1, categories: ["beach"] } },
        { properties: { place_id: "b", name: "B", lat: Number.NaN, lon: 1, categories: ["beach"] } },
        { properties: { place_id: "c", name: "C", lat: 1, lon: 181, categories: ["beach"] } },
        { properties: { place_id: "d", name: "D", lat: 1, lon: 1, categories: [] } },
      ],
    });

    assert.deepEqual(lugares, []);
  });

  test("rechaza estructuras inválidas en lugar de devolver vacío", () => {
    for (const datos of [null, {}, { features: {} }, []]) {
      assert.throws(() => transformarLugares(datos), (error) => error.codigo === "PROVEEDOR_RESPUESTA_INVALIDA");
    }
  });
});
