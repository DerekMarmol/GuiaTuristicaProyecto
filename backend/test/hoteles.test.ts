import { test, describe, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { RespuestaRecomendacionesHoteles } from "../../shared/types";
import { crearApp } from "../src/app";
import type { TarifaHotel } from "../src/hoteles/catalogo";

interface CuerpoError {
  error: { codigo: string; mensaje: string; detalles?: { parametro: string; mensaje: string }[] };
}

interface Resultado<T> {
  estado: number;
  texto: string;
  cuerpo: T;
}

interface HotelSimulado {
  id: string;
  lat: number;
  lon: number;
  nombre?: string;
  direccion?: string;
}

type Simulador = (url: URL, opciones: RequestInit | undefined) => Response | Promise<Response>;

const CLAVE = "clave-de-prueba-no-real-hoteles";
const RUTA = "/api/hoteles/recomendaciones";
const PARADAS = [
  { lat: 14.6, lng: -90.5 },
  { lat: 14.62, lng: -90.52 },
];

let simulador: Simulador;
let llamadas: URL[] = [];
let lecturasCatalogo = 0;
let catalogo: unknown = { tarifas: [] };
let servidor: Server;
let baseUrl: string;

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

function coleccionHoteles(hoteles: HotelSimulado[]) {
  return {
    type: "FeatureCollection",
    features: hoteles.map(({ id, lat, lon, nombre, direccion }) => ({
      type: "Feature",
      properties: {
        place_id: id,
        name: nombre ?? `Hotel ${id}`,
        ...(direccion ? { formatted: direccion } : {}),
        lat,
        lon,
        categories: ["accommodation", "accommodation.hotel"],
      },
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  };
}

function devolverHoteles(hoteles: HotelSimulado[]): void {
  simulador = () => respuestaJson(coleccionHoteles(hoteles));
}

function tarifa(idExterno: string, cambios: Partial<TarifaHotel> = {}): TarifaHotel {
  return {
    id: `tarifa-${idExterno}`,
    idExterno,
    importeCentavos: 15000,
    moneda: "GTQ",
    unidad: "habitacion_noche",
    ocupacion: 2,
    importeTotal: true,
    impuestosIncluidos: true,
    vigenciaDesde: "2026-10-01",
    vigenciaHasta: "2026-10-31",
    verificadoEn: "2026-09-30",
    fuente: { tipo: "cotizacion", referencia: `Cotización ficticia ${idExterno}` },
    ...cambios,
  };
}

function usarTarifas(...tarifas: TarifaHotel[]): void {
  catalogo = { tarifas };
}

function solicitud(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fecha: "2026-10-14",
    paradas: PARADAS,
    presupuestoDiario: 500,
    moneda: "GTQ",
    ocupacion: 2,
    hospedaje: false,
    ...cambios,
  };
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

function verificarError(resultado: Resultado<CuerpoError>, estado: number, codigo: string): void {
  assert.equal(resultado.estado, estado);
  assert.equal(resultado.cuerpo.error.codigo, codigo);
  assert.equal(typeof resultado.cuerpo.error.mensaje, "string");
  assert.ok(!resultado.texto.includes(CLAVE));
  assert.ok(!resultado.texto.includes("apiKey"));
}

function filtroDe(url: URL): { lng: number; lat: number; radio: number } {
  const coincidencia = /^circle:(-?[\d.]+),(-?[\d.]+),(\d+)$/.exec(url.searchParams.get("filter") ?? "");
  assert.ok(coincidencia, "la consulta debe usar un filtro circular");
  return { lng: Number(coincidencia[1]), lat: Number(coincidencia[2]), radio: Number(coincidencia[3]) };
}

async function iniciar(app: ReturnType<typeof crearApp>): Promise<{ instancia: Server; url: string }> {
  const instancia = app.listen(0, "127.0.0.1");
  await once(instancia, "listening");
  return { instancia, url: `http://127.0.0.1:${(instancia.address() as AddressInfo).port}` };
}

before(async () => {
  const app = crearApp({
    apiKey: CLAVE,
    tiempoEsperaMs: 50,
    fetch: async (url, opciones) => {
      const direccion = new URL(url);
      llamadas.push(direccion);
      return simulador(direccion, opciones);
    },
    hoteles: {
      leerCatalogo: async () => {
        lecturasCatalogo++;
        return catalogo;
      },
    },
  });
  ({ instancia: servidor, url: baseUrl } = await iniciar(app));
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

beforeEach(() => {
  llamadas = [];
  lecturasCatalogo = 0;
  catalogo = { tarifas: [] };
  devolverHoteles([]);
  mock.method(console, "error", () => {});
});

afterEach(() => {
  mock.restoreAll();
});

describe("POST /api/hoteles/recomendaciones - recomendaciones", () => {
  test("ordena por cercanía al centro del día aunque Geoapify entregue otro orden", async () => {
    usarTarifas(tarifa("geo-lejano"), tarifa("geo-cercano"), tarifa("geo-medio"));
    devolverHoteles([
      { id: "geo-lejano", lat: 14.66, lon: -90.51, direccion: "Zona lejana" },
      { id: "geo-cercano", lat: 14.611, lon: -90.51 },
      { id: "geo-medio", lat: 14.63, lon: -90.51 },
    ]);

    const { estado, cuerpo } = await enviar(solicitud());

    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["geo-cercano", "geo-medio", "geo-lejano"]);
    const distancias = cuerpo.hoteles.map((h) => h.distanciaLineaRectaMetros);
    assert.deepEqual(distancias, [...distancias].sort((a, b) => a - b));
    assert.equal(cuerpo.motivo, null);
    assert.equal(cuerpo.mensaje, null);
    assert.equal(cuerpo.metodoDistancia, "linea_recta");
    assert.deepEqual(cuerpo.busqueda, { categoria: "accommodation.hotel", radioMetros: 5000, maxCandidatos: 100, candidatosEncontrados: 3 });

    assert.equal(llamadas.length, 1);
    const consulta = llamadas[0];
    assert.equal(consulta.pathname, "/v2/places");
    assert.equal(consulta.searchParams.get("categories"), "accommodation.hotel");
    assert.equal(consulta.searchParams.get("limit"), "100");
    const filtro = filtroDe(consulta);
    assert.ok(Math.abs(filtro.lat - 14.61) < 1e-4);
    assert.ok(Math.abs(filtro.lng + 90.51) < 1e-4);
    assert.equal(filtro.radio, 5000);
  });

  test("devuelve el contrato completo de cada hotel y de la respuesta", async () => {
    usarTarifas(tarifa("geo-uno", { importeCentavos: 19999, fuente: { tipo: "url", referencia: "https://ejemplo.invalid/tarifa" } }));
    devolverHoteles([{ id: "geo-uno", lat: 14.61, lon: -90.51, nombre: "Hotel Uno", direccion: "Calle ficticia 1" }]);

    const { cuerpo } = await enviar(solicitud({ presupuestoDiario: 500.5 }));

    assert.equal(cuerpo.fecha, "2026-10-14");
    assert.equal(cuerpo.moneda, "GTQ");
    assert.equal(cuerpo.ocupacion, 2);
    assert.equal(cuerpo.presupuestoDiario, 500.5);
    assert.equal(cuerpo.presupuestoDiarioCentavos, 50050);
    assert.equal(cuerpo.porcentajeHospedaje, 40);
    assert.equal(cuerpo.presupuestoHospedaje, 200.2);
    assert.equal(cuerpo.presupuestoHospedajeCentavos, 20020);
    assert.ok(cuerpo.centro);
    assert.deepEqual(cuerpo.hoteles, [
      {
        idExterno: "geo-uno",
        proveedor: "geoapify",
        nombre: "Hotel Uno",
        direccion: "Calle ficticia 1",
        lat: 14.61,
        lng: -90.51,
        distanciaLineaRectaMetros: cuerpo.hoteles[0].distanciaLineaRectaMetros,
        tarifa: {
          id: "tarifa-geo-uno",
          importe: 199.99,
          importeCentavos: 19999,
          moneda: "GTQ",
          unidad: "habitacion_noche",
          ocupacion: 2,
          impuestosIncluidos: true,
          vigencia: { desde: "2026-10-01", hasta: "2026-10-31" },
          verificadoEn: "2026-09-30",
          fuente: { tipo: "url", referencia: "https://ejemplo.invalid/tarifa" },
        },
      },
    ]);
    assert.ok(Number.isInteger(cuerpo.hoteles[0].distanciaLineaRectaMetros));
  });

  test("calcula el centro solo con las paradas recibidas e ignora otros campos", async () => {
    usarTarifas(tarifa("geo-uno"));
    devolverHoteles([{ id: "geo-uno", lat: 14.61, lon: -90.51 }]);

    const { cuerpo } = await enviar(
      solicitud({
        centro: { lat: 0, lng: 0 },
        destino: { lat: 40, lng: 3 },
        porcentajeHospedaje: 100,
        paradas: PARADAS.map((p, i) => ({ ...p, placeId: `p${i}`, nombre: "Parada" })),
      }),
    );

    assert.ok(cuerpo.centro);
    assert.ok(Math.abs(cuerpo.centro.lat - 14.61) < 1e-3);
    assert.ok(Math.abs(cuerpo.centro.lng + 90.51) < 1e-3);
    assert.equal(cuerpo.porcentajeHospedaje, 40);
    assert.equal(cuerpo.presupuestoHospedajeCentavos, 20000);
    const filtro = filtroDe(llamadas[0]);
    assert.ok(Math.abs(filtro.lat - cuerpo.centro.lat) < 1e-6);
    assert.ok(Math.abs(filtro.lng - cuerpo.centro.lng) < 1e-6);
  });

  test("resuelve empates de distancia por idExterno de forma estable", async () => {
    usarTarifas(tarifa("geo-b"), tarifa("geo-a"), tarifa("geo-c"));
    devolverHoteles([
      { id: "geo-c", lat: 14.612, lon: -90.51 },
      { id: "geo-b", lat: 14.611, lon: -90.51 },
      { id: "geo-a", lat: 14.611, lon: -90.51 },
    ]);

    const primera = await enviar(solicitud());
    devolverHoteles([
      { id: "geo-a", lat: 14.611, lon: -90.51 },
      { id: "geo-c", lat: 14.612, lon: -90.51 },
      { id: "geo-b", lat: 14.611, lon: -90.51 },
    ]);
    const segunda = await enviar(solicitud());

    assert.deepEqual(primera.cuerpo.hoteles.map((h) => h.idExterno), ["geo-a", "geo-b", "geo-c"]);
    assert.deepEqual(segunda.cuerpo.hoteles.map((h) => h.idExterno), ["geo-a", "geo-b", "geo-c"]);
  });

  test("acepta coordenadas cero y consulta alrededor de (0, 0)", async () => {
    usarTarifas(tarifa("geo-cero"));
    devolverHoteles([{ id: "geo-cero", lat: 0.001, lon: 0 }]);

    const { estado, cuerpo } = await enviar(solicitud({ paradas: [{ lat: 0, lng: 0 }] }));

    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.centro, { lat: 0, lng: 0 });
    assert.equal(llamadas[0].searchParams.get("filter"), "circle:0,0,5000");
    assert.equal(cuerpo.hoteles[0].distanciaLineaRectaMetros, 111);
  });

  test("calcula el centro y las distancias correctamente junto al antimeridiano", async () => {
    usarTarifas(tarifa("geo-este"), tarifa("geo-oeste"));
    devolverHoteles([
      { id: "geo-oeste", lat: 0, lon: -179.95 },
      { id: "geo-este", lat: 0, lon: 179.99 },
    ]);

    const { cuerpo } = await enviar(solicitud({ paradas: [{ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }] }));

    assert.ok(cuerpo.centro);
    assert.equal(Math.abs(cuerpo.centro.lng), 180);
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["geo-este", "geo-oeste"]);
    assert.ok(cuerpo.hoteles[0].distanciaLineaRectaMetros < 1200);
    assert.ok(cuerpo.hoteles[1].distanciaLineaRectaMetros < 6000);
  });

  test("con presupuesto diario de Q500 admite una tarifa de Q200 y excluye una de Q200.01", async () => {
    usarTarifas(tarifa("geo-200", { importeCentavos: 20000 }), tarifa("geo-200-01", { importeCentavos: 20001 }));
    devolverHoteles([
      { id: "geo-200-01", lat: 14.6105, lon: -90.51 },
      { id: "geo-200", lat: 14.62, lon: -90.51 },
    ]);

    const { cuerpo } = await enviar(solicitud({ presupuestoDiario: 500 }));

    assert.equal(cuerpo.presupuestoHospedaje, 200);
    assert.equal(cuerpo.presupuestoHospedajeCentavos, 20000);
    assert.deepEqual(cuerpo.hoteles.map((h) => [h.idExterno, h.tarifa.importe]), [["geo-200", 200]]);
  });

  test("redondea hacia abajo la fracción de centavo para no superar el 40 %", async () => {
    usarTarifas(tarifa("geo-200", { importeCentavos: 20000 }), tarifa("geo-200-01", { importeCentavos: 20001 }));
    devolverHoteles([
      { id: "geo-200-01", lat: 14.6105, lon: -90.51 },
      { id: "geo-200", lat: 14.62, lon: -90.51 },
    ]);

    const { cuerpo } = await enviar(solicitud({ presupuestoDiario: 500.02 }));

    assert.equal(cuerpo.presupuestoHospedajeCentavos, 20000);
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["geo-200"]);
  });

  test("excluye hoteles sin tarifa o con tarifas no aplicables", async () => {
    usarTarifas(
      tarifa("geo-valido"),
      tarifa("geo-vencido", { vigenciaHasta: "2026-10-13" }),
      tarifa("geo-futuro", { vigenciaDesde: "2026-10-15" }),
      tarifa("geo-usd", { moneda: "USD", importeCentavos: 1000 }),
      tarifa("geo-ocupacion", { ocupacion: 3 }),
      tarifa("geo-impuestos", { impuestosIncluidos: null }),
      tarifa("geo-sin-impuestos", { impuestosIncluidos: false }),
      tarifa("geo-desde", { importeTotal: false }),
    );
    const ids = ["geo-sin-tarifa", "geo-vencido", "geo-futuro", "geo-usd", "geo-ocupacion", "geo-impuestos", "geo-sin-impuestos", "geo-desde"];
    devolverHoteles([...ids.map((id) => ({ id, lat: 14.6101, lon: -90.51 })), { id: "geo-valido", lat: 14.64, lon: -90.51 }]);

    const { cuerpo } = await enviar(solicitud());

    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["geo-valido"]);
  });

  test("elige de forma determinista la tarifa más económica aplicable de cada hotel", async () => {
    usarTarifas(
      tarifa("geo-uno", { id: "t-cara", importeCentavos: 18000 }),
      tarifa("geo-uno", { id: "t-z", importeCentavos: 12000 }),
      tarifa("geo-uno", { id: "t-m", importeCentavos: 12000 }),
      tarifa("geo-uno", { id: "t-barata-otra-ocupacion", importeCentavos: 5000, ocupacion: 1 }),
    );
    devolverHoteles([{ id: "geo-uno", lat: 14.61, lon: -90.51 }]);

    const { cuerpo } = await enviar(solicitud());

    assert.equal(cuerpo.hoteles[0].tarifa.id, "t-m");
    assert.equal(cuerpo.hoteles[0].tarifa.importeCentavos, 12000);
  });

  test("elimina hoteles duplicados entregados por el proveedor", async () => {
    usarTarifas(tarifa("geo-uno"), tarifa("geo-dos"));
    devolverHoteles([
      { id: "geo-uno", lat: 14.61, lon: -90.51 },
      { id: "geo-dos", lat: 14.62, lon: -90.51 },
      { id: "geo-uno", lat: 14.61, lon: -90.51 },
    ]);

    const { cuerpo } = await enviar(solicitud());

    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["geo-uno", "geo-dos"]);
    assert.equal(cuerpo.busqueda?.candidatosEncontrados, 2);
  });

  test("aplica el límite después de filtrar y ordenar, y consulta hasta 100 candidatos", async () => {
    usarTarifas(tarifa("geo-3"), tarifa("geo-4"), tarifa("geo-5"), tarifa("geo-caro", { importeCentavos: 50000 }));
    devolverHoteles([
      { id: "geo-5", lat: 14.65, lon: -90.51 },
      { id: "geo-caro", lat: 14.6101, lon: -90.51 },
      { id: "geo-sin-tarifa", lat: 14.6102, lon: -90.51 },
      { id: "geo-4", lat: 14.64, lon: -90.51 },
      { id: "geo-3", lat: 14.63, lon: -90.51 },
    ]);

    const { cuerpo } = await enviar(solicitud({ limite: 2, radio: 8000 }));

    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ["geo-3", "geo-4"]);
    assert.equal(llamadas[0].searchParams.get("limit"), "100");
    assert.equal(filtroDe(llamadas[0]).radio, 8000);
    assert.equal(cuerpo.busqueda?.radioMetros, 8000);
  });

  test("aplica el límite predeterminado de 10 recomendaciones", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `geo-${String(i).padStart(2, "0")}`);
    usarTarifas(...ids.map((id) => tarifa(id)));
    devolverHoteles(ids.map((id, i) => ({ id, lat: 14.61 + i * 0.001, lon: -90.51 })));

    const { cuerpo } = await enviar(solicitud());

    assert.equal(cuerpo.hoteles.length, 10);
    assert.deepEqual(cuerpo.hoteles.map((h) => h.idExterno), ids.slice(0, 10));
  });
});

