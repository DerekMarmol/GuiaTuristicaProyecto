const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { crearApp } = require("../src/app");
const { listarFechas } = require("../src/clima/fechas");

const CLAVE_CLIMA = "clave-clima-de-prueba-no-real-456";
const CLAVE_GEO = "clave-geo-de-prueba-no-real-123";
const AHORA = new Date("2026-10-11T12:00:00.000Z");
const HORA_MS = 3600 * 1000;

let simulador;
let llamadas;
let llamadasGeo;
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

function registro(iso, temp, lluvia) {
  const resultado = {
    dt: Date.parse(iso) / 1000,
    main: { temp, feels_like: temp, humidity: 70 },
    weather: [{ id: 500, main: "Rain", description: "lluvia ligera" }],
    pop: 0.2,
    dt_txt: iso.slice(0, 19).replace("T", " "),
  };
  if (lluvia !== undefined) {
    resultado.rain = { "3h": lluvia };
  }
  return resultado;
}

function serie(inicioIso, cantidad, temperatura = () => 20, lluvia = () => undefined) {
  const inicio = Date.parse(inicioIso);
  return Array.from({ length: cantidad }, (_, indice) =>
    registro(new Date(inicio + indice * 3 * HORA_MS).toISOString(), temperatura(indice), lluvia(indice)),
  );
}

function pronostico(list, timezone = 0) {
  return {
    cod: "200",
    message: 0,
    cnt: list.length,
    list,
    city: { id: 1, name: "Prueba", coord: { lat: 14.6349, lon: -90.5069 }, country: "GT", timezone, sunrise: 0, sunset: 0 },
  };
}

function sinResumen(fecha, estado) {
  return {
    fecha,
    estado,
    temperaturaPromedioC: null,
    temperaturaMinimaC: null,
    temperaturaMaximaC: null,
    lluviaMm: null,
    intervalosDisponibles: 0,
  };
}

function rutaClima(parametros) {
  return `/api/clima/pronostico?${new URLSearchParams({ lat: "14.6349", lng: "-90.5069", ...parametros })}`;
}

async function consultar(ruta, base = baseUrl) {
  const respuesta = await fetch(`${base}${ruta}`);
  const texto = await respuesta.text();
  return { estado: respuesta.status, texto, cuerpo: JSON.parse(texto) };
}

function verificarSinSecretos(texto) {
  assert.ok(!texto.includes(CLAVE_CLIMA));
  assert.ok(!texto.includes(CLAVE_GEO));
  assert.ok(!texto.includes("appid"));
}

function verificarError(resultado, estado, codigo) {
  assert.equal(resultado.estado, estado);
  assert.equal(resultado.cuerpo.error.codigo, codigo);
  assert.equal(typeof resultado.cuerpo.error.mensaje, "string");
  verificarSinSecretos(resultado.texto);
}

function resumenes(cuerpo) {
  return cuerpo.dias.map((dia) => [dia.fecha, dia.estado, dia.temperaturaPromedioC, dia.lluviaMm, dia.intervalosDisponibles]);
}

async function iniciar(app) {
  const instancia = app.listen(0, "127.0.0.1");
  await once(instancia, "listening");
  return { instancia, base: `http://127.0.0.1:${instancia.address().port}` };
}

function detener(instancia) {
  instancia.closeAllConnections();
  instancia.close();
}

before(async () => {
  const app = crearApp({
    apiKey: CLAVE_GEO,
    fetch: async (url) => {
      llamadasGeo.push(new URL(url));
      return respuestaJson({ type: "FeatureCollection", features: [] });
    },
    clima: {
      apiKey: CLAVE_CLIMA,
      tiempoEsperaMs: 50,
      ahora: () => AHORA,
      fetch: async (url, opciones) => {
        llamadas.push({ url: new URL(url), opciones });
        return simulador(url, opciones);
      },
    },
  });
  ({ instancia: servidor, base: baseUrl } = await iniciar(app));
});

after(() => {
  detener(servidor);
});

beforeEach(() => {
  llamadas = [];
  llamadasGeo = [];
  simular(() => respuestaJson(pronostico(serie("2026-10-12T00:00:00Z", 16))));
});

