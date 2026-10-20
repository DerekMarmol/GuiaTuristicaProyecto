import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import type { RespuestaRecomendacionesHoteles } from "../../shared/types";
import { crearApp, type OpcionesApp } from "../src/app";
import { TTL_CACHE_BUSQUEDAS_MS } from "../src/hoteles/serpapi";

interface CuerpoError {
  error: { codigo: string; mensaje: string; detalles?: { parametro: string; mensaje: string }[] };
}

interface Resultado<T> {
  estado: number;
  texto: string;
  cuerpo: T;
}

interface HotelSimulado {
  token: string;
  lat: number;
  lng: number;
  usd?: number;
  antes?: number;
  nombre?: string;
  tipo?: string;
}

type Simulador = (url: URL, opciones: RequestInit | undefined) => Response | Promise<Response>;

const CLAVE_SERP = "clave-serp-de-prueba-no-real";
const CLAVE_TASA = "clave-tasa-de-prueba-no-real";
const RUTA = "/api/hoteles/recomendaciones";
const INICIO = Date.parse("2026-10-10T18:00:00Z");
const ULTIMA_ACTUALIZACION = Date.parse("2026-10-10T00:00:01Z") / 1000;
const PARADAS = [
  { lat: 14.6, lng: -90.5 },
  { lat: 14.62, lng: -90.52 },
];

let serpapi: Simulador;
let exchangeRate: Simulador;
let llamadas: URL[];
let instante: number;
let servidores: FastifyInstance[];
let baseUrl: string;

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

function propiedad({ token, lat, lng, usd = 24, antes, nombre, tipo = "hotel" }: HotelSimulado): Record<string, unknown> {
  const bloque = { lowest: `$${usd}`, extracted_lowest: usd, ...(antes === undefined ? {} : { before_taxes_fees: `$${antes}`, extracted_before_taxes_fees: antes }) };
  return {
    type: tipo,
    name: nombre ?? `Hotel ${token}`,
    property_token: token,
    gps_coordinates: { latitude: lat, longitude: lng },
    rate_per_night: bloque,
    total_rate: bloque,
    serpapi_property_details_link: `https://serpapi.com/search.json?engine=google_hotels&property_token=${token}`,
  };
}

function devolverHoteles(hoteles: HotelSimulado[], extra: Record<string, unknown> = {}): void {
  serpapi = () =>
    respuestaJson({
      search_metadata: { status: "Success", json_endpoint: "https://serpapi.com/searches/ficticio.json" },
      search_parameters: { engine: "google_hotels", q: "consulta" },
      properties: hoteles.map(propiedad),
      ...extra,
    });
}

function usarTasa(tasa: number, cambios: Record<string, unknown> = {}): void {
  exchangeRate = () =>
    respuestaJson({
      result: "success",
      documentation: "https://www.exchangerate-api.com/docs",
      time_last_update_unix: ULTIMA_ACTUALIZACION,
      time_next_update_unix: ULTIMA_ACTUALIZACION + 86400,
      base_code: "USD",
      conversion_rates: { USD: 1, GTQ: tasa },
      ...cambios,
    });
}

function solicitud(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fecha: "2026-10-14",
    destino: "Ciudad de prueba",
    paradas: PARADAS,
    presupuestoDiario: 500,
    moneda: "GTQ",
    ocupacion: 2,
    hospedaje: false,
    ...cambios,
  };
}