describe("POST /api/hoteles/recomendaciones - respuestas vacías", () => {
  test("hospedaje: true devuelve vacío sin leer el catálogo ni consultar a Geoapify", async () => {
    usarTarifas(tarifa("geo-uno"));
    const { estado, cuerpo } = await enviar(solicitud({ hospedaje: true }));

    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.hoteles, []);
    assert.equal(cuerpo.motivo, "hospedaje_reservado");
    assert.equal(typeof cuerpo.mensaje, "string");
    assert.equal(cuerpo.centro, null);
    assert.equal(cuerpo.busqueda, null);
    assert.equal(cuerpo.presupuestoHospedajeCentavos, 20000);
    assert.equal(llamadas.length, 0);
    assert.equal(lecturasCatalogo, 0);
  });

  test("sinHotel: true devuelve vacío sin leer el catálogo ni consultar a Geoapify", async () => {
    usarTarifas(tarifa("geo-uno"));
    const { estado, cuerpo } = await enviar(solicitud({ sinHotel: true }));

    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "no_necesita_hotel");
    assert.deepEqual(cuerpo.hoteles, []);
    assert.equal(llamadas.length, 0);
    assert.equal(lecturasCatalogo, 0);
  });

  test("si ambos indicadores son verdaderos prevalece el hospedaje reservado", async () => {
    const { cuerpo } = await enviar(solicitud({ hospedaje: true, sinHotel: true }));

    assert.equal(cuerpo.motivo, "hospedaje_reservado");
    assert.equal(llamadas.length, 0);
  });

  test("hospedaje: true responde 200 aunque el servidor no tenga clave de Geoapify", async () => {
    const { instancia, url } = await iniciar(crearApp({ apiKey: "", hoteles: { leerCatalogo: async () => ({ tarifas: [] }) } }));
    try {
      const { estado, cuerpo } = await enviarA<RespuestaRecomendacionesHoteles>(url, solicitud({ hospedaje: true }));
      assert.equal(estado, 200);
      assert.equal(cuerpo.motivo, "hospedaje_reservado");
    } finally {
      instancia.closeAllConnections();
      instancia.close();
    }
  });

  test("un itinerario sin paradas devuelve vacío con centro null", async () => {
    usarTarifas(tarifa("geo-uno"));
    const { estado, cuerpo } = await enviar(solicitud({ paradas: [] }));

    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "itinerario_sin_paradas");
    assert.equal(cuerpo.centro, null);
    assert.deepEqual(cuerpo.hoteles, []);
    assert.equal(llamadas.length, 0);
    assert.equal(lecturasCatalogo, 0);
  });

  test("un catálogo vacío devuelve una respuesta vacía explícita sin consultar a Geoapify", async () => {
    const { estado, cuerpo } = await enviar(solicitud());

    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "catalogo_vacio");
    assert.deepEqual(cuerpo.hoteles, []);
    assert.ok(cuerpo.centro);
    assert.equal(llamadas.length, 0);
    assert.equal(lecturasCatalogo, 1);
  });

  test("sin tarifas aplicables dentro del presupuesto no consulta a Geoapify", async () => {
    usarTarifas(tarifa("geo-caro", { importeCentavos: 20001 }), tarifa("geo-otra-fecha", { vigenciaDesde: "2026-11-01", vigenciaHasta: "2026-11-30" }));
    const { estado, cuerpo } = await enviar(solicitud());

    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "sin_tarifas_aplicables");
    assert.equal(cuerpo.busqueda, null);
    assert.equal(llamadas.length, 0);
  });

  test("una búsqueda sin resultados devuelve vacío con el motivo correspondiente", async () => {
    usarTarifas(tarifa("geo-uno"));
    devolverHoteles([]);
    const { estado, cuerpo } = await enviar(solicitud());

    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "sin_hoteles_encontrados");
    assert.equal(cuerpo.busqueda?.candidatosEncontrados, 0);
    assert.equal(llamadas.length, 1);
  });

  test("candidatos sin tarifa aplicable devuelven vacío con motivo de hoteles no elegibles", async () => {
    usarTarifas(tarifa("geo-registrado"));
    devolverHoteles([{ id: "geo-otro", lat: 14.61, lon: -90.51 }]);
    const { estado, cuerpo } = await enviar(solicitud());

    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "sin_hoteles_elegibles");
    assert.deepEqual(cuerpo.hoteles, []);
    assert.equal(cuerpo.busqueda?.candidatosEncontrados, 1);
  });
});

