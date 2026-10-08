const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { crearApp } = require("../src/app");

const CLAVE = "clave-de-prueba-no-real-123";

let simulador;
let llamadas;
let servidor;
let baseUrl;

function simular(responder) {
  simulador = responder;
}

function respuestaJson(cuerpo, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json" },
  });
}

function coleccion(features) {
  return { type: "FeatureCollection", features };
}

function feature(propiedades) {
  return { type: "Feature", properties: propiedades, geometry: { type: "Point", coordinates: [propiedades.lon, propiedades.lat] } };
}

async function consultar(ruta) {
  const respuesta = await fetch(`${baseUrl}${ruta}`);
  const texto = await respuesta.text();
  return { estado: respuesta.status, texto, cuerpo: JSON.parse(texto) };
}

function verificarError(resultado, estado, codigo) {
  assert.equal(resultado.estado, estado);
  assert.equal(resultado.cuerpo.error.codigo, codigo);
  assert.equal(typeof resultado.cuerpo.error.mensaje, "string");
  assert.ok(!resultado.texto.includes(CLAVE));
  assert.ok(!resultado.texto.includes("apiKey"));
}

before(async () => {
  const app = crearApp({
    apiKey: CLAVE,
    tiempoEsperaMs: 50,
    fetch: async (url, opciones) => {
      llamadas.push({ url: new URL(url), opciones });
      return simulador(url, opciones);
    },
  });
  servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  baseUrl = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

beforeEach(() => {
  llamadas = [];
  simular(() => respuestaJson(coleccion([])));
});

describe("GET /api/lugares - consulta exitosa", () => {
  test("transforma los resultados de Geoapify al formato uniforme", async () => {
    simular(() =>
      respuestaJson(
        coleccion([
          feature({
            place_id: "abc123",
            name: "Museo Nacional de Arqueología",
            formatted: "Zona 13, Ciudad de Guatemala, Guatemala",
            lat: 14.5907,
            lon: -90.5242,
            categories: ["entertainment", "entertainment.museum"],
            distance: 120,
          }),
        ]),
      ),
    );

    const resultado = await consultar("/api/lugares?lat=14.6349&lng=-90.5069&categoria=entertainment.museum");

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo, {
      lugares: [
        {
          idExterno: "abc123",
          proveedor: "geoapify",
          nombre: "Museo Nacional de Arqueología",
          direccion: "Zona 13, Ciudad de Guatemala, Guatemala",
          lat: 14.5907,
          lng: -90.5242,
          categorias: ["entertainment", "entertainment.museum"],
        },
      ],
    });
  });

  test("envía a Geoapify longitud antes que latitud y los parámetros esperados", async () => {
    await consultar("/api/lugares?lat=14.6349&lng=-90.5069&categoria=catering.cafe&radio=1500&limite=7");

    assert.equal(llamadas.length, 1);
    const { url, opciones } = llamadas[0];
    assert.equal(url.origin + url.pathname, "https://api.geoapify.com/v2/places");
    assert.equal(url.searchParams.get("categories"), "catering.cafe");
    assert.equal(url.searchParams.get("filter"), "circle:-90.5069,14.6349,1500");
    assert.equal(url.searchParams.get("bias"), "proximity:-90.5069,14.6349");
    assert.equal(url.searchParams.get("limit"), "7");
    assert.equal(url.searchParams.get("lang"), "es");
    assert.equal(url.searchParams.get("apiKey"), CLAVE);
    assert.ok(opciones.signal instanceof AbortSignal);
  });

  test("aplica radio 5000 y límite 20 por defecto", async () => {
    await consultar("/api/lugares?lat=14.6&lng=-90.5&categoria=catering.restaurant");

    const { url } = llamadas[0];
    assert.equal(url.searchParams.get("filter"), "circle:-90.5,14.6,5000");
    assert.equal(url.searchParams.get("limit"), "20");
  });

  test("acepta coordenadas iguales a cero", async () => {
    const resultado = await consultar("/api/lugares?lat=0&lng=0&categoria=accommodation.hotel");

    assert.equal(resultado.estado, 200);
    assert.equal(llamadas[0].url.searchParams.get("filter"), "circle:0,0,5000");
    assert.equal(llamadas[0].url.searchParams.get("bias"), "proximity:0,0");
  });

  test("acepta los valores límite de coordenadas, radio y límite", async () => {
    const resultado = await consultar("/api/lugares?lat=-90&lng=180&categoria=leisure.park&radio=50000&limite=100");

    assert.equal(resultado.estado, 200);
    assert.equal(llamadas[0].url.searchParams.get("filter"), "circle:180,-90,50000");
    assert.equal(llamadas[0].url.searchParams.get("limit"), "100");
  });

  test("permite dirección ausente y descarta lugares sin nombre", async () => {
    simular(() =>
      respuestaJson(
        coleccion([
          feature({ place_id: "sin-nombre", formatted: "Calle 1", lat: 14.6, lon: -90.5, categories: ["catering.cafe"] }),
          feature({ place_id: "sin-direccion", name: "Café Central", lat: 14.61, lon: -90.51, categories: ["catering.cafe"] }),
          feature({ place_id: "nombre-vacio", name: "  ", formatted: "Calle 2", lat: 14.62, lon: -90.52, categories: ["catering.cafe"] }),
          feature({ place_id: "direccion-vacia", name: "Café Sur", formatted: "", lat: 14.63, lon: -90.53, categories: ["catering.cafe"] }),
        ]),
      ),
    );

    const resultado = await consultar("/api/lugares?lat=14.6&lng=-90.5&categoria=catering.cafe");

    assert.equal(resultado.estado, 200);
    assert.deepEqual(
      resultado.cuerpo.lugares.map((lugar) => [lugar.idExterno, lugar.nombre, lugar.direccion]),
      [
        ["sin-direccion", "Café Central", null],
        ["direccion-vacia", "Café Sur", null],
      ],
    );
  });

  test("conserva los nombres como texto sin interpretarlos", async () => {
    simular(() =>
      respuestaJson(
        coleccion([feature({ place_id: "x", name: "<b>Bar & Grill</b>", lat: 1, lon: 2, categories: ["catering.restaurant"] })]),
      ),
    );

    const resultado = await consultar("/api/lugares?lat=1&lng=2&categoria=catering.restaurant");

    assert.equal(resultado.cuerpo.lugares[0].nombre, "<b>Bar & Grill</b>");
  });

  test("devuelve lugares vacío cuando no hay resultados", async () => {
    const resultado = await consultar("/api/lugares?lat=14.6&lng=-90.5&categoria=tourism.sights");

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo, { lugares: [] });
  });

  test("elimina duplicados y descarta registros incompletos", async () => {
    simular(() =>
      respuestaJson(
        coleccion([
          feature({ place_id: "a", name: "Primero", lat: 14.6, lon: -90.5, categories: ["tourism.attraction"] }),
          feature({ place_id: "a", name: "Duplicado", lat: 14.6, lon: -90.5, categories: ["tourism.attraction"] }),
          feature({ name: "Sin id", lat: 14.6, lon: -90.5 }),
          feature({ place_id: "", name: "Id vacío", lat: 14.6, lon: -90.5 }),
          feature({ place_id: 42, name: "Id numérico", lat: 14.6, lon: -90.5 }),
          feature({ place_id: "sin-lat", lon: -90.5 }),
          feature({ place_id: "lat-texto", lat: "14.6", lon: -90.5 }),
          feature({ place_id: "fuera-de-rango", lat: 95, lon: -90.5 }),
          { type: "Feature" },
          null,
          "texto",
          feature({ place_id: "b", name: "Segundo", lat: 14.7, lon: -90.6, categories: ["tourism.attraction"] }),
        ]),
      ),
    );

    const resultado = await consultar("/api/lugares?lat=14.6&lng=-90.5&categoria=tourism.attraction");

    assert.equal(resultado.estado, 200);
    assert.deepEqual(
      resultado.cuerpo.lugares.map((lugar) => [lugar.idExterno, lugar.nombre]),
      [
        ["a", "Primero"],
        ["b", "Segundo"],
      ],
    );
  });
});