async function iniciar(opciones: OpcionesApp["hoteles"] = {}): Promise<string> {
  const app = crearApp({
    apiKey: "",
    fetch: async (url, init) => {
      const direccion = new URL(url);
      llamadas.push(direccion);
      if (direccion.hostname === "serpapi.com") {
        return serpapi(direccion, init);
      }
      if (direccion.hostname === "v6.exchangerate-api.com") {
        return exchangeRate(direccion, init);
      }
      throw new Error(`Host no simulado: ${direccion.hostname}`);
    },
    hoteles: { serpApiKey: CLAVE_SERP, exchangeRateApiKey: CLAVE_TASA, tiempoEsperaMs: 50, ahora: () => new Date(instante), ...opciones },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  servidores.push(app);
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

async function enviarA<T>(url: string, datos: unknown): Promise<Resultado<T>> {
  const respuesta = await fetch(`${url}${RUTA}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof datos === "string" ? datos : JSON.stringify(datos),
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, texto, cuerpo: JSON.parse(texto) as T };
}

function enviar<T = RespuestaRecomendacionesHoteles>(datos: unknown): Promise<Resultado<T>> {
  return enviarA<T>(baseUrl, datos);
}

function sinSecretos(texto: string): void {
  for (const secreto of [CLAVE_SERP, CLAVE_TASA, "api_key", "serpapi.com/search", "v6.exchangerate-api.com", "serpapi_property_details_link"]) {
    assert.ok(!texto.includes(secreto), `la respuesta no debe incluir ${secreto}`);
  }
}

function verificarError(resultado: Resultado<CuerpoError>, estado: number, codigo: string): void {
  assert.equal(resultado.estado, estado);
  assert.equal(resultado.cuerpo.error.codigo, codigo);
  assert.equal(typeof resultado.cuerpo.error.mensaje, "string");
  assert.ok(!/sesi[oó]n expirada|inicia sesi[oó]n|login/i.test(resultado.cuerpo.error.mensaje));
  sinSecretos(resultado.texto);
}

const llamadasA = (host: string) => llamadas.filter((url) => url.hostname === host);

beforeEach(async () => {
  llamadas = [];
  servidores = [];
  instante = INICIO;
  devolverHoteles([]);
  usarTasa(7.65);
  mock.method(console, "error", () => {});
  baseUrl = await iniciar();
});

afterEach(async () => {
  for (const servidor of servidores) {
    servidor.server.closeAllConnections();
    await servidor.close();
  }
  mock.restoreAll();
});

describe("POST /api/hoteles/recomendaciones - recomendaciones", () => {
  test("fixture de prueba: USD 24 con tasa ficticia 7.65 se convierte en Q183.60 y entra en Q200", async () => {
    serpapi = () =>
      respuestaJson({
        search_metadata: { status: "Success" },
        properties: [
          {
            ...propiedad({ token: "tok-uno", lat: 14.61, lng: -90.51, usd: 24, antes: 21, nombre: "Hotel Uno" }),
            prices: [{ source: "Agencia", link: "https://www.google.com/travel/clk?pcurl=x%26price_displayed_total%3D24.49" }],
          },
        ],
        serpapi_pagination: { next_page_token: "CBI=", next: `https://serpapi.com/search.json?api_key=${CLAVE_SERP}` },
      });

    const { estado, cuerpo, texto } = await enviar(solicitud());

    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, null);
    assert.equal(cuerpo.mensaje, null);
    assert.equal(cuerpo.destino, "Ciudad de prueba");
    assert.deepEqual(cuerpo.estancia, { entrada: "2026-10-14", salida: "2026-10-15", noches: 1, adultos: 2, ninos: 0 });
    assert.equal(cuerpo.presupuestoHospedaje, 200);
    assert.equal(cuerpo.presupuestoHospedajeCentavos, 20000);
    assert.equal(cuerpo.porcentajeHospedaje, 40);
    assert.deepEqual(cuerpo.hoteles, [
      {
        idExterno: "tok-uno",
        proveedor: "serpapi",
        nombre: "Hotel Uno",
        lat: 14.61,
        lng: -90.51,
        distanciaLineaRectaMetros: cuerpo.hoteles[0].distanciaLineaRectaMetros,
        tarifa: {
          referencial: true,
          importeUsd: 24,
          importeUsdCentavos: 2400,
          importe: 183.6,
          importeCentavos: 18360,
          moneda: "GTQ",
          unidad: "habitacion_noche",
          noches: 1,
          campo: "total_rate",
          fuente: { tipo: "resumen_propiedad" },
          impuestos: { estado: "informado", importeAntesImpuestosUsd: 21, impuestosYCargosUsd: 3 },
        },
      },
    ]);
    assert.deepEqual(cuerpo.busqueda, {
      proveedor: "serpapi",
      motor: "google_hotels",
      consulta: "hoteles en Ciudad de prueba",
      monedaProveedor: "USD",
      consultadoEn: "2026-10-10T18:00:00.000Z",
      desdeCache: false,
      radioMetros: 5000,
      resultadosRecibidos: 1,
      hotelesConPrecio: 1,
      hotelesEnRadio: 1,
      hayMasPaginas: true,
    });
    assert.deepEqual(cuerpo.tipoCambio, {
      proveedor: "exchangerate-api",
      base: "USD",
      destino: "GTQ",
      tasa: 7.65,
      actualizadoEn: "2026-10-10T00:00:01.000Z",
      proximaActualizacion: "2026-10-11T00:00:01.000Z",
      consultadoEn: "2026-10-10T18:00:00.000Z",
    });
    assert.ok(!texto.includes("24.49"));
    sinSecretos(texto);

    const [busqueda] = llamadasA("serpapi.com");
    assert.equal(busqueda.pathname, "/search.json");
    assert.deepEqual(Object.fromEntries(busqueda.searchParams), {
      engine: "google_hotels",
      q: "hoteles en Ciudad de prueba",
      check_in_date: "2026-10-14",
      check_out_date: "2026-10-15",
      adults: "2",
      children: "0",
      currency: "USD",
      hl: "es",
      api_key: CLAVE_SERP,
    });
    assert.equal(llamadasA("v6.exchangerate-api.com")[0].pathname, `/v6/${CLAVE_TASA}/latest/USD`);
    assert.equal(llamadas.length, 2);
  });

  test("sin desglose informa impuestos no informados y usa rate_per_night solo si falta el total", async () => {
    serpapi = () =>
      respuestaJson({
        search_metadata: { status: "Success" },
        properties: [{ ...propiedad({ token: "tok-noche", lat: 14.61, lng: -90.51, usd: 20 }), total_rate: undefined }],
      });
    const { cuerpo } = await enviar(solicitud());
    assert.equal(cuerpo.hoteles[0].tarifa.campo, "rate_per_night");
    assert.deepEqual(cuerpo.hoteles[0].tarifa.impuestos, { estado: "no_informado" });
    assert.equal(cuerpo.hoteles[0].tarifa.importeCentavos, 15300);
  });

  test("ordena por cercanía al centro del día aunque el proveedor entregue otro orden", async () => {
    devolverHoteles([
      { token: "tok-lejano", lat: 14.65, lng: -90.51 },
      { token: "tok-cercano", lat: 14.611, lng: -90.51 },
      { token: "tok-medio", lat: 14.63, lng: -90.51 },
    ]);
    const { cuerpo } = await enviar(solicitud());
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["tok-cercano", "tok-medio", "tok-lejano"]);
    assert.ok(cuerpo.centro && Math.abs(cuerpo.centro.lat - 14.61) < 1e-3 && Math.abs(cuerpo.centro.lng + 90.51) < 1e-3);
    assert.equal(cuerpo.metodoDistancia, "linea_recta");
  });

  test("resuelve empates de distancia por idExterno y elimina duplicados", async () => {
    devolverHoteles([
      { token: "tok-c", lat: 14.612, lng: -90.51 },
      { token: "tok-b", lat: 14.611, lng: -90.51 },
      { token: "tok-a", lat: 14.611, lng: -90.51 },
      { token: "tok-b", lat: 14.611, lng: -90.51, usd: 10 },
    ]);
    const { cuerpo } = await enviar(solicitud());
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["tok-a", "tok-b", "tok-c"]);
    assert.equal(cuerpo.hoteles[1].tarifa.importeUsd, 24);
    assert.equal(cuerpo.busqueda?.resultadosRecibidos, 4);
    assert.equal(cuerpo.busqueda?.hotelesConPrecio, 3);
  });

  test("filtra por radio en el backend con la distancia sin redondear", async () => {
    devolverHoteles([
      { token: "tok-dentro", lat: 14.62, lng: -90.51 },
      { token: "tok-fuera", lat: 14.7, lng: -90.51 },
    ]);
    const { cuerpo } = await enviar(solicitud({ radio: 2000 }));
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["tok-dentro"]);
    assert.equal(cuerpo.busqueda?.hotelesEnRadio, 1);
    assert.equal(cuerpo.busqueda?.radioMetros, 2000);
  });

  test("calcula el centro y las distancias junto al antimeridiano", async () => {
    devolverHoteles([
      { token: "tok-oeste", lat: 0, lng: -179.97 },
      { token: "tok-este", lat: 0, lng: 179.99 },
    ]);
    const { cuerpo } = await enviar(solicitud({ paradas: [{ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }] }));
    assert.ok(cuerpo.centro);
    assert.equal(Math.abs(cuerpo.centro.lng), 180);
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["tok-este", "tok-oeste"]);
  });

  test("acepta coordenadas cero", async () => {
    devolverHoteles([{ token: "tok-cero", lat: 0.001, lng: 0 }]);
    const { estado, cuerpo } = await enviar(solicitud({ paradas: [{ lat: 0, lng: 0 }] }));
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.centro, { lat: 0, lng: 0 });
    assert.equal(cuerpo.hoteles[0].distanciaLineaRectaMetros, 111);
  });

  test("con Q500 admite un hotel convertido a Q200.00 y con Q499.99 lo excluye por un centavo", async () => {
    usarTasa(8);
    devolverHoteles([{ token: "tok-200", lat: 14.61, lng: -90.51, usd: 25 }]);
    const igual = await enviar(solicitud({ presupuestoDiario: 500 }));
    assert.deepEqual(igual.cuerpo.hoteles.map((h) => [h.idExterno, h.tarifa.importeCentavos]), [["tok-200", 20000]]);

    const encima = await enviar(solicitud({ presupuestoDiario: 499.99 }));
    assert.equal(encima.cuerpo.presupuestoHospedajeCentavos, 19999);
    assert.deepEqual(encima.cuerpo.hoteles, []);
    assert.equal(encima.cuerpo.motivo, "sin_hoteles_en_presupuesto");
    assert.ok(encima.cuerpo.tipoCambio);
  });

  test("compara el mismo importe convertido que devuelve, sin redondear la tasa", async () => {
    usarTasa(8.0004);
    devolverHoteles([{ token: "tok-limite", lat: 14.61, lng: -90.51, usd: 25 }]);
    const { cuerpo } = await enviar(solicitud());
    assert.equal(cuerpo.tipoCambio?.tasa, 8.0004);
    assert.deepEqual(cuerpo.hoteles, []);
    assert.equal(cuerpo.motivo, "sin_hoteles_en_presupuesto");
  });

  test("aplica el límite después de filtrar por radio y presupuesto y de ordenar", async () => {
    devolverHoteles([
      { token: "tok-5", lat: 14.65, lng: -90.51 },
      { token: "tok-caro", lat: 14.6101, lng: -90.51, usd: 30 },
      { token: "tok-fuera", lat: 14.9, lng: -90.51 },
      { token: "tok-4", lat: 14.64, lng: -90.51 },
      { token: "tok-3", lat: 14.63, lng: -90.51 },
    ]);
    const { cuerpo } = await enviar(solicitud({ limite: 2, radio: 8000 }));
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["tok-3", "tok-4"]);
  });

  test("aplica el límite predeterminado de 10 recomendaciones", async () => {
    const tokens = Array.from({ length: 12 }, (_, i) => `tok-${String(i).padStart(2, "0")}`);
    devolverHoteles(tokens.map((token, i) => ({ token, lat: 14.61 + i * 0.001, lng: -90.51 })));
    const { cuerpo } = await enviar(solicitud());
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), tokens.slice(0, 10));
  });

  test("consulta con la ocupación indicada como adultos y sin niños", async () => {
    devolverHoteles([{ token: "tok-uno", lat: 14.61, lng: -90.51 }]);
    const { cuerpo } = await enviar(solicitud({ ocupacion: 3 }));
    assert.equal(llamadasA("serpapi.com")[0].searchParams.get("adults"), "3");
    assert.equal(llamadasA("serpapi.com")[0].searchParams.get("children"), "0");
    assert.deepEqual(cuerpo.estancia, { entrada: "2026-10-14", salida: "2026-10-15", noches: 1, adultos: 3, ninos: 0 });
    assert.equal(cuerpo.ocupacion, 3);
  });

  test("calcula la salida al día siguiente también en fin de año y en año bisiesto", async () => {
    devolverHoteles([{ token: "tok-uno", lat: 14.61, lng: -90.51 }]);
    await enviar(solicitud({ fecha: "2026-12-31" }));
    await enviar(solicitud({ fecha: "2028-02-28" }));
    await enviar(solicitud({ fecha: "2028-02-29" }));
    assert.deepEqual(
      llamadasA("serpapi.com").map((u) => [u.searchParams.get("check_in_date"), u.searchParams.get("check_out_date")]),
      [
        ["2026-12-31", "2027-01-01"],
        ["2028-02-28", "2028-02-29"],
        ["2028-02-29", "2028-03-01"],
      ],
    );
  });

  test("excluye alquileres vacacionales, anuncios y hoteles incompletos", async () => {
    serpapi = () =>
      respuestaJson({
        search_metadata: { status: "Success" },
        ads: [{ name: "Anuncio", property_token: "tok-anuncio", gps_coordinates: { latitude: 14.61, longitude: -90.51 }, extracted_price: 5 }],
        properties: [
          propiedad({ token: "tok-valido", lat: 14.63, lng: -90.51 }),
          propiedad({ token: "tok-alquiler", lat: 14.61, lng: -90.51, tipo: "vacation rental" }),
          { ...propiedad({ token: "tok-sin-precio", lat: 14.61, lng: -90.51 }), total_rate: undefined, rate_per_night: { lowest: "$5" } },
          { ...propiedad({ token: "tok-sin-coordenadas", lat: 14.61, lng: -90.51 }), gps_coordinates: undefined },
          { ...propiedad({ token: "tok-sin-nombre", lat: 14.61, lng: -90.51 }), name: "" },
          { ...propiedad({ token: "", lat: 14.61, lng: -90.51 }) },
        ],
      });
    const { cuerpo } = await enviar(solicitud());
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["tok-valido"]);
    assert.equal(cuerpo.busqueda?.resultadosRecibidos, 6);
    assert.equal(cuerpo.busqueda?.hotelesConPrecio, 1);
  });

  test("ignora campos no admitidos como un porcentaje enviado por el cliente", async () => {
    devolverHoteles([{ token: "tok-uno", lat: 14.61, lng: -90.51 }]);
    const { cuerpo } = await enviar(solicitud({ porcentajeHospedaje: 100, centro: { lat: 0, lng: 0 } }));
    assert.equal(cuerpo.porcentajeHospedaje, 40);
    assert.equal(cuerpo.presupuestoHospedajeCentavos, 20000);
    assert.ok(cuerpo.centro && Math.abs(cuerpo.centro.lat - 14.61) < 1e-3);
  });

  test("no consulta Geoapify ni requiere su clave ni un catálogo local", async () => {
    devolverHoteles([{ token: "tok-uno", lat: 14.61, lng: -90.51 }]);
    const { estado } = await enviar(solicitud());
    assert.equal(estado, 200);
    assert.ok(llamadas.every((url) => url.hostname === "serpapi.com" || url.hostname === "v6.exchangerate-api.com"));
    assert.equal(llamadas.some((url) => url.hostname.includes("geoapify")), false);
  });
});