describe("GET /api/clima/pronostico - consulta al proveedor", () => {
  test("consulta el pronóstico de 5 días con coordenadas, unidades e idioma correctos", async () => {
    await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-13" }));

    assert.equal(llamadas.length, 1);
    const { url, opciones } = llamadas[0];
    assert.equal(url.origin + url.pathname, "https://api.openweathermap.org/data/2.5/forecast");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["appid", "lang", "lat", "lon", "units"]);
    assert.equal(url.searchParams.get("lat"), "14.6349");
    assert.equal(url.searchParams.get("lon"), "-90.5069");
    assert.equal(url.searchParams.get("units"), "metric");
    assert.equal(url.searchParams.get("lang"), "es");
    assert.equal(url.searchParams.get("appid"), CLAVE_CLIMA);
    assert.ok(opciones.signal instanceof AbortSignal);
    assert.equal(llamadasGeo.length, 0);
  });

  test("hace una sola llamada al proveedor para un rango de 14 días", async () => {
    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-11", fechaFin: "2026-10-24" }));

    assert.equal(resultado.estado, 200);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].url.searchParams.has("cnt"), false);
  });

  test("acepta coordenadas iguales a cero y los valores límite", async () => {
    const enCero = await consultar("/api/clima/pronostico?lat=0&lng=0&fechaInicio=2026-10-12&fechaFin=2026-10-12");
    assert.equal(enCero.estado, 200);
    assert.equal(llamadas[0].url.searchParams.get("lat"), "0");
    assert.equal(llamadas[0].url.searchParams.get("lon"), "0");
    assert.deepEqual(enCero.cuerpo.ubicacion, { lat: 0, lng: 0 });

    const enLimite = await consultar("/api/clima/pronostico?lat=-90&lng=180&fechaInicio=2026-10-12&fechaFin=2026-10-12");
    assert.equal(enLimite.estado, 200);
    assert.equal(llamadas[1].url.searchParams.get("lat"), "-90");
    assert.equal(llamadas[1].url.searchParams.get("lon"), "180");
  });

  test("libera el temporizador cuando la consulta termina", async () => {
    await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-12" }));
    const senal = llamadas[0].opciones.signal;

    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(senal.aborted, false);
  });
});

