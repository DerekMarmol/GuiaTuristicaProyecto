import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ErrorApi } from "../src/errores";
import { consultarProveedor } from "../src/hoteles/http";
import {
  MAX_ENTRADAS_CACHE_BUSQUEDAS,
  TTL_CACHE_BUSQUEDAS_MS,
  construirUrlSerpApi,
  crearBuscadorHoteles,
  interpretarRespuestaSerpApi,
  type ConsultaHoteles,
} from "../src/hoteles/serpapi";
import { ANTIGUEDAD_MAXIMA_TASA_MS, construirUrlExchangeRate, crearObtenedorTipoCambio, interpretarTipoCambio } from "../src/hoteles/tipoCambio";
import type { FuncionFetch } from "../src/tipos";

const CLAVE_SERP = "clave-serp-de-prueba-no-real";
const CLAVE_TASA = "clave-tasa-de-prueba-no-real";
const CONSULTA: ConsultaHoteles = { destino: "Antigua Guatemala", entrada: "2026-10-14", salida: "2026-10-15", adultos: 2 };
const SEGUNDO_ACTUALIZACION = Date.parse("2026-10-10T00:00:01Z") / 1000;
const SEGUNDO_SIGUIENTE = SEGUNDO_ACTUALIZACION + 86400;

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

function hotel(token: string, cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "hotel",
    name: `Hotel ${token}`,
    property_token: token,
    gps_coordinates: { latitude: 14.5586, longitude: -90.7295 },
    total_rate: { lowest: "$24", extracted_lowest: 24, before_taxes_fees: "$21", extracted_before_taxes_fees: 21 },
    ...cambios,
  };
}

function coleccion(propiedades: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { search_metadata: { status: "Success" }, properties: propiedades, ...extra };
}

function tasaValida(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    result: "success",
    time_last_update_unix: SEGUNDO_ACTUALIZACION,
    time_next_update_unix: SEGUNDO_SIGUIENTE,
    base_code: "USD",
    conversion_rates: { USD: 1, GTQ: 7.65 },
    ...cambios,
  };
}

function reloj(inicio: string) {
  let instante = Date.parse(inicio);
  return {
    ahora: () => new Date(instante),
    avanzar: (ms: number) => {
      instante += ms;
    },
  };
}

function esError(estado: number, codigo: string, ...secretos: string[]) {
  return (error: unknown) => {
    assert.ok(error instanceof ErrorApi, String(error));
    assert.equal(error.estado, estado);
    assert.equal(error.codigo, codigo);
    for (const secreto of secretos) {
      assert.ok(!error.message.includes(secreto));
      assert.ok(!JSON.stringify(error).includes(secreto));
    }
    return true;
  };
}

describe("construirUrlSerpApi", () => {
  test("usa search.json, google_hotels y los parámetros documentados para una noche sin niños", () => {
    const url = construirUrlSerpApi(CONSULTA, CLAVE_SERP);
    assert.equal(url.origin + url.pathname, "https://serpapi.com/search.json");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      engine: "google_hotels",
      q: "hoteles en Antigua Guatemala",
      check_in_date: "2026-10-14",
      check_out_date: "2026-10-15",
      adults: "2",
      children: "0",
      currency: "USD",
      hl: "es",
      api_key: CLAVE_SERP,
    });
  });

  test("codifica el destino sin alterar la consulta y no agrega parámetros geográficos", () => {
    const url = construirUrlSerpApi({ ...CONSULTA, destino: "Flores & Petén #1" }, CLAVE_SERP);
    assert.equal(url.searchParams.get("q"), "hoteles en Flores & Petén #1");
    for (const parametro of ["ll", "location", "gps_coordinates", "lat", "lng", "radius", "gl", "children_ages", "next_page_token"]) {
      assert.equal(url.searchParams.has(parametro), false, parametro);
    }
  });
});