describe("POST /api/hoteles/recomendaciones - respuestas vacías y salidas tempranas", () => {
  test("hospedaje: true devuelve vacío sin llamadas externas", async () => {
    const { estado, cuerpo } = await enviar(solicitud({ hospedaje: true }));
    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "hospedaje_reservado");
    assert.deepEqual(cuerpo.hoteles, []);
    assert.equal(cuerpo.centro, null);
    assert.equal(cuerpo.busqueda, null);
    assert.equal(cuerpo.tipoCambio, null);
    assert.equal(cuerpo.presupuestoHospedajeCentavos, 20000);
    assert.deepEqual(cuerpo.estancia, { entrada: "2026-10-14", salida: "2026-10-15", noches: 1, adultos: 2, ninos: 0 });
    assert.equal(llamadas.length, 0);
  });

  test("sinHotel: true devuelve vacío sin llamadas externas y hospedaje prevalece si ambos son verdaderos", async () => {
    const sinHotel = await enviar(solicitud({ sinHotel: true }));
    assert.equal(sinHotel.cuerpo.motivo, "no_necesita_hotel");
    const ambos = await enviar(solicitud({ hospedaje: true, sinHotel: true }));
    assert.equal(ambos.cuerpo.motivo, "hospedaje_reservado");
    assert.equal(llamadas.length, 0);
  });

  test("un itinerario sin paradas devuelve vacío con centro null sin llamadas externas", async () => {
    const { cuerpo } = await enviar(solicitud({ paradas: [] }));
    assert.equal(cuerpo.motivo, "itinerario_sin_paradas");
    assert.equal(cuerpo.centro, null);
    assert.equal(llamadas.length, 0);
  });

  test("las salidas tempranas responden 200 aunque falten las claves de los proveedores", async () => {
    const url = await iniciar({ serpApiKey: "", exchangeRateApiKey: "" });
    for (const cambios of [{ hospedaje: true }, { sinHotel: true }, { paradas: [] }]) {
      const { estado } = await enviarA<RespuestaRecomendacionesHoteles>(url, solicitud(cambios));
      assert.equal(estado, 200);
    }
    assert.equal(llamadas.length, 0);
  });

  test("una búsqueda legítima sin resultados responde vacío sin consultar el tipo de cambio", async () => {
    serpapi = () => respuestaJson({ search_metadata: { status: "Success" }, error: "Google Hotels hasn't returned any results for this query." });
    const { estado, cuerpo } = await enviar(solicitud());
    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "sin_hoteles_encontrados");
    assert.equal(cuerpo.busqueda?.resultadosRecibidos, 0);
    assert.equal(cuerpo.tipoCambio, null);
    assert.equal(llamadasA("v6.exchangerate-api.com").length, 0);
  });

  test("sin hoteles con precio utilizable responde vacío sin consultar el tipo de cambio", async () => {
    devolverHoteles([{ token: "tok-alquiler", lat: 14.61, lng: -90.51, tipo: "vacation rental" }]);
    const { cuerpo } = await enviar(solicitud());
    assert.equal(cuerpo.motivo, "sin_hoteles_con_precio");
    assert.equal(llamadasA("v6.exchangerate-api.com").length, 0);
  });

  test("sin hoteles dentro del radio responde vacío sin consultar el tipo de cambio", async () => {
    devolverHoteles([{ token: "tok-lejos", lat: 15.5, lng: -90.51 }]);
    const { cuerpo } = await enviar(solicitud());
    assert.equal(cuerpo.motivo, "sin_hoteles_en_radio");
    assert.equal(cuerpo.tipoCambio, null);
    assert.equal(llamadasA("v6.exchangerate-api.com").length, 0);
  });
});

