import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buscarCandidatos, esElMismoLugar, pareceUnaNota } from "../src/itinerarios/candidatos";
import { calcularImportancia, type Lugar } from "../src/geoapify/transformar";
import type { ConsultaBusqueda } from "../src/geoapify/cliente";
import type { EnriquecerHorarios } from "../src/geoapify/enriquecer";
import { clasificarEntorno } from "../src/clima/clasificacion";
import { ErrorApi } from "../src/errores";
import { crearGeocodificador } from "../src/geoapify/geocodificacion";

// Centro geográfico de Petén (en plena selva) y lugares a cierta distancia al norte de él.
const CENTRO_PETEN = { lat: 16.83, lng: -90.04 };
const KM = 1 / 111;

function lugar(id: string, nombre: string, kmAlNorte: number, categorias: string[], importancia = 0): Lugar {
  return {
    idExterno: id,
    proveedor: "geoapify",
    nombre,
    direccion: null,
    lat: CENTRO_PETEN.lat + kmAlNorte * KM,
    lng: CENTRO_PETEN.lng,
    categorias,
    importancia,
    ...clasificarEntorno(categorias),
  };
}

const sinHorarios: EnriquecerHorarios = async (lugares) =>
  lugares.map((l) => ({ ...l, horario: { estado: "no_disponible" } })) as never;

function buscadorFalso(lugares: Lugar[], consultas: ConsultaBusqueda[] = []) {
  return async (consulta: ConsultaBusqueda) => {
    consultas.push(consulta);
    return lugares.filter((l) => l.categorias.some((c) => consulta.categorias.some((p) => c === p || c.startsWith(`${p}.`))));
  };
}

const destinoArea = { nombre: "Petén, Guatemala", ...CENTRO_PETEN, zonaHoraria: "America/Guatemala", areaId: "area-peten" };
const destinoPueblo = { nombre: "Flores, PE, Guatemala", ...CENTRO_PETEN, zonaHoraria: "America/Guatemala" };