describe("interpretarRespuestaSerpApi", () => {
  test("normaliza una colección de propiedades e informa si hay más páginas sin consultarlas", () => {
    const pagina = interpretarRespuestaSerpApi(coleccion([hotel("t1")], { serpapi_pagination: { next_page_token: "CBI=", next: "https://serpapi.com/search.json?api_key=x" } }), 2);
    assert.equal(pagina.resultadosRecibidos, 1);
    assert.equal(pagina.hayMasPaginas, true);
    assert.deepEqual(pagina.hoteles, [
      {
        idExterno: "t1",
        nombre: "Hotel t1",
        lat: 14.5586,
        lng: -90.7295,
        precio: {
          importeUsdCentavos: 2400,
          campo: "total_rate",
          impuestos: { estado: "informado", antesImpuestosUsdCentavos: 2100 },
          fuente: { tipo: "resumen_propiedad" },
        },
      },
    ]);
    assert.equal(interpretarRespuestaSerpApi(coleccion([hotel("t1")]), 2).hayMasPaginas, false);
  });

  test("acepta la respuesta de una propiedad individual en la raíz", () => {
    const pagina = interpretarRespuestaSerpApi({ search_metadata: { status: "Success" }, ...hotel("unico") }, 2);
    assert.equal(pagina.resultadosRecibidos, 1);
    assert.deepEqual(pagina.hoteles.map((h) => h.idExterno), ["unico"]);
  });

  test("una búsqueda legítima sin resultados es una página vacía, no un error", () => {
    const vacia = { search_metadata: { status: "Success" }, error: "Google Hotels hasn't returned any results for this query." };
    assert.deepEqual(interpretarRespuestaSerpApi(vacia, 2), { resultadosRecibidos: 0, hoteles: [], hayMasPaginas: false });
    assert.deepEqual(interpretarRespuestaSerpApi(coleccion([]), 2), { resultadosRecibidos: 0, hoteles: [], hayMasPaginas: false });
  });

  test("distingue estructuras inesperadas de búsquedas vacías", () => {
    const casos: unknown[] = [null, [], "texto", {}, { search_metadata: { status: "Success" } }, { properties: {} }, { resultados: [] }];
    for (const caso of casos) {
      assert.throws(() => interpretarRespuestaSerpApi(caso, 2), esError(502, "PROVEEDOR_RESPUESTA_INVALIDA"), JSON.stringify(caso));
    }
  });

  test("trata los errores dentro del JSON según su significado", () => {
    assert.throws(
      () => interpretarRespuestaSerpApi({ search_metadata: { status: "Error" }, error: "We couldn't get valid results for this search." }, 2),
      esError(502, "PROVEEDOR_ERROR"),
    );
    assert.throws(() => interpretarRespuestaSerpApi({ error: "Your account has run out of searches." }, 2), esError(503, "PROVEEDOR_LIMITE_SOLICITUDES"));
    assert.throws(() => interpretarRespuestaSerpApi({ error: "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key" }, 2), esError(502, "PROVEEDOR_CREDENCIALES_INVALIDAS"));
    assert.throws(() => interpretarRespuestaSerpApi({ error: "Algo salió mal" }, 2), esError(502, "PROVEEDOR_ERROR"));
    assert.throws(() => interpretarRespuestaSerpApi({ search_metadata: { status: "Processing" }, properties: [] }, 2), esError(502, "PROVEEDOR_ERROR"));
  });

  test("excluye anuncios, alquileres vacacionales y registros incompletos", () => {
    const datos = coleccion(
      [
        hotel("valido"),
        hotel("alquiler", { type: "vacation rental" }),
        hotel("sin-tipo", { type: undefined }),
        hotel("", {}),
        hotel("sin-token", { property_token: undefined }),
        hotel("sin-nombre", { name: "   " }),
        hotel("sin-coordenadas", { gps_coordinates: undefined }),
        hotel("lat-fuera", { gps_coordinates: { latitude: 91, longitude: 0 } }),
        hotel("lat-texto", { gps_coordinates: { latitude: "14.5", longitude: -90.7 } }),
        hotel("sin-precio", { total_rate: undefined }),
        hotel("precio-texto", { total_rate: { lowest: "$24" } }),
        hotel("precio-cero", { total_rate: { extracted_lowest: 0 } }),
        null,
        "hotel",
      ],
      { ads: [{ name: "Anuncio", property_token: "anuncio", gps_coordinates: { latitude: 14.5586, longitude: -90.7295 }, extracted_price: 5 }] },
    );
    const pagina = interpretarRespuestaSerpApi(datos, 2);
    assert.equal(pagina.resultadosRecibidos, 14);
    assert.deepEqual(pagina.hoteles.map((h) => h.idExterno), ["valido"]);
  });

  test("acepta coordenadas cero", () => {
    const pagina = interpretarRespuestaSerpApi(coleccion([hotel("cero", { gps_coordinates: { latitude: 0, longitude: 0 } })]), 2);
    assert.deepEqual([pagina.hoteles[0].lat, pagina.hoteles[0].lng], [0, 0]);
  });
});

