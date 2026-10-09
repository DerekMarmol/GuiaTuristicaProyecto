const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { crearApp } = require("../src/app");
const { interpretarHorario } = require("../src/geoapify/horario");
const { extraerRegistroDetalles } = require("../src/geoapify/detalles");
const { crearEnriquecedorHorarios, CONCURRENCIA_DETALLES } = require("../src/geoapify/enriquecer");

const CLAVE = "clave-de-prueba-no-real-456";

function horario(estado, valorOriginal = null) {
  return { estado, valorOriginal, fuente: "geoapify" };
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

function lugarBusqueda(id, extra = {}) {
  return {
    type: "Feature",
    properties: {
      place_id: id,
      name: `Lugar ${id}`,
      formatted: `Dirección ${id}`,
      lat: 14.6,
      lon: -90.5,
      categories: ["tourism.sights"],
      ...extra,
    },
    geometry: { type: "Point", coordinates: [-90.5, 14.6] },
  };
}

function detalles(id, propiedades = {}, geometry = { type: "Point", coordinates: [-90.5, 14.6] }) {
  return { type: "Feature", properties: { feature_type: "details", place_id: id, ...propiedades }, geometry };
}

function esperarAborto(senal) {
  return new Promise((resolve, reject) => {
    senal.addEventListener("abort", () => reject(senal.reason));
  });
}

describe("interpretarHorario", () => {
  const disponibles = [
    ["horarios distintos según el día", "Mo-Fr 09:00-17:00; Sa 10:00-14:00"],
    ["varios intervalos en un mismo día", "Mo-Fr 08:00-12:00,14:00-18:00"],
    ["turnos que cruzan la medianoche", "Fr-Sa 22:00-03:00"],
    ["apertura 24/7", "24/7"],
    ["día explícitamente cerrado", "Mo-Sa 09:00-18:00; Su off"],
    ["reglas por temporada", "Jan-Mar Mo-Fr 09:00-17:00; Apr-Dec Mo-Sa 08:00-20:00"],
    ["comentarios publicados", 'Mo-Fr 09:00-17:00 "solo con cita"'],
    ["horario de cierre abierto", "Mo-Fr 10:00+"],
    ["horas variables según el sol", "Mo-Su sunrise-sunset"],
  ];

  for (const [descripcion, valor] of disponibles) {
    test(`acepta ${descripcion} y conserva el texto original`, () => {
      assert.deepEqual(interpretarHorario(valor), horario("disponible", valor));
    });
  }

  test("un día cerrado no equivale a un horario ausente", () => {
    assert.equal(interpretarHorario("Su off").estado, "disponible");
    assert.equal(interpretarHorario(undefined).estado, "no_publicado");
  });

  for (const [descripcion, valor] of [
    ["ausente", undefined],
    ["null", null],
    ["texto vacío", ""],
    ["texto con solo espacios", "   "],
  ]) {
    test(`marca no_publicado con valor ${descripcion} sin asignar uno por defecto`, () => {
      assert.deepEqual(interpretarHorario(valor), horario("no_publicado"));
    });
  }

  for (const [descripcion, valor] of [
    ["hora fuera del día", "Mo-Fr 25:00-26:00"],
    ["texto libre", "lunes a viernes 9 a 5"],
    ["formato de 12 horas", "Mo-Fr 9am-5pm"],
    ["texto sin horario", "abierto casi siempre"],
  ]) {
    test(`marca no_interpretable un horario inválido (${descripcion}) y conserva el texto`, () => {
      assert.deepEqual(interpretarHorario(valor), horario("no_interpretable", valor));
    });
  }

  for (const [descripcion, valor] of [
    ["número", 9],
    ["booleano", true],
    ["objeto", { lunes: "09:00-17:00" }],
    ["arreglo", ["Mo-Fr 09:00-17:00"]],
  ]) {
    test(`marca no_interpretable un tipo inesperado (${descripcion}) con valorOriginal null`, () => {
      assert.deepEqual(interpretarHorario(valor), horario("no_interpretable"));
    });
  }

  for (const [descripcion, valor] of [
    ["festivos", "Mo-Fr 09:00-17:00; PH off"],
    ["horario exclusivo de festivos", "PH 10:00-14:00"],
    ["vacaciones escolares", "Mo-Fr 08:00-15:00; SH off"],
  ]) {
    test(`marca no_interpretable una regla que requiere ubicación administrativa (${descripcion})`, () => {
      assert.deepEqual(interpretarHorario(valor), horario("no_interpretable", valor));
    });
  }
});

describe("extraerRegistroDetalles", () => {
  test("toma el horario del registro details del lugar e ignora edificios y otros lugares", () => {
    const propiedades = extraerRegistroDetalles(
      coleccion([
        { type: "Feature", properties: { feature_type: "building", place_id: "edificio", opening_hours: "24/7" } },
        { type: "Feature", properties: { feature_type: "radius_100.cafe", place_id: "cafe", opening_hours: "Mo 08:00-09:00" } },
        detalles("lugar-1", { opening_hours: "Tu-Su 09:00-16:00" }),
      ]),
      "lugar-1",
    );

    assert.equal(propiedades.opening_hours, "Tu-Su 09:00-16:00");
  });

  test("acepta geometrías que no son puntos", () => {
    const poligono = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const propiedades = extraerRegistroDetalles(coleccion([detalles("p", { opening_hours: "24/7" }, poligono)]), "p");

    assert.equal(propiedades.opening_hours, "24/7");
  });

  test("acepta el único registro details aunque su place_id tenga otra codificación o no exista", () => {
    for (const registro of [
      detalles("51c2a0-codificacion-distinta", { opening_hours: "24/7" }),
      { type: "Feature", properties: { feature_type: "details", opening_hours: "24/7" } },
    ]) {
      assert.equal(extraerRegistroDetalles(coleccion([registro]), "51f0a6-busqueda").opening_hours, "24/7");
    }
  });

  test("con varios registros details elige solo el que coincide exactamente con el lugar", () => {
    const propiedades = extraerRegistroDetalles(
      coleccion([detalles("otro", { opening_hours: "24/7" }), detalles("p", { opening_hours: "Mo 10:00-12:00" })]),
      "p",
    );

    assert.equal(propiedades.opening_hours, "Mo 10:00-12:00");
  });

  test("rechaza respuestas mal formadas o sin el registro del lugar", () => {
    const casos = [
      null,
      "texto",
      [],
      {},
      { features: "no-es-arreglo" },
      coleccion([]),
      coleccion([null, "x", { properties: null }]),
      coleccion([{ type: "Feature", properties: { feature_type: "building", place_id: "p", opening_hours: "24/7" } }]),
      coleccion([{ type: "Feature", properties: { place_id: "p", opening_hours: "24/7" } }]),
      coleccion([detalles("otro", { opening_hours: "24/7" }), detalles("otro-mas", { opening_hours: "24/7" })]),
      coleccion([detalles("p"), detalles("p")]),
    ];
    for (const datos of casos) {
      assert.throws(() => extraerRegistroDetalles(datos, "p"), { name: "ErrorDetalles" });
    }
  });
});

describe("crearEnriquecedorHorarios", () => {
  const LUGARES = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ idExterno: id, nombre: id }));

  test("no consulta detalles cuando no hay lugares", async () => {
    let consultas = 0;
    const enriquecer = crearEnriquecedorHorarios({
      consultarDetalles: async () => {
        consultas++;
        return {};
      },
    });

    assert.deepEqual(await enriquecer([]), []);
    assert.equal(consultas, 0);
  });

  test("consulta una sola vez cada identificador", async () => {
    const consultados = [];
    const enriquecer = crearEnriquecedorHorarios({
      intervaloMs: 0,
      consultarDetalles: async (id) => {
        consultados.push(id);
        return { opening_hours: "24/7" };
      },
    });

    const resultado = await enriquecer([{ idExterno: "x" }, { idExterno: "y" }, { idExterno: "x" }]);

    assert.deepEqual(consultados.sort(), ["x", "y"]);
    assert.deepEqual(
      resultado.map((lugar) => [lugar.idExterno, lugar.horario.estado]),
      [
        ["x", "disponible"],
        ["y", "disponible"],
        ["x", "disponible"],
      ],
    );
  });

  test("limita la concurrencia de consultas", async () => {
    let activas = 0;
    let maximo = 0;
    const enriquecer = crearEnriquecedorHorarios({
      concurrencia: 3,
      intervaloMs: 0,
      consultarDetalles: async () => {
        activas++;
        maximo = Math.max(maximo, activas);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activas--;
        return { opening_hours: "24/7" };
      },
    });

    const resultado = await enriquecer(LUGARES);

    assert.equal(maximo, 3);
    assert.equal(resultado.length, LUGARES.length);
    assert.ok(resultado.every((lugar) => lugar.horario.estado === "disponible"));
  });

  test("la concurrencia por defecto es pequeña", () => {
    assert.ok(CONCURRENCIA_DETALLES >= 1 && CONCURRENCIA_DETALLES <= 5);
  });

  test("espacia el inicio de las consultas", async () => {
    const inicios = [];
    const enriquecer = crearEnriquecedorHorarios({
      concurrencia: 4,
      intervaloMs: 40,
      consultarDetalles: async () => {
        inicios.push(Date.now());
        return {};
      },
    });

    await enriquecer(LUGARES.slice(0, 4));

    for (let indice = 1; indice < inicios.length; indice++) {
      assert.ok(inicios[indice] - inicios[indice - 1] >= 30, `separación ${inicios[indice] - inicios[indice - 1]} ms`);
    }
  });

  test("al agotar el presupuesto cancela las consultas pendientes y marca error_consulta", async () => {
    const senales = [];
    const enriquecer = crearEnriquecedorHorarios({
      concurrencia: 2,
      intervaloMs: 0,
      presupuestoMs: 80,
      consultarDetalles: (id, senal) => {
        senales.push(senal);
        if (id === "a") {
          return Promise.resolve({ opening_hours: "Mo-Fr 09:00-17:00" });
        }
        return esperarAborto(senal);
      },
    });

    const inicio = Date.now();
    const resultado = await enriquecer(LUGARES);
    const duracion = Date.now() - inicio;

    assert.ok(duracion < 1000, `duró ${duracion} ms`);
    assert.ok(senales.length <= 3, `se iniciaron ${senales.length} consultas`);
    assert.ok(senales.every((senal) => senal.aborted));
    assert.deepEqual(resultado[0].horario, horario("disponible", "Mo-Fr 09:00-17:00"));
    assert.ok(resultado.slice(1).every((lugar) => lugar.horario.estado === "error_consulta" && lugar.horario.valorOriginal === null));
    assert.deepEqual(
      resultado.map((lugar) => lugar.idExterno),
      LUGARES.map((lugar) => lugar.idExterno),
    );
  });

  test("respeta el presupuesto aunque una consulta ignore la cancelación", async () => {
    const enriquecer = crearEnriquecedorHorarios({
      intervaloMs: 0,
      presupuestoMs: 50,
      consultarDetalles: () => new Promise(() => {}),
    });

    const inicio = Date.now();
    const resultado = await enriquecer(LUGARES.slice(0, 2));

    assert.ok(Date.now() - inicio < 1000);
    assert.ok(resultado.every((lugar) => lugar.horario.estado === "error_consulta"));
  });
});