describe("candidatos del itinerario", () => {
  test("en un departamento busca en todo su límite y centra el viaje en su lugar más importante", async () => {
    const consultas: ConsultaBusqueda[] = [];
    const lugares = [
      lugar("plaza", "Monumento al ejército", 1, ["tourism", "tourism.sights", "tourism.sights.memorial"], -1),
      lugar("tikal", "Parque Nacional Tikal", 45, ["heritage", "heritage.unesco", "leisure"], 7),
      lugar("uaxactun", "Uaxactún", 68, ["tourism", "tourism.sights", "tourism.sights.archaeological_site"], 5),
      lugar("lejano", "Piedras Negras", 300, ["tourism", "tourism.sights", "tourism.sights.archaeological_site"], 5),
    ];
    const { candidatos, centro } = await buscarCandidatos({
      destino: destinoArea,
      intereses: ["Historia"],
      dias: 1,
      transporte: "Automovil",
      buscarLugares: buscadorFalso(lugares, consultas),
      enriquecerHorarios: sinHorarios,
    });

    assert.ok(consultas.every((c) => c.area === "area-peten" && c.conImportancia), "busca dentro del departamento");
    assert.deepEqual(centro, { lat: lugares[1].lat, lng: lugares[1].lng }, "el viaje se centra en Tikal");
    assert.deepEqual(candidatos.map((c) => c.placeId).slice(0, 2), ["tikal", "uaxactun"]);
    assert.ok(!candidatos.some((c) => c.placeId === "lejano"), "deja fuera lo que queda a más de 80 km del centro");
  });

  test("en un pueblo, lo importante de los alrededores va antes que lo más cercano", async () => {
    const lugares = [
      lugar("plaza", "Plaza de Flores", 0.1, ["tourism", "tourism.sights"], 0),
      lugar("tikal", "Parque Nacional Tikal", 40, ["heritage", "heritage.unesco", "leisure"], 7),
    ];
    const { candidatos, centro } = await buscarCandidatos({
      destino: destinoPueblo,
      intereses: ["Historia"],
      dias: 1,
      transporte: "Automovil",
      buscarLugares: buscadorFalso(lugares),
      enriquecerHorarios: sinHorarios,
    });

    assert.deepEqual(centro, CENTRO_PETEN, "en un pueblo el centro es el destino");
    assert.deepEqual(candidatos.map((c) => c.placeId), ["tikal", "plaza"]);
  });

  test("no propone el destino mismo ni las partes sueltas de un sitio", async () => {
    const lugares = [
      lugar("ciudad", "Flores", 0.2, ["heritage"], 4),
      lugar("estela", "Estela A", 1, ["tourism", "tourism.sights", "tourism.sights.memorial"], 0),
      lugar("conjunto", "Conjunto G", 1, ["tourism", "tourism.sights"], 2),
      lugar("tayasal", "Tayasal", 1, ["tourism", "tourism.sights", "tourism.sights.archaeological_site"], 2),
    ];
    const { candidatos } = await buscarCandidatos({
      destino: destinoPueblo,
      intereses: ["Historia"],
      dias: 1,
      transporte: "Automovil",
      buscarLugares: buscadorFalso(lugares),
      enriquecerHorarios: sinHorarios,
    });

    assert.deepEqual(candidatos.map((c) => c.placeId), ["tayasal"]);
  });

  test("los lugares menores solo rellenan cuando los buenos no alcanzan", async () => {
    const buenos = ["Tayasal", "Ixlú", "Nakum", "Yaxhá"].map((nombre, i) =>
      lugar(`b${i}`, nombre, i + 1, ["tourism", "tourism.sights", "tourism.sights.archaeological_site"], 2),
    );
    const iglesia = lugar("iglesia", "Iglesia Evangélica Central", 0.1, ["religion", "religion.place_of_worship"], -1);
    const buscar = (dias: number) =>
      buscarCandidatos({
        destino: destinoPueblo,
        intereses: ["Historia"],
        dias,
        transporte: "Automovil",
        buscarLugares: buscadorFalso([...buenos, iglesia]),
        enriquecerHorarios: sinHorarios,
      });

    assert.ok(!(await buscar(1)).candidatos.some((c) => c.placeId === "iglesia"), "un día: con 4 sitios basta");
    assert.ok((await buscar(2)).candidatos.some((c) => c.placeId === "iglesia"), "dos días: hace falta rellenar");
  });

  test("una categoría que tarda demasiado no tumba la búsqueda", async () => {
    const tikal = lugar("tikal", "Parque Nacional Tikal", 40, ["heritage", "heritage.unesco", "leisure"], 7);
    const { candidatos } = await buscarCandidatos({
      destino: destinoPueblo,
      intereses: ["Historia"],
      dias: 1,
      transporte: "Automovil",
      buscarLugares: async (consulta) => {
        if (consulta.categorias.includes("religion.place_of_worship")) {
          throw new ErrorApi(504, "PROVEEDOR_TIEMPO_AGOTADO", "El proveedor de lugares tardó demasiado en responder.");
        }
        return buscadorFalso([tikal])(consulta);
      },
      enriquecerHorarios: sinHorarios,
    });

    assert.deepEqual(candidatos.map((c) => c.placeId), ["tikal"]);
  });

  test("las plazas y acrópolis de Tikal se visitan dentro del parque, no como paradas aparte", async () => {
    const lugares = [
      lugar("tikal", "Parque Nacional Tikal", 40, ["heritage", "heritage.unesco", "leisure"], 7),
      lugar("acropolis", "Acrópolis del Norte", 42, ["leisure", "leisure.park", "tourism"], 3),
      lugar("museo", "Museo Sylvanus G. Morley", 41, ["entertainment", "entertainment.museum"], 0),
      lugar("uaxactun", "Uaxactún", 63, ["tourism", "tourism.sights", "tourism.sights.archaeological_site"], 5),
    ];
    const { candidatos } = await buscarCandidatos({
      destino: destinoArea,
      intereses: ["Historia", "Cultura"],
      dias: 2,
      transporte: "Automovil",
      buscarLugares: buscadorFalso(lugares),
      enriquecerHorarios: sinHorarios,
    });

    const ids = candidatos.map((c) => c.placeId);
    assert.ok(!ids.includes("acropolis"));
    assert.ok(ids.includes("museo"), "un museo cercano sigue siendo una parada");
    assert.ok(ids.includes("uaxactun"), "otro sitio a 23 km tampoco es parte de Tikal");
  });

  test("descarta las notas que alguien dejó en el mapa como si fueran lugares", () => {
    assert.ok(pareceUnaNota("detachment one hour from here"));
    assert.ok(pareceUnaNota("little farms owned by barcos"));
    assert.ok(pareceUnaNota("Calzada Maya from Tintal to El Mirador along the old road north"));
    assert.ok(!pareceUnaNota("Yaxhá"));
    assert.ok(!pareceUnaNota("Parque Nacional Yaxhá - Nakúm - Naranjo"));
    assert.ok(!pareceUnaNota("Sítio arqueológico Camul"));
  });

  test("une el mismo sitio aunque OpenStreetMap lo tenga como punto y como área separados", () => {
    const pueblo = lugar("a", "Río Dulce", 0, ["tourism"]);
    assert.ok(esElMismoLugar(pueblo, lugar("b", "Parque Nacional Río Dulce", 2, ["national_park"])));
    assert.ok(esElMismoLugar(lugar("c", "Bejucal", 0, ["tourism"]), lugar("d", "Bejucal", 16, ["tourism"])));
    assert.ok(!esElMismoLugar(pueblo, lugar("e", "Río Dulce", 40, ["tourism"])), "lejos, es otro lugar");
    assert.ok(!esElMismoLugar(lugar("f", "Parque", 0, ["leisure.park"]), lugar("g", "Parque Central", 1, ["leisure.park"])));
  });
});