describe("crearBuscadorHoteles", () => {
  function preparar(respuesta: () => Response | Promise<Response> = () => respuestaJson(coleccion([hotel("t1")]))) {
    const tiempo = reloj("2026-10-10T18:00:00Z");
    const llamadas: URL[] = [];
    const fetch: FuncionFetch = async (url) => {
      llamadas.push(url);
      return respuesta();
    };
    return { tiempo, llamadas, buscador: crearBuscadorHoteles({ apiKey: CLAVE_SERP, fetch, ahora: tiempo.ahora }) };
  }

  test("sin clave no consulta y responde 503 SERVICIO_NO_CONFIGURADO", async () => {
    let llamadas = 0;
    const buscador = crearBuscadorHoteles({ apiKey: "  ", fetch: async () => (llamadas++, respuestaJson({})) });
    assert.equal(buscador.configurado, false);
    await assert.rejects(buscador.buscar(CONSULTA), esError(503, "SERVICIO_NO_CONFIGURADO"));
    assert.equal(llamadas, 0);
  });

  test("reutiliza una búsqueda exitosa durante 15 minutos conservando la fecha original de consulta", async () => {
    const { tiempo, llamadas, buscador } = preparar();
    const primera = await buscador.buscar(CONSULTA);
    tiempo.avanzar(TTL_CACHE_BUSQUEDAS_MS - 1);
    const segunda = await buscador.buscar(CONSULTA);
    assert.equal(llamadas.length, 1);
    assert.equal(primera.desdeCache, false);
    assert.equal(segunda.desdeCache, true);
    assert.equal(segunda.consultadoEn, "2026-10-10T18:00:00.000Z");
    assert.deepEqual(segunda.hoteles, primera.hoteles);

    tiempo.avanzar(1);
    const tercera = await buscador.buscar(CONSULTA);
    assert.equal(llamadas.length, 2);
    assert.equal(tercera.desdeCache, false);
    assert.equal(tercera.consultadoEn, new Date(Date.parse("2026-10-10T18:00:00Z") + TTL_CACHE_BUSQUEDAS_MS).toISOString());
  });

  test("separa la caché por destino, fechas y ocupación", async () => {
    const { llamadas, buscador } = preparar();
    await buscador.buscar(CONSULTA);
    await buscador.buscar({ ...CONSULTA, destino: "Flores" });
    await buscador.buscar({ ...CONSULTA, entrada: "2026-10-15", salida: "2026-10-16" });
    await buscador.buscar({ ...CONSULTA, adultos: 3 });
    await buscador.buscar(CONSULTA);
    assert.equal(llamadas.length, 4);
    assert.deepEqual(
      llamadas.map((u) => [u.searchParams.get("q"), u.searchParams.get("check_in_date"), u.searchParams.get("adults")]),
      [
        ["hoteles en Antigua Guatemala", "2026-10-14", "2"],
        ["hoteles en Flores", "2026-10-14", "2"],
        ["hoteles en Antigua Guatemala", "2026-10-15", "2"],
        ["hoteles en Antigua Guatemala", "2026-10-14", "3"],
      ],
    );
  });

  test("guarda como máximo 100 entradas y descarta la menos usada", async () => {
    const { llamadas, buscador } = preparar();
    for (let i = 0; i < MAX_ENTRADAS_CACHE_BUSQUEDAS; i++) {
      await buscador.buscar({ ...CONSULTA, destino: `Destino ${i}` });
    }
    await buscador.buscar({ ...CONSULTA, destino: "Destino 0" });
    await buscador.buscar({ ...CONSULTA, destino: "Destino nuevo" });
    assert.equal(llamadas.length, MAX_ENTRADAS_CACHE_BUSQUEDAS + 1);
    await buscador.buscar({ ...CONSULTA, destino: "Destino 0" });
    assert.equal(llamadas.length, MAX_ENTRADAS_CACHE_BUSQUEDAS + 1);
    await buscador.buscar({ ...CONSULTA, destino: "Destino 1" });
    assert.equal(llamadas.length, MAX_ENTRADAS_CACHE_BUSQUEDAS + 2);
  });

  test("comparte una consulta en curso entre solicitudes concurrentes idénticas", async () => {
    let liberar: (respuesta: Response) => void = () => {};
    const { llamadas, buscador } = preparar(() => new Promise<Response>((resolver) => (liberar = resolver)));
    const pendientes = [buscador.buscar(CONSULTA), buscador.buscar(CONSULTA), buscador.buscar(CONSULTA)];
    await new Promise((resolver) => setImmediate(resolver));
    liberar(respuestaJson(coleccion([hotel("t1")])));
    const resultados = await Promise.all(pendientes);
    assert.equal(llamadas.length, 1);
    assert.deepEqual(resultados.map((r) => r.desdeCache), [false, true, true]);
  });

  test("no guarda errores en caché", async () => {
    let fallar = true;
    const { llamadas, buscador } = preparar(() => (fallar ? respuestaJson({ error: "fallo" }, 500) : respuestaJson(coleccion([hotel("t1")]))));
    await assert.rejects(buscador.buscar(CONSULTA), esError(502, "PROVEEDOR_ERROR"));
    fallar = false;
    assert.equal((await buscador.buscar(CONSULTA)).hoteles.length, 1);
    assert.equal(llamadas.length, 2);
  });

  test("traduce los estados HTTP y los errores del proveedor sin exponer la clave", async () => {
    const casos: [string, () => Response | Promise<Response>, number, string][] = [
      ["401", () => respuestaJson({ error: `Invalid API key ${CLAVE_SERP}` }, 401), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
      ["403", () => respuestaJson({}, 403), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
      ["429 por cuota", () => respuestaJson({ error: "Your account has run out of searches." }, 429), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
      ["400", () => respuestaJson({ error: "Missing query `q` parameter." }, 400), 502, "PROVEEDOR_ERROR"],
      ["503 con estado Error", () => respuestaJson({ search_metadata: { status: "Error" }, error: "We couldn't get valid results." }, 503), 502, "PROVEEDOR_ERROR"],
      ["cuota en un 200", () => respuestaJson({ error: "Your account has run out of searches." }), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
      ["no JSON", () => new Response("<html>", { status: 200 }), 502, "PROVEEDOR_RESPUESTA_INVALIDA"],
      ["no JSON con error", () => new Response("<html>", { status: 502 }), 502, "PROVEEDOR_ERROR"],
      [
        "fallo de red",
        () => {
          throw new TypeError(`fetch failed https://serpapi.com/search.json?api_key=${CLAVE_SERP}`);
        },
        502,
        "PROVEEDOR_NO_DISPONIBLE",
      ],
    ];
    for (const [nombre, respuesta, estado, codigo] of casos) {
      const { buscador } = preparar(respuesta);
      await assert.rejects(buscador.buscar(CONSULTA), esError(estado, codigo, CLAVE_SERP, "api_key", "serpapi.com/search"), nombre);
    }
  });

  test("cancela la consulta al agotarse el tiempo y responde 504", async () => {
    let senal: AbortSignal | undefined;
    const buscador = crearBuscadorHoteles({
      apiKey: CLAVE_SERP,
      tiempoEsperaMs: 20,
      fetch: (_url, opciones) => {
        senal = opciones?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
    });
    await assert.rejects(buscador.buscar(CONSULTA), esError(504, "PROVEEDOR_TIEMPO_AGOTADO", CLAVE_SERP));
    assert.equal(senal?.aborted, true);
  });
});

describe("consultarProveedor", () => {
  const base = { url: new URL("https://ejemplo.invalid/datos"), servicio: "de prueba" };

  test("el tiempo de espera también cubre la lectura del cuerpo y cancela el flujo", async () => {
    let cancelado = false;
    const cuerpo = new ReadableStream<Uint8Array>({
      start(controlador) {
        controlador.enqueue(new TextEncoder().encode('{"parcial":'));
      },
      cancel() {
        cancelado = true;
      },
    });
    await assert.rejects(
      consultarProveedor({ ...base, tiempoEsperaMs: 20, maxBytes: 1024, fetch: async () => new Response(cuerpo, { status: 200 }) }),
      esError(504, "PROVEEDOR_TIEMPO_AGOTADO"),
    );
    assert.equal(cancelado, true);
  });

  test("rechaza respuestas que superan el tamaño máximo, declarado o real", async () => {
    const grande = "x".repeat(2048);
    await assert.rejects(
      consultarProveedor({ ...base, tiempoEsperaMs: 1000, maxBytes: 1024, fetch: async () => new Response(grande, { headers: { "Content-Length": "2048" } }) }),
      esError(502, "PROVEEDOR_RESPUESTA_INVALIDA"),
    );
    let cancelado = false;
    const flujo = new ReadableStream<Uint8Array>({
      pull(controlador) {
        controlador.enqueue(new Uint8Array(512));
      },
      cancel() {
        cancelado = true;
      },
    });
    await assert.rejects(
      consultarProveedor({ ...base, tiempoEsperaMs: 1000, maxBytes: 1024, fetch: async () => new Response(flujo) }),
      esError(502, "PROVEEDOR_RESPUESTA_INVALIDA"),
    );
    assert.equal(cancelado, true);
  });

  test("devuelve el estado y distingue JSON inválido", async () => {
    const valido = await consultarProveedor({ ...base, tiempoEsperaMs: 1000, maxBytes: 1024, fetch: async () => respuestaJson({ a: 1 }, 404) });
    assert.deepEqual(valido, { estado: 404, ok: false, datos: { a: 1 }, jsonValido: true });
    const invalido = await consultarProveedor({ ...base, tiempoEsperaMs: 1000, maxBytes: 1024, fetch: async () => new Response("{") });
    assert.equal(invalido.jsonValido, false);
  });
});

describe("interpretarTipoCambio", () => {
  const ahora = new Date("2026-10-10T18:00:00Z");

  test("acepta una respuesta estándar válida y vence en la siguiente actualización", () => {
    const { valor, expiraEn } = interpretarTipoCambio(tasaValida(), ahora);
    assert.deepEqual(valor, {
      proveedor: "exchangerate-api",
      base: "USD",
      destino: "GTQ",
      tasa: 7.65,
      actualizadoEn: "2026-10-10T00:00:01.000Z",
      proximaActualizacion: "2026-10-11T00:00:01.000Z",
      consultadoEn: "2026-10-10T18:00:00.000Z",
    });
    assert.equal(expiraEn, SEGUNDO_SIGUIENTE * 1000);
  });

  test("limita la vigencia a 36 horas desde la actualización de origen", () => {
    const { expiraEn } = interpretarTipoCambio(tasaValida({ time_next_update_unix: SEGUNDO_ACTUALIZACION + 7 * 86400 }), ahora);
    assert.equal(expiraEn, SEGUNDO_ACTUALIZACION * 1000 + ANTIGUEDAD_MAXIMA_TASA_MS);
  });

  test("rechaza estructuras, tasas y fechas inválidas", () => {
    const { conversion_rates: _tasas, ...sinTasas } = tasaValida();
    const casos: [string, unknown][] = [
      ["no objeto", null],
      ["sin result", { ...tasaValida(), result: undefined }],
      ["otra base", tasaValida({ base_code: "EUR" })],
      ["modalidad abierta con rates", { ...sinTasas, rates: { GTQ: 7.65 } }],
      ["sin GTQ", tasaValida({ conversion_rates: { USD: 1 } })],
      ["GTQ texto", tasaValida({ conversion_rates: { GTQ: "7.65" } })],
      ["GTQ cero", tasaValida({ conversion_rates: { GTQ: 0 } })],
      ["GTQ negativa", tasaValida({ conversion_rates: { GTQ: -7.65 } })],
      ["sin fecha", tasaValida({ time_last_update_unix: undefined })],
      ["fecha texto", tasaValida({ time_last_update_unix: "1760054401" })],
      ["siguiente anterior", tasaValida({ time_next_update_unix: SEGUNDO_ACTUALIZACION - 1 })],
      ["actualización futura", tasaValida({ time_last_update_unix: ahora.getTime() / 1000 + 3600, time_next_update_unix: ahora.getTime() / 1000 + 90000 })],
      ["más de 36 horas", tasaValida({ time_last_update_unix: SEGUNDO_ACTUALIZACION - 2 * 86400, time_next_update_unix: SEGUNDO_ACTUALIZACION - 86400 })],
    ];
    for (const [nombre, datos] of casos) {
      assert.throws(() => interpretarTipoCambio(datos, ahora), esError(502, "PROVEEDOR_RESPUESTA_INVALIDA"), nombre);
    }
  });

  test("traduce los errores documentados dentro del JSON", () => {
    const casos: [string, number, string][] = [
      ["invalid-key", 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
      ["inactive-account", 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
      ["quota-reached", 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
      ["unsupported-code", 502, "PROVEEDOR_ERROR"],
      ["malformed-request", 502, "PROVEEDOR_ERROR"],
    ];
    for (const [tipo, estado, codigo] of casos) {
      assert.throws(() => interpretarTipoCambio({ result: "error", "error-type": tipo }, ahora), esError(estado, codigo), tipo);
    }
  });
});

describe("crearObtenedorTipoCambio", () => {
  function preparar(respuesta: () => Response | Promise<Response> = () => respuestaJson(tasaValida())) {
    const tiempo = reloj("2026-10-10T18:00:00Z");
    const llamadas: URL[] = [];
    const obtenedor = crearObtenedorTipoCambio({
      apiKey: CLAVE_TASA,
      ahora: tiempo.ahora,
      fetch: async (url) => {
        llamadas.push(url);
        return respuesta();
      },
    });
    return { tiempo, llamadas, obtenedor };
  }

  test("consulta el endpoint estándar con la clave en la ruta", async () => {
    const { llamadas, obtenedor } = preparar();
    await obtenedor.obtener();
    assert.equal(llamadas[0].href, `https://v6.exchangerate-api.com/v6/${CLAVE_TASA}/latest/USD`);
    assert.equal(construirUrlExchangeRate("a/b").pathname, "/v6/a%2Fb/latest/USD");
  });

  test("reutiliza la tasa hasta la siguiente actualización sin prolongar su vigencia por leerla", async () => {
    const { tiempo, llamadas, obtenedor } = preparar();
    const primera = await obtenedor.obtener();
    for (let i = 0; i < 5; i++) {
      tiempo.avanzar(60 * 60 * 1000);
      assert.equal(await obtenedor.obtener(), primera);
    }
    assert.equal(llamadas.length, 1);
    tiempo.avanzar(SEGUNDO_SIGUIENTE * 1000 - tiempo.ahora().getTime());
    await obtenedor.obtener();
    assert.equal(llamadas.length, 2);
  });

  test("vuelve a consultar al cumplirse 36 horas aunque la siguiente actualización sea posterior", async () => {
    const { tiempo, llamadas, obtenedor } = preparar(() => respuestaJson(tasaValida({ time_next_update_unix: SEGUNDO_ACTUALIZACION + 7 * 86400 })));
    await obtenedor.obtener();
    tiempo.avanzar(SEGUNDO_ACTUALIZACION * 1000 + ANTIGUEDAD_MAXIMA_TASA_MS - 1 - tiempo.ahora().getTime());
    await obtenedor.obtener();
    assert.equal(llamadas.length, 1);
    tiempo.avanzar(1);
    await assert.rejects(obtenedor.obtener(), esError(502, "PROVEEDOR_RESPUESTA_INVALIDA"));
    assert.equal(llamadas.length, 2);
  });

  test("comparte una única actualización entre solicitudes concurrentes", async () => {
    let liberar: (respuesta: Response) => void = () => {};
    const { llamadas, obtenedor } = preparar(() => new Promise<Response>((resolver) => (liberar = resolver)));
    const pendientes = [obtenedor.obtener(), obtenedor.obtener(), obtenedor.obtener()];
    await new Promise((resolver) => setImmediate(resolver));
    liberar(respuestaJson(tasaValida()));
    const tasas = await Promise.all(pendientes);
    assert.equal(llamadas.length, 1);
    assert.ok(tasas.every((t) => t.tasa === 7.65));
  });

  test("sin tasa vigente en caché devuelve un error explícito y no usa la anterior vencida", async () => {
    let fallar = false;
    const { tiempo, obtenedor } = preparar(() => (fallar ? respuestaJson({ result: "error", "error-type": "quota-reached" }, 429) : respuestaJson(tasaValida())));
    await obtenedor.obtener();
    fallar = true;
    tiempo.avanzar(SEGUNDO_SIGUIENTE * 1000 - tiempo.ahora().getTime());
    await assert.rejects(obtenedor.obtener(), esError(503, "PROVEEDOR_LIMITE_SOLICITUDES"));
    await assert.rejects(obtenedor.obtener(), esError(503, "PROVEEDOR_LIMITE_SOLICITUDES"));
  });

  test("traduce respuestas HTTP sin exponer la clave ni la URL", async () => {
    const casos: [string, () => Response, number, string][] = [
      ["403 invalid-key", () => respuestaJson({ result: "error", "error-type": "invalid-key" }, 403), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
      ["200 inactive-account", () => respuestaJson({ result: "error", "error-type": "inactive-account" }), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
      ["200 quota-reached", () => respuestaJson({ result: "error", "error-type": "quota-reached" }), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
      ["401 sin cuerpo", () => new Response("", { status: 401 }), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
      ["429 sin cuerpo", () => new Response("", { status: 429 }), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
      ["500", () => new Response("error", { status: 500 }), 502, "PROVEEDOR_ERROR"],
      ["no JSON", () => new Response("<html>"), 502, "PROVEEDOR_RESPUESTA_INVALIDA"],
    ];
    for (const [nombre, respuesta, estado, codigo] of casos) {
      const { obtenedor } = preparar(respuesta);
      await assert.rejects(obtenedor.obtener(), esError(estado, codigo, CLAVE_TASA, "v6.exchangerate-api.com"), nombre);
    }
  });

  test("cancela la consulta al agotarse el tiempo y responde 504", async () => {
    let senal: AbortSignal | undefined;
    const obtenedor = crearObtenedorTipoCambio({
      apiKey: CLAVE_TASA,
      tiempoEsperaMs: 20,
      fetch: (_url, opciones) => {
        senal = opciones?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
    });
    await assert.rejects(obtenedor.obtener(), esError(504, "PROVEEDOR_TIEMPO_AGOTADO", CLAVE_TASA));
    assert.equal(senal?.aborted, true);
  });

  test("sin clave no consulta y responde 503 SERVICIO_NO_CONFIGURADO", async () => {
    let llamadas = 0;
    const obtenedor = crearObtenedorTipoCambio({ apiKey: "", fetch: async () => (llamadas++, respuestaJson(tasaValida())) });
    assert.equal(obtenedor.configurado, false);
    await assert.rejects(obtenedor.obtener(), esError(503, "SERVICIO_NO_CONFIGURADO"));
    assert.equal(llamadas, 0);
  });
});