describe("GET /api/lugares - horarios de Geoapify", () => {
  let simularBusqueda;
  let simularDetalles;
  let busquedas;
  let consultasDetalles;
  let servidor;
  let baseUrl;

  async function consultar(ruta) {
    const respuesta = await fetch(`${baseUrl}${ruta}`);
    const texto = await respuesta.text();
    return { estado: respuesta.status, texto, cuerpo: JSON.parse(texto) };
  }

  before(async () => {
    const app = crearApp({
      apiKey: CLAVE,
      tiempoEsperaMs: 50,
      detalles: { tiempoEsperaMs: 50, intervaloMs: 0, presupuestoMs: 2000 },
      fetch: async (url, opciones) => {
        const direccion = new URL(url);
        if (direccion.pathname === "/v2/place-details") {
          consultasDetalles.push({ url: direccion, opciones });
          return simularDetalles(direccion.searchParams.get("id"), opciones);
        }
        busquedas.push(direccion);
        return simularBusqueda(direccion, opciones);
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
    busquedas = [];
    consultasDetalles = [];
    simularBusqueda = () => respuestaJson(coleccion([]));
    simularDetalles = (id) => respuestaJson(coleccion([detalles(id)]));
  });

  const RUTA = "/api/lugares?lat=14.6&lng=-90.5&categoria=tourism.sights";

  test("consulta place-details con el idExterno y features=details", async () => {
    simularBusqueda = () => respuestaJson(coleccion([lugarBusqueda("id/con+caracteres=especiales")]));

    await consultar(RUTA);

    assert.equal(consultasDetalles.length, 1);
    const { url, opciones } = consultasDetalles[0];
    assert.equal(url.origin + url.pathname, "https://api.geoapify.com/v2/place-details");
    assert.equal(url.searchParams.get("id"), "id/con+caracteres=especiales");
    assert.equal(url.searchParams.get("features"), "details");
    assert.equal(url.searchParams.get("apiKey"), CLAVE);
    assert.deepEqual([...url.searchParams.keys()].sort(), ["apiKey", "features", "id"]);
    assert.ok(opciones.signal instanceof AbortSignal);
  });

  test("conserva el horario publicado y los datos originales de la búsqueda", async () => {
    simularBusqueda = () =>
      respuestaJson(
        coleccion([
          lugarBusqueda("museo", {
            name: "Museo Nacional",
            formatted: "Zona 13, Guatemala",
            lat: 14.5907,
            lon: -90.5242,
            categories: ["entertainment", "entertainment.museum"],
          }),
        ]),
      );
    simularDetalles = (id) =>
      respuestaJson(
        coleccion([
          detalles(
            id,
            {
              name: "Otro nombre en detalles",
              formatted: "Otra dirección",
              lat: 1,
              lon: 1,
              categories: ["building"],
              opening_hours: "Tu-Fr 09:00-16:00; Sa,Su 09:00-12:00,13:30-16:00; Mo off",
            },
            { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          ),
          { type: "Feature", properties: { feature_type: "building", place_id: "edificio", opening_hours: "24/7" } },
        ]),
      );

    const resultado = await consultar(RUTA);

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo.lugares, [
      {
        idExterno: "museo",
        proveedor: "geoapify",
        nombre: "Museo Nacional",
        direccion: "Zona 13, Guatemala",
        lat: 14.5907,
        lng: -90.5242,
        categorias: ["entertainment", "entertainment.museum"],
        horario: horario("disponible", "Tu-Fr 09:00-16:00; Sa,Su 09:00-12:00,13:30-16:00; Mo off"),
      },
    ]);
  });

  test("combina horarios disponibles, ausentes, no interpretables y consultas fallidas sin alterar orden ni límite", async () => {
    const ids = ["ok", "sin", "nulo", "vacio", "invalido", "tipo", "festivos", "http500", "http429", "red", "timeout", "malformado", "ajeno", "extra"];
    simularBusqueda = () => respuestaJson(coleccion(ids.map((id) => lugarBusqueda(id))));
    const respuestas = {
      ok: () => respuestaJson(coleccion([detalles("ok", { opening_hours: "24/7" })])),
      sin: () => respuestaJson(coleccion([detalles("sin")])),
      nulo: () => respuestaJson(coleccion([detalles("nulo", { opening_hours: null })])),
      vacio: () => respuestaJson(coleccion([detalles("vacio", { opening_hours: "" })])),
      invalido: () => respuestaJson(coleccion([detalles("invalido", { opening_hours: "Mo-Fr 25:00-26:00" })])),
      tipo: () => respuestaJson(coleccion([detalles("tipo", { opening_hours: { Mo: "09:00-17:00" } })])),
      festivos: () => respuestaJson(coleccion([detalles("festivos", { opening_hours: "Mo-Fr 09:00-17:00; PH off" })])),
      http500: () => new Response("stack trace interno", { status: 500 }),
      http429: () => respuestaJson({ message: "Too Many Requests" }, 429),
      red: () => {
        throw new TypeError(`fetch failed https://api.geoapify.com/v2/place-details?apiKey=${CLAVE}`);
      },
      timeout: (opciones) => esperarAborto(opciones.signal),
      malformado: () => new Response("<html>no es json</html>", { status: 200 }),
      ajeno: () =>
        respuestaJson(
          coleccion([
            { type: "Feature", properties: { feature_type: "building", place_id: "edificio", opening_hours: "24/7" } },
            detalles("otro-lugar", { opening_hours: "24/7" }),
            detalles("otro-lugar-2", { opening_hours: "Mo 09:00-10:00" }),
          ]),
        ),
    };
    simularDetalles = (id, opciones) => respuestas[id](opciones);

    const resultado = await consultar(`${RUTA}&limite=13`);

    assert.equal(resultado.estado, 200);
    assert.equal(busquedas[0].searchParams.get("limit"), "13");
    assert.deepEqual(
      resultado.cuerpo.lugares.map((lugar) => [lugar.idExterno, lugar.nombre, lugar.horario]),
      [
        ["ok", "Lugar ok", horario("disponible", "24/7")],
        ["sin", "Lugar sin", horario("no_publicado")],
        ["nulo", "Lugar nulo", horario("no_publicado")],
        ["vacio", "Lugar vacio", horario("no_publicado")],
        ["invalido", "Lugar invalido", horario("no_interpretable", "Mo-Fr 25:00-26:00")],
        ["tipo", "Lugar tipo", horario("no_interpretable")],
        ["festivos", "Lugar festivos", horario("no_interpretable", "Mo-Fr 09:00-17:00; PH off")],
        ["http500", "Lugar http500", horario("error_consulta")],
        ["http429", "Lugar http429", horario("error_consulta")],
        ["red", "Lugar red", horario("error_consulta")],
        ["timeout", "Lugar timeout", horario("error_consulta")],
        ["malformado", "Lugar malformado", horario("error_consulta")],
        ["ajeno", "Lugar ajeno", horario("error_consulta")],
      ],
    );
    assert.equal(consultasDetalles.length, 13);
    assert.ok(!consultasDetalles.some(({ url }) => url.searchParams.get("id") === "extra"));
    assert.ok(consultasDetalles.find(({ url }) => url.searchParams.get("id") === "timeout").opciones.signal.aborted);
    assert.ok(!resultado.texto.includes(CLAVE));
    assert.ok(!resultado.texto.includes("apiKey"));
    assert.ok(!resultado.texto.includes("stack trace"));
  });

  test("no repite consultas para lugares duplicados en la búsqueda", async () => {
    simularBusqueda = () => respuestaJson(coleccion([lugarBusqueda("dup"), lugarBusqueda("dup"), lugarBusqueda("otro")]));

    const resultado = await consultar(RUTA);

    assert.deepEqual(resultado.cuerpo.lugares.map((lugar) => lugar.idExterno), ["dup", "otro"]);
    assert.deepEqual(consultasDetalles.map(({ url }) => url.searchParams.get("id")).sort(), ["dup", "otro"]);
  });

  test("devuelve 200 con lugares vacío sin consultar detalles", async () => {
    const resultado = await consultar(RUTA);

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo, { lugares: [] });
    assert.equal(busquedas.length, 1);
    assert.equal(consultasDetalles.length, 0);
  });

  test("conserva los errores de la búsqueda principal sin consultar detalles", async () => {
    for (const [estadoProveedor, estado, codigo] of [
      [429, 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
      [401, 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
      [500, 502, "PROVEEDOR_ERROR"],
    ]) {
      simularBusqueda = () => respuestaJson({ message: `error ${CLAVE}` }, estadoProveedor);

      const resultado = await consultar(RUTA);

      assert.equal(resultado.estado, estado);
      assert.equal(resultado.cuerpo.error.codigo, codigo);
      assert.ok(!resultado.texto.includes(CLAVE));
    }
    assert.equal(consultasDetalles.length, 0);
  });

  test("el presupuesto total limita la duración del enriquecimiento", async () => {
    const app = crearApp({
      apiKey: CLAVE,
      detalles: { tiempoEsperaMs: 5000, intervaloMs: 0, presupuestoMs: 100, concurrencia: 2 },
      fetch: async (url, opciones) => {
        const direccion = new URL(url);
        if (direccion.pathname === "/v2/place-details") {
          consultasDetalles.push({ url: direccion, opciones });
          return esperarAborto(opciones.signal);
        }
        return respuestaJson(coleccion(["p1", "p2", "p3", "p4", "p5"].map((id) => lugarBusqueda(id))));
      },
    });
    const servidorPresupuesto = app.listen(0, "127.0.0.1");
    await once(servidorPresupuesto, "listening");
    try {
      const inicio = Date.now();
      const respuesta = await fetch(`http://127.0.0.1:${servidorPresupuesto.address().port}${RUTA}`);
      const cuerpo = await respuesta.json();

      assert.equal(respuesta.status, 200);
      assert.ok(Date.now() - inicio < 2000);
      assert.deepEqual(
        cuerpo.lugares.map((lugar) => [lugar.idExterno, lugar.horario.estado]),
        ["p1", "p2", "p3", "p4", "p5"].map((id) => [id, "error_consulta"]),
      );
      assert.equal(consultasDetalles.length, 2);
      assert.ok(consultasDetalles.every(({ opciones }) => opciones.signal.aborted));
    } finally {
      servidorPresupuesto.closeAllConnections();
      servidorPresupuesto.close();
    }
  });
});