describe("importancia de un lugar", () => {
  const conFicha = { datasource: { raw: { wikidata: "Q1" } } };

  test("suma por la ficha de Wikipedia y por el tipo de sitio", () => {
    assert.equal(calcularImportancia(["heritage", "heritage.unesco"], conFicha), 7);
    assert.equal(calcularImportancia(["tourism", "tourism.sights", "tourism.sights.archaeological_site"]), 2);
    assert.equal(calcularImportancia(["catering", "catering.restaurant"]), 0);
  });

  test("resta a lo que abunda y casi nunca es un destino", () => {
    assert.equal(calcularImportancia(["leisure", "leisure.park"]), -1);
    assert.equal(calcularImportancia(["tourism", "tourism.sights", "tourism.sights.memorial"]), -1);
    assert.equal(calcularImportancia(["religion", "religion.place_of_worship"]), -1);
    assert.equal(calcularImportancia(["catering", "catering.fast_food"], { datasource: { raw: { brand: "Pizza Hut" } } }), -1);
    assert.equal(calcularImportancia(["religion", "religion.place_of_worship"], conFicha), 3, "la iglesia colonial con ficha sí cuenta");
  });
});

describe("geocodificación de un departamento", () => {
  const respuesta = (resultado: Record<string, unknown>) =>
    new Response(JSON.stringify({ results: [{ lat: 16.83, lon: -90.04, rank: { confidence: 1 }, timezone: { name: "America/Guatemala" }, ...resultado }] }), {
      headers: { "Content-Type": "application/json" },
    });

  test("un departamento o municipio trae el id de su área; un pueblo no", async () => {
    const peten = await crearGeocodificador({ apiKey: "clave", fetch: async () => respuesta({ formatted: "Petén, Guatemala", result_type: "state", place_id: "id-peten" }) })("Petén");
    const flores = await crearGeocodificador({ apiKey: "clave", fetch: async () => respuesta({ formatted: "Flores", result_type: "city", place_id: "id-flores" }) })("Flores");
    assert.equal(peten?.areaId, "id-peten");
    assert.equal(flores?.areaId, undefined);
  });
});