describe("GET /api/lugares - validación de parámetros", () => {
  const BASE = { lat: "14.6", lng: "-90.5", categoria: "entertainment.museum" };

  const casosInvalidos = [
    ["falta lat", { lat: undefined }],
    ["falta lng", { lng: undefined }],
    ["falta categoria", { categoria: undefined }],
    ["lat vacío", { lat: "" }],
    ["lng vacío", { lng: "" }],
    ["categoria vacía", { categoria: "" }],
    ["lat con texto", { lat: "14abc" }],
    ["lat NaN", { lat: "NaN" }],
    ["lat Infinity", { lat: "Infinity" }],
    ["lng -Infinity", { lng: "-Infinity" }],
    ["lat incompleta con punto final", { lat: "14." }],
    ["lat solo signo", { lat: "-" }],
    ["lat sin parte entera", { lat: ".5" }],
    ["lat en notación exponencial", { lat: "1e1" }],
    ["lat hexadecimal", { lat: "0x10" }],
    ["lat con espacios", { lat: " 14.6" }],
    ["lat mayor a 90", { lat: "90.0001" }],
    ["lat menor a -90", { lat: "-91" }],
    ["lng mayor a 180", { lng: "180.5" }],
    ["lng menor a -180", { lng: "-181" }],
    ["categoria no admitida", { categoria: "commercial.supermarket" }],
    ["categoria con mayúsculas", { categoria: "Entertainment.Museum" }],
    ["radio cero", { radio: "0" }],
    ["radio mayor a 50000", { radio: "50001" }],
    ["radio decimal", { radio: "1.5" }],
    ["radio negativo", { radio: "-10" }],
    ["radio vacío", { radio: "" }],
    ["radio con texto", { radio: "100m" }],
    ["limite cero", { limite: "0" }],
    ["limite mayor a 100", { limite: "101" }],
    ["limite decimal", { limite: "2.0" }],
    ["limite vacío", { limite: "" }],
    ["intereses vacío", { intereses: "" }],
    ["intereses con elemento final vacío", { intereses: "Cultura," }],
    ["intereses solo con comas", { intereses: "," }],
    ["intereses con elemento de espacios", { intereses: "Cultura, ,Arte" }],
    ["interés desconocido", { intereses: "Deportes" }],
    ["interés desconocido junto a uno válido", { categoria: undefined, intereses: "Cultura,Deportes" }],
    ["categoría de Geoapify enviada como interés", { categoria: undefined, intereses: "entertainment.museum" }],
    ["interés desconocido con categoría inválida", { categoria: "otra", intereses: "Cultura" }],
  ];

  for (const [descripcion, cambios] of casosInvalidos) {
    test(`rechaza ${descripcion} sin consultar a Geoapify`, async () => {
      const parametros = new URLSearchParams();
      for (const [clave, valor] of Object.entries({ ...BASE, ...cambios })) {
        if (valor !== undefined) {
          parametros.set(clave, valor);
        }
      }

      const resultado = await consultar(`/api/lugares?${parametros}`);

      verificarError(resultado, 400, "PARAMETRO_INVALIDO");
      assert.ok(Array.isArray(resultado.cuerpo.error.detalles));
      assert.equal(llamadas.length, 0);
    });
  }

  test("rechaza parámetros repetidos", async () => {
    const resultado = await consultar("/api/lugares?lat=14.6&lat=15&lng=-90.5&categoria=entertainment.museum");

    verificarError(resultado, 400, "PARAMETRO_INVALIDO");
    assert.equal(llamadas.length, 0);
  });

  test("rechaza parámetros con estructura de objeto", async () => {
    const resultado = await consultar("/api/lugares?lat[valor]=14.6&lng=-90.5&categoria=entertainment.museum");

    verificarError(resultado, 400, "PARAMETRO_INVALIDO");
    assert.equal(llamadas.length, 0);
  });

  test("informa todos los parámetros inválidos y las categorías permitidas", async () => {
    const resultado = await consultar("/api/lugares?lat=abc&categoria=otra");

    const parametros = resultado.cuerpo.error.detalles.map((detalle) => detalle.parametro);
    assert.deepEqual(parametros, ["lat", "lng", "categoria"]);
    const detalleCategoria = resultado.cuerpo.error.detalles.find((detalle) => detalle.parametro === "categoria");
    assert.match(detalleCategoria.mensaje, /entertainment\.museum/);
  });
});