describe("POST /api/hoteles/recomendaciones - cachés", () => {
  test("reutiliza la búsqueda y la tasa, conserva la fecha original y reaplica radio y presupuesto", async () => {
    devolverHoteles([
      { token: "tok-cerca", lat: 14.611, lng: -90.51, usd: 24 },
      { token: "tok-lejos", lat: 14.65, lng: -90.51, usd: 20 },
    ]);
    const primera = await enviar(solicitud());
    instante += 5 * 60 * 1000;
    const segunda = await enviar(solicitud({ radio: 1000, presupuestoDiario: 450 }));

    assert.deepEqual(primera.cuerpo.hoteles.map((h) => h.idExterno), ["tok-cerca", "tok-lejos"]);
    assert.deepEqual(segunda.cuerpo.hoteles, []);
    assert.equal(segunda.cuerpo.motivo, "sin_hoteles_en_presupuesto");
    assert.equal(segunda.cuerpo.busqueda?.desdeCache, true);
    assert.equal(segunda.cuerpo.busqueda?.consultadoEn, "2026-10-10T18:00:00.000Z");
    assert.equal(segunda.cuerpo.tipoCambio?.consultadoEn, "2026-10-10T18:00:00.000Z");
    assert.equal(llamadasA("serpapi.com").length, 1);
    assert.equal(llamadasA("v6.exchangerate-api.com").length, 1);
  });

  test("separa las búsquedas por destino, fecha y ocupación y expira a los 15 minutos", async () => {
    devolverHoteles([{ token: "tok-uno", lat: 14.61, lng: -90.51 }]);
    await enviar(solicitud());
    await enviar(solicitud({ destino: "Otra ciudad" }));
    await enviar(solicitud({ fecha: "2026-10-15" }));
    await enviar(solicitud({ ocupacion: 1 }));
    await enviar(solicitud({ destino: "  Ciudad   de prueba " }));
    assert.equal(llamadasA("serpapi.com").length, 4);
    instante += TTL_CACHE_BUSQUEDAS_MS;
    await enviar(solicitud());
    assert.equal(llamadasA("serpapi.com").length, 5);
  });
});