describe("GET /api/clima/pronostico - resumen diario", () => {
  test("un viaje de un día con cobertura completa devuelve el contrato completo", async () => {
    const lluvias = [undefined, 0.5, undefined, undefined, 1.25, undefined, undefined, undefined];
    const temperaturas = [10, 12, 14, 16, 18, 16, 14, 12];
    simular(() => respuestaJson(pronostico(serie("2026-10-12T00:00:00Z", 8, (i) => temperaturas[i], (i) => lluvias[i]))));

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-12" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo, {
      fuente: "openweathermap",
      ubicacion: { lat: 14.6349, lng: -90.5069 },
      rango: { fechaInicio: "2026-10-12", fechaFin: "2026-10-12", totalDias: 1 },
      consultadoEn: "2026-10-11T12:00:00.000Z",
      desplazamientoUtcSegundos: 0,
      cobertura: {
        desde: "2026-10-12",
        hasta: "2026-10-12",
        primerIntervalo: "2026-10-12T00:00:00.000Z",
        ultimoIntervalo: "2026-10-12T21:00:00.000Z",
      },
      dias: [
        {
          fecha: "2026-10-12",
          estado: "disponible",
          temperaturaPromedioC: 14,
          temperaturaMinimaC: 10,
          temperaturaMaximaC: 18,
          lluviaMm: 1.75,
          intervalosDisponibles: 8,
        },
      ],
      advertencias: [],
    });
    verificarSinSecretos(resultado.texto);
  });

  test("un rango con cobertura completa resume cada día sin advertencias", async () => {
    simular(() => respuestaJson(pronostico(serie("2026-10-12T00:00:00Z", 24, (i) => i))));

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-14" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(
      resultado.cuerpo.dias.map((dia) => [dia.fecha, dia.estado, dia.temperaturaPromedioC, dia.temperaturaMinimaC, dia.temperaturaMaximaC]),
      [
        ["2026-10-12", "disponible", 3.5, 0, 7],
        ["2026-10-13", "disponible", 11.5, 8, 15],
        ["2026-10-14", "disponible", 19.5, 16, 23],
      ],
    );
    assert.deepEqual(resultado.cuerpo.advertencias, []);
  });

  test("un rango parcialmente fuera de cobertura conserva todas las fechas y responde 200", async () => {
    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-15" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo.dias.slice(2), [sinResumen("2026-10-14", "fuera_de_cobertura"), sinResumen("2026-10-15", "fuera_de_cobertura")]);
    assert.deepEqual(resumenes(resultado.cuerpo).slice(0, 2), [
      ["2026-10-12", "disponible", 20, 0, 8],
      ["2026-10-13", "disponible", 20, 0, 8],
    ]);
    assert.deepEqual(
      resultado.cuerpo.advertencias.map(({ codigo, fechas }) => ({ codigo, fechas })),
      [{ codigo: "FUERA_DE_COBERTURA", fechas: ["2026-10-14", "2026-10-15"] }],
    );
  });

  test("un rango completamente posterior a la cobertura devuelve todas las fechas fuera de cobertura", async () => {
    const resultado = await consultar(rutaClima({ fechaInicio: "2026-11-20", fechaFin: "2026-11-22" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo.dias, [
      sinResumen("2026-11-20", "fuera_de_cobertura"),
      sinResumen("2026-11-21", "fuera_de_cobertura"),
      sinResumen("2026-11-22", "fuera_de_cobertura"),
    ]);
    assert.deepEqual(resultado.cuerpo.cobertura.desde, "2026-10-12");
    assert.deepEqual(resultado.cuerpo.advertencias.map((advertencia) => advertencia.codigo), ["FUERA_DE_COBERTURA"]);
  });

  test("las fechas pasadas se representan fuera de cobertura sin consultas históricas", async () => {
    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-01", fechaFin: "2026-10-02" }));

    assert.equal(resultado.estado, 200);
    assert.equal(llamadas.length, 1);
    assert.deepEqual(resultado.cuerpo.dias, [sinResumen("2026-10-01", "fuera_de_cobertura"), sinResumen("2026-10-02", "fuera_de_cobertura")]);
  });

  test("un viaje de 14 días devuelve 14 elementos con el primer y último día parciales", async () => {
    const lluvias = { 3: 2.4, 38: 0.6 };
    simular(() => respuestaJson(pronostico(serie("2026-10-11T15:00:00Z", 40, (i) => i, (i) => lluvias[i]), -21600)));

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-11", fechaFin: "2026-10-24" }));

    assert.equal(resultado.estado, 200);
    assert.equal(resultado.cuerpo.dias.length, 14);
    assert.equal(resultado.cuerpo.rango.totalDias, 14);
    assert.equal(resultado.cuerpo.desplazamientoUtcSegundos, -21600);
    assert.deepEqual(
      resultado.cuerpo.dias.map((dia) => [
        dia.fecha,
        dia.estado,
        dia.temperaturaPromedioC,
        dia.temperaturaMinimaC,
        dia.temperaturaMaximaC,
        dia.lluviaMm,
        dia.intervalosDisponibles,
      ]),
      [
        ["2026-10-11", "parcial", 2, 0, 4, 2.4, 5],
        ["2026-10-12", "disponible", 8.5, 5, 12, 0, 8],
        ["2026-10-13", "disponible", 16.5, 13, 20, 0, 8],
        ["2026-10-14", "disponible", 24.5, 21, 28, 0, 8],
        ["2026-10-15", "disponible", 32.5, 29, 36, 0, 8],
        ["2026-10-16", "parcial", 38, 37, 39, 0.6, 3],
        ["2026-10-17", "fuera_de_cobertura", null, null, null, null, 0],
        ["2026-10-18", "fuera_de_cobertura", null, null, null, null, 0],
        ["2026-10-19", "fuera_de_cobertura", null, null, null, null, 0],
        ["2026-10-20", "fuera_de_cobertura", null, null, null, null, 0],
        ["2026-10-21", "fuera_de_cobertura", null, null, null, null, 0],
        ["2026-10-22", "fuera_de_cobertura", null, null, null, null, 0],
        ["2026-10-23", "fuera_de_cobertura", null, null, null, null, 0],
        ["2026-10-24", "fuera_de_cobertura", null, null, null, null, 0],
      ],
    );
    assert.deepEqual(resultado.cuerpo.cobertura, {
      desde: "2026-10-11",
      hasta: "2026-10-16",
      primerIntervalo: "2026-10-11T15:00:00.000Z",
      ultimoIntervalo: "2026-10-16T12:00:00.000Z",
    });
    assert.deepEqual(
      resultado.cuerpo.advertencias.map(({ codigo, fechas }) => ({ codigo, fechas })),
      [
        {
          codigo: "FUERA_DE_COBERTURA",
          fechas: ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"],
        },
        { codigo: "COBERTURA_PARCIAL", fechas: ["2026-10-11", "2026-10-16"] },
      ],
    );
  });

  test("una serie válida vacía marca todas las fechas sin datos", async () => {
    simular(() => respuestaJson(pronostico([], -21600)));

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-14" }));

    assert.equal(resultado.estado, 200);
    assert.equal(resultado.cuerpo.cobertura, null);
    assert.equal(resultado.cuerpo.desplazamientoUtcSegundos, -21600);
    assert.deepEqual(resultado.cuerpo.dias, [
      sinResumen("2026-10-12", "sin_datos"),
      sinResumen("2026-10-13", "sin_datos"),
      sinResumen("2026-10-14", "sin_datos"),
    ]);
    assert.deepEqual(
      resultado.cuerpo.advertencias.map(({ codigo, fechas }) => ({ codigo, fechas })),
      [{ codigo: "SERIE_VACIA", fechas: ["2026-10-12", "2026-10-13", "2026-10-14"] }],
    );
  });

  test("los huecos dentro de la cobertura no se rellenan", async () => {
    const dia14 = serie("2026-10-14T00:00:00Z", 8, () => 20).filter((_, indice) => indice !== 4);
    simular(() => respuestaJson(pronostico([...serie("2026-10-12T00:00:00Z", 8, () => 10), ...dia14])));

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-14" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resumenes(resultado.cuerpo), [
      ["2026-10-12", "disponible", 10, 0, 8],
      ["2026-10-13", "sin_datos", null, null, 0],
      ["2026-10-14", "parcial", 20, 0, 7],
    ]);
    assert.deepEqual(
      resultado.cuerpo.advertencias.map(({ codigo, fechas }) => ({ codigo, fechas })),
      [
        { codigo: "COBERTURA_PARCIAL", fechas: ["2026-10-14"] },
        { codigo: "SIN_DATOS", fechas: ["2026-10-13"] },
      ],
    );
  });

  test("calcula temperaturas negativas, cero y promedios con decimales", async () => {
    const dia12 = [-5, -2.5, 0, 0, 2.5, 5, -1, 1];
    const dia13 = [-10, -12, -8, -9, -11, -7, -6, -13];
    const dia14 = [1, 2, 2];
    const dia15 = [-1, -2, -2];
    simular(() =>
      respuestaJson(
        pronostico([
          ...serie("2026-10-12T00:00:00Z", 8, (i) => dia12[i]),
          ...serie("2026-10-13T00:00:00Z", 8, (i) => dia13[i]),
          ...serie("2026-10-14T00:00:00Z", 3, (i) => dia14[i]),
          ...serie("2026-10-15T00:00:00Z", 3, (i) => dia15[i]),
        ]),
      ),
    );

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-15" }));

    assert.deepEqual(
      resultado.cuerpo.dias.map((dia) => [dia.estado, dia.temperaturaPromedioC, dia.temperaturaMinimaC, dia.temperaturaMaximaC]),
      [
        ["disponible", 0, -5, 5],
        ["disponible", -9.5, -13, -6],
        ["parcial", 1.67, 1, 2],
        ["parcial", -1.67, -2, -1],
      ],
    );
  });

  test("suma la lluvia publicada y trata la ausencia de rain como cero", async () => {
    const lluvias12 = [0.13, undefined, 0.27, undefined, 1.6, undefined, undefined, undefined];
    simular(() =>
      respuestaJson(
        pronostico([
          ...serie("2026-10-12T00:00:00Z", 8, () => 20, (i) => lluvias12[i]),
          ...serie("2026-10-13T00:00:00Z", 8, () => 20, (i) => (i === 0 ? 0 : undefined)),
        ]),
      ),
    );

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-13" }));

    assert.deepEqual(
      resultado.cuerpo.dias.map((dia) => [dia.fecha, dia.lluviaMm]),
      [
        ["2026-10-12", 2],
        ["2026-10-13", 0],
      ],
    );
  });

  test("ordena registros desordenados y no suma dos veces un registro duplicado", async () => {
    const registros = serie("2026-10-12T00:00:00Z", 8, (i) => i * 2, (i) => (i === 2 ? 3 : undefined));
    simular(() => respuestaJson(pronostico([...registros].reverse().concat([registros[2]]))));

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-12" }));

    assert.deepEqual(resultado.cuerpo.dias, [
      {
        fecha: "2026-10-12",
        estado: "disponible",
        temperaturaPromedioC: 7,
        temperaturaMinimaC: 0,
        temperaturaMaximaC: 14,
        lluviaMm: 3,
        intervalosDisponibles: 8,
      },
    ]);
    assert.equal(resultado.cuerpo.cobertura.primerIntervalo, "2026-10-12T00:00:00.000Z");
  });

  test("ante dos registros con el mismo timestamp conserva el primero recibido", async () => {
    const registros = serie("2026-10-12T00:00:00Z", 2, () => 10);
    simular(() => respuestaJson(pronostico([...registros, registro("2026-10-12T00:00:00Z", 30, 9)])));

    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-12" }));

    assert.deepEqual(resumenes(resultado.cuerpo), [["2026-10-12", "parcial", 10, 0, 2]]);
  });
});