describe("POST /api/hoteles/recomendaciones - catálogo inválido", () => {
  test("responde 500 CATALOGO_TARIFAS_INVALIDO sin revelar el catálogo ni consultar a Geoapify", async () => {
    usarTarifas(tarifa("geo-uno", { importeCentavos: 0, fuente: { tipo: "cotizacion", referencia: "REFERENCIA-INTERNA-123" } }));
    const resultado = await enviar<CuerpoError>(solicitud());

    verificarError(resultado, 500, "CATALOGO_TARIFAS_INVALIDO");
    assert.equal(resultado.cuerpo.error.detalles, undefined);
    assert.ok(!resultado.texto.includes("REFERENCIA-INTERNA-123"));
    assert.ok(!resultado.texto.includes("geo-uno"));
    assert.equal(llamadas.length, 0);
  });

  test("un catálogo sin la lista de tarifas también es un error de configuración", async () => {
    catalogo = { hoteles: [] };
    verificarError(await enviar<CuerpoError>(solicitud()), 500, "CATALOGO_TARIFAS_INVALIDO");
  });

  test("un catálogo ilegible responde 500 CATALOGO_TARIFAS_NO_DISPONIBLE", async () => {
    const { instancia, url } = await iniciar(
      crearApp({
        apiKey: CLAVE,
        fetch: async () => respuestaJson(coleccionHoteles([])),
        hoteles: { rutaCatalogo: path.join(os.tmpdir(), "catalogo-hoteles-inexistente", "tarifas.json") },
      }),
    );
    try {
      verificarError(await enviarA<CuerpoError>(url, solicitud()), 500, "CATALOGO_TARIFAS_NO_DISPONIBLE");
    } finally {
      instancia.closeAllConnections();
      instancia.close();
    }
  });

  test("sin inyección usa el catálogo de producción, que está vacío", async () => {
    const { instancia, url } = await iniciar(crearApp({ apiKey: CLAVE, fetch: async () => respuestaJson(coleccionHoteles([])) }));
    try {
      const { estado, cuerpo } = await enviarA<RespuestaRecomendacionesHoteles>(url, solicitud());
      assert.equal(estado, 200);
      assert.equal(cuerpo.motivo, "catalogo_vacio");
    } finally {
      instancia.closeAllConnections();
      instancia.close();
    }
  });
});