describe("POST /api/hoteles/recomendaciones - solicitudes inválidas", () => {
  const muchasParadas = Array.from({ length: 26 }, () => ({ lat: 14.6, lng: -90.5 }));
  const casos: [string, unknown, string][] = [
    ["sin fecha", solicitud({ fecha: undefined }), "fecha"],
    ["fecha irreal", solicitud({ fecha: "2026-02-30" }), "fecha"],
    ["29 de febrero no bisiesto", solicitud({ fecha: "2027-02-29" }), "fecha"],
    ["fecha con otro formato", solicitud({ fecha: "14/10/2026" }), "fecha"],
    ["fecha con hora", solicitud({ fecha: "2026-10-14T00:00:00Z" }), "fecha"],
    ["fecha pasada", solicitud({ fecha: "2026-10-08" }), "fecha"],
    ["fecha sin día siguiente", solicitud({ fecha: "9999-12-31" }), "fecha"],
    ["sin destino", solicitud({ destino: undefined }), "destino"],
    ["destino no texto", solicitud({ destino: 14 }), "destino"],
    ["destino vacío", solicitud({ destino: "   " }), "destino"],
    ["destino de un carácter", solicitud({ destino: "A" }), "destino"],
    ["destino demasiado largo", solicitud({ destino: "x".repeat(101) }), "destino"],
    ["destino con caracteres de control", solicitud({ destino: "Antigua\u0000" }), "destino"],
    ["sin paradas", solicitud({ paradas: undefined }), "paradas"],
    ["paradas no lista", solicitud({ paradas: { lat: 1, lng: 1 } }), "paradas"],
    ["latitud fuera de rango", solicitud({ paradas: [{ lat: 91, lng: 0 }] }), "paradas.0.lat"],
    ["longitud fuera de rango", solicitud({ paradas: [{ lat: 0, lng: -180.5 }] }), "paradas.0.lng"],
    ["coordenada como texto", solicitud({ paradas: [{ lat: "14.6", lng: -90.5 }] }), "paradas.0.lat"],
    ["coordenada ausente", solicitud({ paradas: [{ lat: 14.6 }] }), "paradas.0.lng"],
    ["parada nula", solicitud({ paradas: [null] }), "paradas.0"],
    ["demasiadas paradas", solicitud({ paradas: muchasParadas }), "paradas"],
    ["paradas antípodas", solicitud({ paradas: [{ lat: 0, lng: 0 }, { lat: 0, lng: 180 }] }), "paradas"],
    ["sin presupuesto", solicitud({ presupuestoDiario: undefined }), "presupuestoDiario"],
    ["presupuesto cero", solicitud({ presupuestoDiario: 0 }), "presupuestoDiario"],
    ["presupuesto negativo", solicitud({ presupuestoDiario: -10 }), "presupuestoDiario"],
    ["presupuesto con tres decimales", solicitud({ presupuestoDiario: 500.001 }), "presupuestoDiario"],
    ["presupuesto como texto", solicitud({ presupuestoDiario: "500" }), "presupuestoDiario"],
    ["presupuesto excesivo", solicitud({ presupuestoDiario: 1_000_000.01 }), "presupuestoDiario"],
    ["presupuesto no finito", JSON.stringify(solicitud({ presupuestoDiario: 0 })).replace('"presupuestoDiario":0', '"presupuestoDiario":1e999'), "presupuestoDiario"],
    ["otra moneda", solicitud({ moneda: "USD" }), "moneda"],
    ["sin moneda", solicitud({ moneda: undefined }), "moneda"],
    ["sin ocupación", solicitud({ ocupacion: undefined }), "ocupacion"],
    ["ocupación cero", solicitud({ ocupacion: 0 }), "ocupacion"],
    ["ocupación decimal", solicitud({ ocupacion: 1.5 }), "ocupacion"],
    ["ocupación excesiva", solicitud({ ocupacion: 11 }), "ocupacion"],
    ["sin hospedaje", solicitud({ hospedaje: undefined }), "hospedaje"],
    ["hospedaje como texto", solicitud({ hospedaje: "false" }), "hospedaje"],
    ["sinHotel no booleano", solicitud({ sinHotel: 1 }), "sinHotel"],
    ["radio cero", solicitud({ radio: 0 }), "radio"],
    ["radio excesivo", solicitud({ radio: 50001 }), "radio"],
    ["radio decimal", solicitud({ radio: 100.5 }), "radio"],
    ["límite cero", solicitud({ limite: 0 }), "limite"],
    ["límite excesivo", solicitud({ limite: 21 }), "limite"],
    ["cuerpo como lista", [solicitud()], "cuerpo"],
  ];

  for (const [nombre, cuerpo, parametro] of casos) {
    test(`responde 400 sin consultar a los proveedores: ${nombre}`, async () => {
      const resultado = await enviar<CuerpoError>(cuerpo);
      verificarError(resultado, 400, "PARAMETRO_INVALIDO");
      assert.ok(resultado.cuerpo.error.detalles?.some((d) => d.parametro === parametro), JSON.stringify(resultado.cuerpo.error.detalles));
      assert.equal(llamadas.length, 0);
    });
  }

  test("acepta la fecha del día anterior en UTC porque aún es hoy en otras zonas horarias", async () => {
    const { estado } = await enviar(solicitud({ fecha: "2026-10-09", hospedaje: true }));
    assert.equal(estado, 200);
  });

  test("valida aunque hospedaje sea verdadero", async () => {
    verificarError(await enviar<CuerpoError>(solicitud({ hospedaje: true, presupuestoDiario: -1 })), 400, "PARAMETRO_INVALIDO");
    verificarError(await enviar<CuerpoError>(solicitud({ hospedaje: true, destino: undefined })), 400, "PARAMETRO_INVALIDO");
  });

  test("rechaza JSON mal formado, cuerpos vacíos y cuerpos de más de 32 KB", async () => {
    verificarError(await enviar<CuerpoError>("{ fecha: "), 400, "PARAMETRO_INVALIDO");
    verificarError(await enviar<CuerpoError>("null"), 400, "PARAMETRO_INVALIDO");
    verificarError(await enviar<CuerpoError>(JSON.stringify({ ...solicitud(), relleno: "x".repeat(33 * 1024) })), 400, "PARAMETRO_INVALIDO");
    assert.equal(llamadas.length, 0);
  });

  test("solo admite POST", async () => {
    const respuesta = await fetch(`${baseUrl}${RUTA}`);
    assert.equal(respuesta.status, 404);
  });
});