describe("GET /api/clima/pronostico - agrupación por fecha local", () => {
  const casos = [
    ["desplazamiento negativo (UTC-6)", -21600, "2026-10-13T03:00:00Z", "2026-10-13T06:00:00Z"],
    ["desplazamiento positivo (UTC+9)", 32400, "2026-10-12T12:00:00Z", "2026-10-12T15:00:00Z"],
    ["desplazamiento cero (UTC)", 0, "2026-10-12T21:00:00Z", "2026-10-13T00:00:00Z"],
    ["desplazamiento de media hora positivo (UTC+5:30)", 19800, "2026-10-12T18:00:00Z", "2026-10-12T21:00:00Z"],
    ["desplazamiento de media hora negativo (UTC-3:30)", -12600, "2026-10-13T03:00:00Z", "2026-10-13T06:00:00Z"],
  ];

  for (const [descripcion, desplazamiento, antesDeMedianoche, despuesDeMedianoche] of casos) {
    test(`asigna los registros alrededor de la medianoche local con ${descripcion}`, async () => {
      simular(() => respuestaJson(pronostico([registro(antesDeMedianoche, 5), registro(despuesDeMedianoche, 25)], desplazamiento)));

      const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-13" }));

      assert.equal(resultado.estado, 200);
      assert.equal(resultado.cuerpo.desplazamientoUtcSegundos, desplazamiento);
      assert.deepEqual(resumenes(resultado.cuerpo), [
        ["2026-10-12", "parcial", 5, 0, 1],
        ["2026-10-13", "parcial", 25, 0, 1],
      ]);
    });
  }

  test("el resultado no depende de la zona horaria del servidor", async () => {
    simular(() => respuestaJson(pronostico(serie("2026-10-11T15:00:00Z", 40, (i) => i), -21600)));
    const ruta = rutaClima({ fechaInicio: "2026-10-11", fechaFin: "2026-10-24" });
    const zonaOriginal = process.env.TZ;

    try {
      process.env.TZ = "UTC";
      const referencia = (await consultar(ruta)).cuerpo;
      const desplazamientos = new Set();

      for (const zona of ["America/Guatemala", "Asia/Kolkata", "Pacific/Kiritimati", "America/St_Johns", "Pacific/Pago_Pago"]) {
        process.env.TZ = zona;
        desplazamientos.add(new Date("2026-10-12T00:00:00Z").getTimezoneOffset());
        assert.deepEqual((await consultar(ruta)).cuerpo, referencia, zona);
      }
      assert.ok(desplazamientos.size > 1);
    } finally {
      if (zonaOriginal === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = zonaOriginal;
      }
    }
  });

  test("genera fechas consecutivas sin duplicados aunque el equipo cambie de horario", () => {
    const zonaOriginal = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      assert.deepEqual(listarFechas("2026-03-07", "2026-03-10"), ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
      assert.deepEqual(listarFechas("2026-10-31", "2026-11-03"), ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
      process.env.TZ = "Europe/Madrid";
      assert.deepEqual(listarFechas("2026-03-28", "2026-03-30"), ["2026-03-28", "2026-03-29", "2026-03-30"]);
    } finally {
      if (zonaOriginal === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = zonaOriginal;
      }
    }
  });
});

describe("GET /api/clima/pronostico - validación de parámetros", () => {
  const BASE = { lat: "14.6349", lng: "-90.5069", fechaInicio: "2026-10-12", fechaFin: "2026-10-14" };

  const casosInvalidos = [
    ["falta lat", { lat: undefined }],
    ["falta lng", { lng: undefined }],
    ["falta fechaInicio", { fechaInicio: undefined }],
    ["falta fechaFin", { fechaFin: undefined }],
    ["lat vacío", { lat: "" }],
    ["lng vacío", { lng: "" }],
    ["fechaInicio vacía", { fechaInicio: "" }],
    ["fechaFin vacía", { fechaFin: "" }],
    ["lat con texto", { lat: "14abc" }],
    ["lat NaN", { lat: "NaN" }],
    ["lat Infinity", { lat: "Infinity" }],
    ["lng -Infinity", { lng: "-Infinity" }],
    ["lat en notación exponencial", { lat: "1e1" }],
    ["lat incompleta con punto final", { lat: "14." }],
    ["lat sin parte entera", { lat: ".5" }],
    ["lat con espacios", { lat: " 14.6" }],
    ["lat mayor a 90", { lat: "90.0001" }],
    ["lat menor a -90", { lat: "-91" }],
    ["lng mayor a 180", { lng: "180.5" }],
    ["lng menor a -180", { lng: "-181" }],
    ["30 de febrero", { fechaInicio: "2026-02-30" }],
    ["31 de abril", { fechaFin: "2026-04-31" }],
    ["mes 13", { fechaInicio: "2026-13-01" }],
    ["mes 00", { fechaInicio: "2026-00-10" }],
    ["día 00", { fechaInicio: "2026-01-00" }],
    ["29 de febrero en año no bisiesto", { fechaInicio: "2025-02-29", fechaFin: "2025-03-01" }],
    ["29 de febrero de 1900", { fechaInicio: "1900-02-29", fechaFin: "1900-03-01" }],
    ["mes sin cero inicial", { fechaInicio: "2026-1-05" }],
    ["fecha con barras", { fechaInicio: "2026/10/12" }],
    ["fecha sin separadores", { fechaInicio: "20261012" }],
    ["fecha con hora", { fechaInicio: "2026-10-12T00:00:00Z" }],
    ["fecha con espacio inicial", { fechaInicio: " 2026-10-12" }],
    ["fecha con espacio final", { fechaFin: "2026-10-14 " }],
    ["fecha en orden día-mes-año", { fechaInicio: "12-10-2026" }],
    ["fecha con texto adicional", { fechaFin: "2026-10-14x" }],
    ["rango invertido", { fechaInicio: "2026-10-14", fechaFin: "2026-10-12" }],
    ["rango de 367 días", { fechaInicio: "2026-01-01", fechaFin: "2027-01-02" }],
  ];

  for (const [descripcion, cambios] of casosInvalidos) {
    test(`rechaza ${descripcion} sin consultar al proveedor`, async () => {
      const parametros = new URLSearchParams();
      for (const [clave, valor] of Object.entries({ ...BASE, ...cambios })) {
        if (valor !== undefined) {
          parametros.set(clave, valor);
        }
      }

      const resultado = await consultar(`/api/clima/pronostico?${parametros}`);

      verificarError(resultado, 400, "PARAMETRO_INVALIDO");
      assert.ok(Array.isArray(resultado.cuerpo.error.detalles));
      assert.equal(llamadas.length, 0);
    });
  }

  for (const parametro of ["lat", "lng", "fechaInicio", "fechaFin"]) {
    test(`rechaza ${parametro} repetido`, async () => {
      const resultado = await consultar(`/api/clima/pronostico?${new URLSearchParams(BASE)}&${parametro}=${BASE[parametro]}`);

      verificarError(resultado, 400, "PARAMETRO_INVALIDO");
      assert.deepEqual(resultado.cuerpo.error.detalles.map((detalle) => detalle.parametro), [parametro]);
      assert.equal(llamadas.length, 0);
    });
  }

  test("rechaza parámetros con estructura de objeto", async () => {
    const resultado = await consultar("/api/clima/pronostico?lat=14.6&lng=-90.5&fechaInicio[a]=2026-10-12&fechaFin=2026-10-14");

    verificarError(resultado, 400, "PARAMETRO_INVALIDO");
    assert.equal(llamadas.length, 0);
  });

  test("informa el rango invertido y el límite técnico en fechaFin", async () => {
    const invertido = await consultar(rutaClima({ fechaInicio: "2026-10-14", fechaFin: "2026-10-12" }));
    assert.deepEqual(invertido.cuerpo.error.detalles.map((detalle) => detalle.parametro), ["fechaFin"]);

    const excesivo = await consultar(rutaClima({ fechaInicio: "2026-01-01", fechaFin: "2027-01-02" }));
    assert.deepEqual(excesivo.cuerpo.error.detalles.map((detalle) => detalle.parametro), ["fechaFin"]);
    assert.match(excesivo.cuerpo.error.detalles[0].mensaje, /366/);
  });

  test("acepta el 29 de febrero de años bisiestos dentro del rango", async () => {
    const bisiesto = await consultar(rutaClima({ fechaInicio: "2028-02-28", fechaFin: "2028-03-01" }));
    assert.equal(bisiesto.estado, 200);
    assert.deepEqual(bisiesto.cuerpo.dias.map((dia) => dia.fecha), ["2028-02-28", "2028-02-29", "2028-03-01"]);

    const anio2000 = await consultar(rutaClima({ fechaInicio: "2000-02-29", fechaFin: "2000-02-29" }));
    assert.equal(anio2000.estado, 200);
    assert.deepEqual(anio2000.cuerpo.dias, [sinResumen("2000-02-29", "fuera_de_cobertura")]);
  });

  test("acepta 366 días inclusivos, un límite distinto del horizonte del pronóstico", async () => {
    const resultado = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2027-10-12" }));

    assert.equal(resultado.estado, 200);
    assert.equal(llamadas.length, 1);
    assert.equal(resultado.cuerpo.dias.length, 366);
    assert.equal(resultado.cuerpo.rango.totalDias, 366);
    assert.equal(resultado.cuerpo.dias[365].fecha, "2027-10-12");
    assert.equal(new Set(resultado.cuerpo.dias.map((dia) => dia.fecha)).size, 366);
    assert.deepEqual(
      resultado.cuerpo.dias.map((dia) => dia.estado).filter((estado) => estado === "disponible"),
      ["disponible", "disponible"],
    );
    assert.equal(resultado.cuerpo.dias.filter((dia) => dia.estado === "fuera_de_cobertura").length, 364);

    const bisiesto = await consultar(rutaClima({ fechaInicio: "2028-01-01", fechaFin: "2028-12-31" }));
    assert.equal(bisiesto.estado, 200);
    assert.equal(bisiesto.cuerpo.dias.length, 366);
  });
});

describe("GET /api/clima/pronostico - errores del proveedor", () => {
  const RUTA = rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-13" });

  test("credenciales rechazadas (401 y 403) producen un error de configuración, no de inicio de sesión", async () => {
    for (const estado of [401, 403]) {
      simular(() => respuestaJson({ cod: estado, message: `Invalid API key ${CLAVE_CLIMA}` }, estado));

      const resultado = await consultar(RUTA);

      verificarError(resultado, 502, "PROVEEDOR_CREDENCIALES_INVALIDAS");
      assert.match(resultado.cuerpo.error.mensaje, /clima/);
      assert.doesNotMatch(resultado.cuerpo.error.mensaje, /sesi[oó]n|contraseña|login/i);
      assert.ok(!resultado.texto.includes("Invalid API key"));
    }
  });

  test("límite de solicitudes (429) produce 503", async () => {
    simular(() => respuestaJson({ cod: 429, message: "Your account is temporary blocked" }, 429));

    verificarError(await consultar(RUTA), 503, "PROVEEDOR_LIMITE_SOLICITUDES");
  });

  test("otros errores HTTP del proveedor producen 502 sin exponer su cuerpo", async () => {
    for (const estado of [400, 404, 500, 503]) {
      simular(() => new Response(`Internal trace appid=${CLAVE_CLIMA}`, { status: estado }));

      const resultado = await consultar(RUTA);

      verificarError(resultado, 502, "PROVEEDOR_ERROR");
      assert.ok(!resultado.texto.includes("Internal trace"));
    }
  });

  test("fallo de red produce 502", async () => {
    simular(() => {
      throw new TypeError(`fetch failed https://api.openweathermap.org/data/2.5/forecast?appid=${CLAVE_CLIMA}`);
    });

    verificarError(await consultar(RUTA), 502, "PROVEEDOR_NO_DISPONIBLE");
  });

  test("JSON inválido produce 502", async () => {
    simular(() => new Response("<html>no es json</html>", { status: 200 }));

    verificarError(await consultar(RUTA), 502, "PROVEEDOR_RESPUESTA_INVALIDA");
  });

  test("una estructura inválida produce 502 y no se confunde con una serie vacía", async () => {
    const valido = registro("2026-10-12T00:00:00Z", 20);
    const cuerpos = [
      {},
      [],
      null,
      "texto",
      42,
      { list: [] },
      { list: [], city: null },
      { list: [], city: {} },
      { list: [], city: { timezone: "0" } },
      { list: [], city: { timezone: 1.5 } },
      { list: [], city: { timezone: null } },
      { list: [], city: { timezone: 60000 } },
      { list: [], city: { timezone: -50000 } },
      { list: [valido], city: {} },
      { list: "no-es-arreglo", city: { timezone: 0 } },
      { list: null, city: { timezone: 0 } },
      { list: { 0: valido }, city: { timezone: 0 } },
    ];

    for (const cuerpo of cuerpos) {
      simular(() => respuestaJson(cuerpo));
      verificarError(await consultar(RUTA), 502, "PROVEEDOR_RESPUESTA_INVALIDA");
    }
  });

  test("un registro inválido produce 502 en lugar de un resumen con NaN", async () => {
    const valido = registro("2026-10-12T03:00:00Z", 20);
    const dt = Date.parse("2026-10-12T00:00:00Z") / 1000;
    const invalidos = [
      null,
      "texto",
      [],
      { main: { temp: 20 } },
      { dt: String(dt), main: { temp: 20 } },
      { dt: dt + 0.5, main: { temp: 20 } },
      { dt },
      { dt, main: null },
      { dt, main: {} },
      { dt, main: { temp: "20" } },
      { dt, main: { temp: null } },
    ];

    for (const invalido of invalidos) {
      simular(() => respuestaJson(pronostico([invalido, valido])));
      verificarError(await consultar(RUTA), 502, "PROVEEDOR_RESPUESTA_INVALIDA");
    }
  });

  test("un volumen de lluvia presente pero inválido no se convierte en cero", async () => {
    const dt = Date.parse("2026-10-12T00:00:00Z") / 1000;
    const lluviasInvalidas = [{ "3h": "1.2" }, { "3h": -1 }, { "3h": null }, {}, { "1h": 0.5 }, null, 5, [], "0"];

    for (const rain of lluviasInvalidas) {
      simular(() => respuestaJson(pronostico([{ dt, main: { temp: 20 }, rain }])));
      verificarError(await consultar(RUTA), 502, "PROVEEDOR_RESPUESTA_INVALIDA");
    }
  });

  test("intervalos superpuestos producen 502 para no duplicar acumulados", async () => {
    simular(() => respuestaJson(pronostico([registro("2026-10-12T00:00:00Z", 20, 1), registro("2026-10-12T01:00:00Z", 20, 1)])));

    verificarError(await consultar(RUTA), 502, "PROVEEDOR_RESPUESTA_INVALIDA");
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

  test("el tiempo de espera también cubre la lectura del cuerpo", async () => {
    let senal;
    simular((url, opciones) => {
      senal = opciones.signal;
      return {
        ok: true,
        status: 200,
        body: null,
        json: () => new Promise((resolve, reject) => opciones.signal.addEventListener("abort", () => reject(opciones.signal.reason))),
      };
    });

    const resultado = await consultar(RUTA);

    verificarError(resultado, 504, "PROVEEDOR_TIEMPO_AGOTADO");
    assert.equal(senal.aborted, true);
  });

  test("no registra la clave ni detalles del proveedor en la consola", async () => {
    const registrados = [];
    const originales = { log: console.log, warn: console.warn, error: console.error };
    for (const metodo of Object.keys(originales)) {
      console[metodo] = (...argumentos) => registrados.push(argumentos.map(String).join(" "));
    }

    try {
      const escenarios = [
        () => respuestaJson({ message: `Invalid API key ${CLAVE_CLIMA}` }, 401),
        () => new Response(`trace ${CLAVE_CLIMA}`, { status: 500 }),
        () => {
          throw new TypeError(`fetch failed appid=${CLAVE_CLIMA}`);
        },
        () => new Response("no json", { status: 200 }),
        () => respuestaJson({ list: [{ dt: 1 }], city: { timezone: 0 } }),
      ];
      for (const escenario of escenarios) {
        simular(escenario);
        await consultar(RUTA);
      }
    } finally {
      Object.assign(console, originales);
    }

    assert.ok(registrados.every((linea) => !linea.includes(CLAVE_CLIMA) && !linea.includes("appid")));
  });

  test("un fallo de OpenWeather no interrumpe GET /api/lugares", async () => {
    simular(() => {
      throw new TypeError("fetch failed");
    });
    verificarError(await consultar(RUTA), 502, "PROVEEDOR_NO_DISPONIBLE");

    const lugares = await consultar("/api/lugares?lat=14.6&lng=-90.5&categoria=entertainment.museum");

    assert.equal(lugares.estado, 200);
    assert.deepEqual(lugares.cuerpo, { lugares: [] });
    assert.equal(llamadasGeo.length, 1);
  });
});

describe("GET /api/clima/pronostico - configuración", () => {
  async function conAppSinClave(apiKey, prueba) {
    const app = crearApp({
      apiKey: CLAVE_GEO,
      fetch: async () => respuestaJson({ type: "FeatureCollection", features: [] }),
      clima: { apiKey, fetch: async () => assert.fail("no debe consultar al proveedor de clima") },
    });
    const { instancia, base } = await iniciar(app);
    try {
      await prueba(base);
    } finally {
      detener(instancia);
    }
  }

  test("sin clave responde 503 y GET /api/lugares sigue funcionando", async () => {
    await conAppSinClave("  ", async (base) => {
      const clima = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-13" }), base);
      verificarError(clima, 503, "SERVICIO_NO_CONFIGURADO");
      assert.match(clima.cuerpo.error.mensaje, /clima/);

      const invalida = await consultar(rutaClima({ fechaInicio: "2026-02-30", fechaFin: "2026-10-13" }), base);
      verificarError(invalida, 400, "PARAMETRO_INVALIDO");

      const lugares = await consultar("/api/lugares?lat=14.6&lng=-90.5&categoria=entertainment.museum", base);
      assert.equal(lugares.estado, 200);
      assert.deepEqual(lugares.cuerpo, { lugares: [] });
    });
  });

  test("no intercepta la ruta GET /api/clima existente", async () => {
    const resultado = await consultar("/api/clima");

    assert.equal(resultado.estado, 400);
    assert.equal(typeof resultado.cuerpo.error, "string");
    assert.equal(llamadas.length, 0);
  });

  test("usa OPENWEATHER_API_KEY del entorno cuando no se inyecta la clave", async () => {
    const original = process.env.OPENWEATHER_API_KEY;
    delete process.env.OPENWEATHER_API_KEY;
    try {
      await conAppSinClave(undefined, async (base) => {
        const clima = await consultar(rutaClima({ fechaInicio: "2026-10-12", fechaFin: "2026-10-13" }), base);
        verificarError(clima, 503, "SERVICIO_NO_CONFIGURADO");
      });
    } finally {
      if (original !== undefined) {
        process.env.OPENWEATHER_API_KEY = original;
      }
    }
  });
});