describe("GET /api/lugares - búsqueda por intereses", () => {
  function rutaIntereses(parametros) {
    return `/api/lugares?${new URLSearchParams({ lat: "14.6349", lng: "-90.5069", ...parametros })}`;
  }

  function categoriasEnviadas() {
    return llamadas[0].url.searchParams.get("categories").split(",");
  }

  test("un interés se traduce a sus categorías de Geoapify", async () => {
    simular(() =>
      respuestaJson(
        coleccion([
          feature({ place_id: "m1", name: "Museo Popol Vuh", lat: 14.6045, lon: -90.4895, categories: ["entertainment", "entertainment.museum"] }),
        ]),
      ),
    );

    const resultado = await consultar(rutaIntereses({ intereses: "Cultura" }));

    assert.equal(resultado.estado, 200);
    assert.equal(llamadas.length, 1);
    assert.deepEqual(categoriasEnviadas(), ["entertainment.culture", "entertainment.museum"]);
    assert.deepEqual(resultado.cuerpo.lugares, [
      {
        idExterno: "m1",
        proveedor: "geoapify",
        nombre: "Museo Popol Vuh",
        direccion: null,
        lat: 14.6045,
        lng: -90.4895,
        categorias: ["entertainment", "entertainment.museum"],
      },
    ]);
  });

  test("varios intereses se consultan en una sola petición con la unión de categorías", async () => {
    await consultar(rutaIntereses({ intereses: "Gastronomía,Vida nocturna,Playa" }));

    assert.equal(llamadas.length, 1);
    assert.deepEqual(categoriasEnviadas(), [
      "catering.restaurant",
      "catering.cafe",
      "catering.bar",
      "catering.pub",
      "adult.nightclub",
      "beach",
    ]);
    assert.equal(llamadas[0].url.searchParams.get("filter"), "circle:-90.5069,14.6349,5000");
    assert.equal(llamadas[0].url.searchParams.get("bias"), "proximity:-90.5069,14.6349");
  });

  test("combina categoria e intereses como unión sin categorías duplicadas", async () => {
    await consultar(rutaIntereses({ categoria: "entertainment.museum", intereses: "Cultura,Arte" }));

    assert.deepEqual(categoriasEnviadas(), [
      "entertainment.museum",
      "entertainment.culture",
      "entertainment.culture.gallery",
      "entertainment.culture.arts_centre",
      "tourism.attraction.artwork",
      "commercial.art",
    ]);
  });

  test("elimina categorías compartidas entre intereses", async () => {
    await consultar(rutaIntereses({ intereses: "Historia,Fotografía" }));

    assert.deepEqual(categoriasEnviadas(), ["tourism.sights", "heritage", "tourism.attraction"]);
  });

  test("normaliza mayúsculas, espacios exteriores y tildes", async () => {
    await consultar(rutaIntereses({ intereses: "  GASTRONOMIA , vida NOCTURNA,fotografía , Gastronomía" }));

    assert.equal(llamadas.length, 1);
    assert.deepEqual(categoriasEnviadas(), [
      "catering.restaurant",
      "catering.cafe",
      "catering.bar",
      "catering.pub",
      "adult.nightclub",
      "tourism.attraction",
      "tourism.sights",
    ]);
  });

  test("acepta los diez intereses del frontend", async () => {
    const resultado = await consultar(
      rutaIntereses({
        intereses: "Cultura,Historia,Gastronomía,Naturaleza,Aventura,Compras,Vida nocturna,Playa,Fotografía,Arte",
      }),
    );

    assert.equal(resultado.estado, 200);
    assert.equal(llamadas.length, 1);
    const categorias = categoriasEnviadas();
    assert.equal(new Set(categorias).size, categorias.length);
  });

  test("el límite se aplica al total y no se multiplica por la cantidad de intereses", async () => {
    const muchos = Array.from({ length: 8 }, (_, indice) =>
      feature({ place_id: `p${indice}`, name: `Lugar ${indice}`, lat: 14.6, lon: -90.5, categories: ["catering.cafe"] }),
    );
    simular(() => respuestaJson(coleccion(muchos)));

    const resultado = await consultar(rutaIntereses({ intereses: "Gastronomía,Compras,Arte", limite: "3" }));

    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].url.searchParams.get("limit"), "3");
    assert.equal(resultado.cuerpo.lugares.length, 3);
  });

  test("elimina lugares duplicados que coinciden con varios intereses", async () => {
    simular(() =>
      respuestaJson(
        coleccion([
          feature({ place_id: "dup", name: "Catedral", lat: 14.64, lon: -90.51, categories: ["tourism.sights"] }),
          feature({ place_id: "dup", name: "Catedral", lat: 14.64, lon: -90.51, categories: ["tourism.attraction"] }),
        ]),
      ),
    );

    const resultado = await consultar(rutaIntereses({ intereses: "Historia,Fotografía" }));

    assert.deepEqual(resultado.cuerpo.lugares.map((lugar) => lugar.idExterno), ["dup"]);
  });

  test("conserva categorías adicionales del proveedor como building", async () => {
    simular(() =>
      respuestaJson(
        coleccion([
          feature({
            place_id: "h1",
            name: "Palacio Nacional de la Cultura",
            lat: 14.6431,
            lon: -90.5133,
            categories: ["building", "building.historic", "tourism.sights", "heritage"],
          }),
        ]),
      ),
    );

    const resultado = await consultar(rutaIntereses({ intereses: "Historia" }));

    assert.deepEqual(resultado.cuerpo.lugares[0].categorias, ["building", "building.historic", "tourism.sights", "heritage"]);
  });

  test("descarta registros sin categorías válidas", async () => {
    simular(() =>
      respuestaJson(
        coleccion([
          feature({ place_id: "c1", name: "Sin categorías", lat: 14.6, lon: -90.5 }),
          feature({ place_id: "c2", name: "Arreglo vacío", lat: 14.6, lon: -90.5, categories: [] }),
          feature({ place_id: "c3", name: "No es arreglo", lat: 14.6, lon: -90.5, categories: "beach" }),
          feature({ place_id: "c4", name: "Valores inválidos", lat: 14.6, lon: -90.5, categories: ["", 5, null, "Beach Club"] }),
          feature({ place_id: "c5", name: "Playa El Paredón", lat: 13.92, lon: -91.07, categories: ["beach", 7] }),
        ]),
      ),
    );

    const resultado = await consultar(rutaIntereses({ intereses: "Playa" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo.lugares.map((lugar) => [lugar.idExterno, lugar.categorias]), [["c5", ["beach"]]]);
  });

  test("devuelve lugares vacío cuando ningún interés tiene coincidencias", async () => {
    const resultado = await consultar(rutaIntereses({ intereses: "Playa,Aventura", radio: "500" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo, { lugares: [] });
  });

  test("devuelve lugares vacío cuando todos los registros se descartan", async () => {
    simular(() =>
      respuestaJson(
        coleccion([
          feature({ place_id: "x1", lat: 14.6, lon: -90.5, categories: ["beach"] }),
          feature({ name: "Sin id", lat: 14.6, lon: -90.5, categories: ["beach"] }),
          feature({ place_id: "x3", name: "Sin coordenadas", categories: ["beach"] }),
          feature({ place_id: "x4", name: "Sin categorías", lat: 14.6, lon: -90.5 }),
        ]),
      ),
    );

    const resultado = await consultar(rutaIntereses({ intereses: "Playa" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo, { lugares: [] });
  });

  test("rechaza el parámetro intereses repetido sin consultar al proveedor", async () => {
    const resultado = await consultar("/api/lugares?lat=14.6&lng=-90.5&intereses=Cultura&intereses=Arte");

    verificarError(resultado, 400, "PARAMETRO_INVALIDO");
    assert.equal(llamadas.length, 0);
  });

  test("informa los intereses desconocidos y los valores permitidos", async () => {
    const resultado = await consultar(rutaIntereses({ intereses: "Cultura,Deportes,Museos" }));

    verificarError(resultado, 400, "PARAMETRO_INVALIDO");
    const [detalle] = resultado.cuerpo.error.detalles;
    assert.equal(detalle.parametro, "intereses");
    assert.match(detalle.mensaje, /Deportes, Museos/);
    assert.match(detalle.mensaje, /Vida nocturna/);
    assert.equal(llamadas.length, 0);
  });

  test("mantiene los errores del proveedor al consultar por intereses", async () => {
    simular(() => respuestaJson({ message: `Too Many Requests ${CLAVE}` }, 429));
    verificarError(await consultar(rutaIntereses({ intereses: "Cultura" })), 503, "PROVEEDOR_LIMITE_SOLICITUDES");

    simular(() => respuestaJson({ message: "Invalid apiKey" }, 401));
    verificarError(await consultar(rutaIntereses({ intereses: "Cultura" })), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS");

    simular(() => respuestaJson({ type: "FeatureCollection" }));
    verificarError(await consultar(rutaIntereses({ intereses: "Cultura" })), 502, "PROVEEDOR_RESPUESTA_INVALIDA");
  });
});

describe("GET /api/lugares - errores del proveedor", () => {
  const RUTA = "/api/lugares?lat=14.6&lng=-90.5&categoria=entertainment.museum";

  test("credenciales rechazadas (401) producen un error de configuración controlado", async () => {
    simular(() => respuestaJson({ statusCode: 401, error: "Unauthorized", message: `Invalid apiKey ${CLAVE}` }, 401));

    const resultado = await consultar(RUTA);

    verificarError(resultado, 502, "PROVEEDOR_CREDENCIALES_INVALIDAS");
    assert.ok(!resultado.texto.includes("Unauthorized"));
  });

  test("credenciales rechazadas (403) producen un error de configuración controlado", async () => {
    simular(() => respuestaJson({ message: "Forbidden" }, 403));

    verificarError(await consultar(RUTA), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS");
  });

  test("límite de solicitudes (429) produce 503 con código específico", async () => {
    simular(() => respuestaJson({ message: "Too Many Requests" }, 429));

    verificarError(await consultar(RUTA), 503, "PROVEEDOR_LIMITE_SOLICITUDES");
  });

  test("errores del servidor del proveedor producen 502 sin exponer su cuerpo", async () => {
    simular(() => new Response("Internal stack trace at geoapify.internal", { status: 500 }));

    const resultado = await consultar(RUTA);

    verificarError(resultado, 502, "PROVEEDOR_ERROR");
    assert.ok(!resultado.texto.includes("stack trace"));
  });

  test("fallo de red produce 502", async () => {
    simular(() => {
      throw new TypeError(`fetch failed https://api.geoapify.com/v2/places?apiKey=${CLAVE}`);
    });

    verificarError(await consultar(RUTA), 502, "PROVEEDOR_NO_DISPONIBLE");
  });

  test("tiempo de espera agotado cancela la petición y produce 504", async () => {
    let senal;
    simular(
      (url, opciones) =>
        new Promise((resolve, reject) => {
          senal = opciones.signal;
          opciones.signal.addEventListener("abort", () => reject(opciones.signal.reason));
        }),
    );

    const resultado = await consultar(RUTA);

    verificarError(resultado, 504, "PROVEEDOR_TIEMPO_AGOTADO");
    assert.equal(senal.aborted, true);
  });

  test("JSON inválido produce 502", async () => {
    simular(() => new Response("<html>no es json</html>", { status: 200 }));

    verificarError(await consultar(RUTA), 502, "PROVEEDOR_RESPUESTA_INVALIDA");
  });

  test("estructura inesperada produce 502 y no se confunde con una colección vacía", async () => {
    for (const cuerpo of [{ type: "FeatureCollection" }, { features: "no-es-arreglo" }, [], null, "texto"]) {
      simular(() => respuestaJson(cuerpo));
      verificarError(await consultar(RUTA), 502, "PROVEEDOR_RESPUESTA_INVALIDA");
    }
  });
});

describe("configuración y rutas", () => {
  test("sin clave configurada responde un error controlado sin consultar al proveedor", async () => {
    const app = crearApp({ apiKey: "  ", fetch: async () => assert.fail("no debe consultar al proveedor") });
    const servidorSinClave = app.listen(0, "127.0.0.1");
    await once(servidorSinClave, "listening");
    try {
      const { port } = servidorSinClave.address();
      const respuesta = await fetch(`http://127.0.0.1:${port}/api/lugares?lat=1&lng=1&categoria=catering.cafe`);
      const cuerpo = await respuesta.json();
      assert.equal(respuesta.status, 500);
      assert.equal(cuerpo.error.codigo, "SERVICIO_NO_CONFIGURADO");
    } finally {
      servidorSinClave.closeAllConnections();
      servidorSinClave.close();
    }
  });

  test("rutas inexistentes devuelven 404 con el formato de error", async () => {
    const resultado = await consultar("/api/no-existe");

    verificarError(resultado, 404, "RUTA_NO_ENCONTRADA");
  });
});