describe("POST /api/hoteles/recomendaciones - configuración y errores de proveedores", () => {
  test("sin clave de SerpApi responde 503 SERVICIO_NO_CONFIGURADO sin llamadas externas", async () => {
    const url = await iniciar({ serpApiKey: "" });
    verificarError(await enviarA<CuerpoError>(url, solicitud()), 503, "SERVICIO_NO_CONFIGURADO");
    assert.equal(llamadas.length, 0);
  });

  test("sin clave de ExchangeRate-API responde 503 sin gastar una búsqueda de SerpApi", async () => {
    const url = await iniciar({ exchangeRateApiKey: "" });
    devolverHoteles([{ token: "tok-uno", lat: 14.61, lng: -90.51 }]);
    verificarError(await enviarA<CuerpoError>(url, solicitud()), 503, "SERVICIO_NO_CONFIGURADO");
    assert.equal(llamadas.length, 0);
  });

  const erroresSerpApi: [string, Simulador, number, string][] = [
    ["credenciales rechazadas", () => respuestaJson({ error: `Invalid API key ${CLAVE_SERP}` }, 401), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
    ["acceso prohibido", () => respuestaJson({}, 403), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
    ["cuota agotada", () => respuestaJson({ error: "Your account has run out of searches." }, 429), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
    ["cuota agotada dentro de un 200", () => respuestaJson({ error: "Your account has run out of searches." }), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
    ["error del proveedor", () => respuestaJson({ search_metadata: { status: "Error" }, error: "We couldn't get valid results." }, 503), 502, "PROVEEDOR_ERROR"],
    [
      "fallo de red",
      () => {
        throw new TypeError("fetch failed");
      },
      502,
      "PROVEEDOR_NO_DISPONIBLE",
    ],
    ["respuesta no JSON", () => new Response("<html>", { status: 200 }), 502, "PROVEEDOR_RESPUESTA_INVALIDA"],
    ["estructura inesperada", () => respuestaJson({ resultados: [] }), 502, "PROVEEDOR_RESPUESTA_INVALIDA"],
    [
      "tiempo agotado",
      (_url, opciones) =>
        new Promise<Response>((_, rechazar) => {
          opciones?.signal?.addEventListener("abort", () => rechazar(new Error("abortado")));
        }),
      504,
      "PROVEEDOR_TIEMPO_AGOTADO",
    ],
  ];

  for (const [nombre, simular, estado, codigo] of erroresSerpApi) {
    test(`traduce el error de SerpApi: ${nombre}`, async () => {
      serpapi = simular;
      const resultado = await enviar<CuerpoError>(solicitud());
      verificarError(resultado, estado, codigo);
      assert.match(resultado.cuerpo.error.mensaje, /SerpApi/);
      assert.equal((resultado.cuerpo as unknown as Record<string, unknown>).hoteles, undefined);
      assert.equal(llamadasA("v6.exchangerate-api.com").length, 0);
    });
  }

  const erroresTasa: [string, Simulador, number, string][] = [
    ["clave inválida", () => respuestaJson({ result: "error", "error-type": "invalid-key" }, 403), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
    ["cuenta inactiva", () => respuestaJson({ result: "error", "error-type": "inactive-account" }), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
    ["cuota agotada", () => respuestaJson({ result: "error", "error-type": "quota-reached" }), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
    ["límite HTTP", () => new Response("", { status: 429 }), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
    ["error del proveedor", () => new Response("", { status: 500 }), 502, "PROVEEDOR_ERROR"],
    ["formato de la modalidad abierta", () => respuestaJson({ result: "success", base_code: "USD", rates: { GTQ: 7.65 } }), 502, "PROVEEDOR_RESPUESTA_INVALIDA"],
    [
      "tasa vencida",
      () =>
        respuestaJson({
          result: "success",
          base_code: "USD",
          time_last_update_unix: ULTIMA_ACTUALIZACION - 3 * 86400,
          time_next_update_unix: ULTIMA_ACTUALIZACION - 2 * 86400,
          conversion_rates: { GTQ: 7.65 },
        }),
      502,
      "PROVEEDOR_RESPUESTA_INVALIDA",
    ],
    [
      "tiempo agotado",
      (_url, opciones) =>
        new Promise<Response>((_, rechazar) => {
          opciones?.signal?.addEventListener("abort", () => rechazar(new Error("abortado")));
        }),
      504,
      "PROVEEDOR_TIEMPO_AGOTADO",
    ],
  ];

  for (const [nombre, simular, estado, codigo] of erroresTasa) {
    test(`traduce el error de ExchangeRate-API sin usar una tasa fija: ${nombre}`, async () => {
      devolverHoteles([{ token: "tok-uno", lat: 14.61, lng: -90.51 }]);
      exchangeRate = simular;
      const resultado = await enviar<CuerpoError>(solicitud());
      verificarError(resultado, estado, codigo);
      assert.match(resultado.cuerpo.error.mensaje, /ExchangeRate-API/);
      assert.equal(llamadasA("serpapi.com").length, 1);
    });
  }

  test("una tasa vencida en caché no se usa si la actualización falla", async () => {
    devolverHoteles([{ token: "tok-uno", lat: 14.61, lng: -90.51 }]);
    assert.equal((await enviar(solicitud())).estado, 200);
    instante = (ULTIMA_ACTUALIZACION + 86400) * 1000;
    exchangeRate = () => respuestaJson({ result: "error", "error-type": "quota-reached" });
    verificarError(await enviar<CuerpoError>(solicitud({ destino: "Otra ciudad" })), 503, "PROVEEDOR_LIMITE_SOLICITUDES");
  });
});