describe("POST /api/hoteles/recomendaciones - solicitudes inválidas", () => {
  const muchasParadas = Array.from({ length: 26 }, () => ({ lat: 14.6, lng: -90.5 }));
  const casos: [string, unknown, string][] = [
    ["sin fecha", solicitud({ fecha: undefined }), "fecha"],
    ["fecha irreal", solicitud({ fecha: "2026-02-30" }), "fecha"],
    ["fecha con otro formato", solicitud({ fecha: "14/10/2026" }), "fecha"],
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
    test(`responde 400 sin consultar al proveedor: ${nombre}`, async () => {
      usarTarifas(tarifa("geo-uno"));
      const resultado = await enviar<CuerpoError>(cuerpo);

      verificarError(resultado, 400, "PARAMETRO_INVALIDO");
      assert.ok(resultado.cuerpo.error.detalles?.some((d) => d.parametro === parametro), JSON.stringify(resultado.cuerpo.error.detalles));
      assert.equal(llamadas.length, 0);
      assert.equal(lecturasCatalogo, 0);
    });
  }

  test("valida aunque hospedaje sea verdadero", async () => {
    const resultado = await enviar<CuerpoError>(solicitud({ hospedaje: true, presupuestoDiario: -1 }));
    verificarError(resultado, 400, "PARAMETRO_INVALIDO");
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

describe("POST /api/hoteles/recomendaciones - errores del proveedor", () => {
  const casos: [string, Simulador, number, string][] = [
    ["credenciales rechazadas", () => respuestaJson({ message: `Invalid apiKey ${CLAVE}` }, 401), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
    ["acceso prohibido", () => respuestaJson({}, 403), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
    ["límite de solicitudes", () => respuestaJson({}, 429), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
    ["error del proveedor", () => respuestaJson({}, 500), 502, "PROVEEDOR_ERROR"],
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
      (url, opciones) =>
        new Promise<Response>((_, rechazar) => {
          opciones?.signal?.addEventListener("abort", () => rechazar(new Error("abortado")));
        }),
      504,
      "PROVEEDOR_TIEMPO_AGOTADO",
    ],
  ];

  for (const [nombre, simular, estado, codigo] of casos) {
    test(`conserva el error de Geoapify: ${nombre}`, async () => {
      usarTarifas(tarifa("geo-uno"));
      simulador = simular;
      const resultado = await enviar<CuerpoError>(solicitud());

      verificarError(resultado, estado, codigo);
      assert.equal((resultado.cuerpo as unknown as Record<string, unknown>).hoteles, undefined);
      assert.equal(llamadas.length, 1);
    });
  }

  test("sin clave de Geoapify responde 500 SERVICIO_NO_CONFIGURADO en lugar de una lista vacía", async () => {
    const { instancia, url } = await iniciar(crearApp({ apiKey: "", hoteles: { leerCatalogo: async () => ({ tarifas: [tarifa("geo-uno")] }) } }));
    try {
      verificarError(await enviarA<CuerpoError>(url, solicitud()), 500, "SERVICIO_NO_CONFIGURADO");
    } finally {
      instancia.closeAllConnections();
      instancia.close();
    }
  });
});
