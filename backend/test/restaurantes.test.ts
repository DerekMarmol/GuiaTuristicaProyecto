import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type {
  ParadaFallidaRestaurantes,
  ParadaProcesadaRestaurantes,
  RespuestaRecomendacionesRestaurantes,
  ResultadoParadaRestaurantes,
} from "../../shared/types";
import { crearApp, type OpcionesApp } from "../src/app";
import { distanciaMetros } from "../src/hoteles/geografia";

interface CuerpoError {
  error: { codigo: string; mensaje: string; detalles?: { parametro: string; mensaje: string }[] };
}

interface Resultado<T> {
  estado: number;
  texto: string;
  cuerpo: T;
}

interface RestauranteSimulado {
  id: string;
  lat: number;
  lng: number;
  categorias?: string[];
  pais?: string | null;
  nombre?: string;
}

interface Centro {
  lat: number;
  lng: number;
  radio: number;
}

type Simulador = (centro: Centro, url: URL, opciones: RequestInit | undefined) => Response | Promise<Response>;

const CLAVE = "clave-geoapify-de-prueba-no-real";
const RUTA = "/api/restaurantes/recomendaciones";
const RAPIDA = ["catering", "catering.fast_food"];
const PATIO = ["catering", "catering.food_court"];
const GENERAL = ["catering", "catering.restaurant"];
const P1 = { id: "p1", lat: 14.5586, lng: -90.7295 };
const P2 = { id: "p2", lat: 14.5562, lng: -90.7339 };
const P3 = { id: "p3", lat: 14.6349, lng: -90.5069 };

let geoapify: Simulador;
let llamadas: URL[];
let apps: FastifyInstance[];
let app: FastifyInstance;

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

function feature({ id, lat, lng, categorias = RAPIDA, pais = "gt", nombre }: RestauranteSimulado): unknown {
  return {
    type: "Feature",
    properties: {
      place_id: id,
      name: nombre ?? `Restaurante ${id}`,
      formatted: `Dirección ${id}`,
      lat,
      lon: lng,
      categories: categorias,
      ...(pais === null ? {} : { country_code: pais }),
    },
    geometry: { type: "Point", coordinates: [lng, lat] },
  };
}

function centroDe(url: URL): Centro {
  const [lng, lat, radio] = (url.searchParams.get("filter") ?? "").replace("circle:", "").split(",").map(Number);
  return { lat, lng, radio };
}

const cerca = (a: Centro, b: { lat: number; lng: number }) => Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;

function devolverPorParada(porParada: [{ lat: number; lng: number }, RestauranteSimulado[]][]): void {
  geoapify = (centro) => {
    const encontrados = porParada.find(([parada]) => cerca(centro, parada));
    return respuestaJson({ type: "FeatureCollection", features: (encontrados?.[1] ?? []).map(feature) });
  };
}

function devolverSiempre(restaurantes: RestauranteSimulado[]): void {
  geoapify = () => respuestaJson({ type: "FeatureCollection", features: restaurantes.map(feature) });
}

function crear(opciones: OpcionesApp = {}): FastifyInstance {
  const instancia = crearApp({
    apiKey: CLAVE,
    tiempoEsperaMs: 50,
    fetch: async (url, init) => {
      const direccion = new URL(url);
      llamadas.push(direccion);
      if (direccion.hostname !== "api.geoapify.com") {
        throw new Error(`Host no simulado: ${direccion.hostname}`);
      }
      return geoapify(centroDe(direccion), direccion, init);
    },
    restaurantes: { intervaloMs: 0 },
    ...opciones,
  });
  apps.push(instancia);
  return instancia;
}

function solicitud(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return { fecha: "2026-11-20", paradas: [P1, P2], presupuestoDiario: 500, moneda: "GTQ", comensales: 2, ...cambios };
}

async function enviarA<T>(instancia: FastifyInstance, datos: unknown): Promise<Resultado<T>> {
  const respuesta = await instancia.inject({
    method: "POST",
    url: RUTA,
    headers: { "content-type": "application/json" },
    payload: typeof datos === "string" ? datos : JSON.stringify(datos),
  });
  return { estado: respuesta.statusCode, texto: respuesta.body, cuerpo: JSON.parse(respuesta.body) as T };
}

function enviar<T = RespuestaRecomendacionesRestaurantes>(datos: unknown): Promise<Resultado<T>> {
  return enviarA<T>(app, datos);
}

function procesada(parada: ResultadoParadaRestaurantes | undefined): ParadaProcesadaRestaurantes {
  assert.ok(parada && parada.estado === "procesada", JSON.stringify(parada));
  return parada;
}

function fallida(parada: ResultadoParadaRestaurantes | undefined): ParadaFallidaRestaurantes {
  assert.ok(parada && parada.estado === "fallida", JSON.stringify(parada));
  return parada;
}

function sinSecretos(texto: string): void {
  for (const secreto of [CLAVE, "apiKey", "api.geoapify.com"]) {
    assert.ok(!texto.includes(secreto), `la respuesta no debe incluir ${secreto}`);
  }
}

function verificarError(resultado: Resultado<CuerpoError>, estado: number, codigo: string): void {
  assert.equal(resultado.estado, estado, resultado.texto);
  assert.equal(resultado.cuerpo.error.codigo, codigo);
  assert.equal(typeof resultado.cuerpo.error.mensaje, "string");
  sinSecretos(resultado.texto);
}

beforeEach(() => {
  llamadas = [];
  apps = [];
  devolverSiempre([]);
  mock.method(console, "error", () => {});
  app = crear();
});

afterEach(async () => {
  for (const instancia of apps) {
    await instancia.close();
  }
  mock.restoreAll();
});

describe("POST /api/restaurantes/recomendaciones - búsqueda por parada", () => {
  test("consulta Geoapify una vez por parada usando cada parada como centro", async () => {
    const { estado } = await enviar(solicitud({ paradas: [P1, P2, P3] }));
    assert.equal(estado, 200);
    assert.equal(llamadas.length, 3);
    const centros = llamadas.map(centroDe);
    for (const parada of [P1, P2, P3]) {
      assert.ok(centros.some((centro) => cerca(centro, parada)), `falta la búsqueda centrada en ${parada.id}`);
    }
    for (const url of llamadas) {
      const centro = centroDe(url);
      assert.equal(url.pathname, "/v2/places");
      assert.equal(url.searchParams.get("categories"), "catering.restaurant,catering.fast_food,catering.food_court");
      assert.equal(url.searchParams.get("filter"), `circle:${centro.lng},${centro.lat},2000`);
      assert.equal(url.searchParams.get("bias"), `proximity:${centro.lng},${centro.lat}`);
      assert.equal(url.searchParams.get("limit"), "40");
      assert.equal(url.searchParams.get("apiKey"), CLAVE);
    }
  });

  test("devuelve el contrato completo de una parada con una recomendación elegible", async () => {
    devolverPorParada([[P1, [{ id: "rapida-1", lat: 14.5596, lng: -90.7295, nombre: "Pollo de ejemplo" }]]]);
    const { estado, cuerpo, texto } = await enviar(solicitud({ paradas: [P1] }));

    assert.equal(estado, 200);
    assert.equal(cuerpo.fecha, "2026-11-20");
    assert.equal(cuerpo.moneda, "GTQ");
    assert.equal(cuerpo.presupuestoDiario, 500);
    assert.equal(cuerpo.presupuestoDiarioCentavos, 50000);
    assert.equal(cuerpo.porcentajeAlimentacion, 30);
    assert.equal(cuerpo.presupuestoAlimentacion, 150);
    assert.equal(cuerpo.presupuestoAlimentacionCentavos, 15000);
    assert.equal(cuerpo.comensales, 2);
    assert.equal(cuerpo.presupuestoPorPersona, 75);
    assert.equal(cuerpo.comidasPresupuestadas, 1);
    assert.equal(cuerpo.metodoDistancia, "linea_recta");
    assert.equal(cuerpo.radioMetros, 2000);
    assert.equal(cuerpo.limitePorParada, 10);
    assert.equal(cuerpo.preciosReferenciales.referencial, true);
    assert.equal(cuerpo.preciosReferenciales.precioConfirmado, false);
    assert.equal(cuerpo.preciosReferenciales.consultadoEn, "2026-10-18");
    assert.ok(cuerpo.preciosReferenciales.fuentes.some((f) => f.nombre.startsWith("Numbeo")));
    assert.deepEqual(cuerpo.resumen, { paradasSolicitadas: 1, paradasProcesadas: 1, paradasFallidas: 0, busquedasIntentadas: 1, busquedasOmitidas: 0, completo: true });
    assert.equal(cuerpo.motivo, null);

    const parada = procesada(cuerpo.paradas[0]);
    assert.deepEqual([parada.id, parada.lat, parada.lng], ["p1", P1.lat, P1.lng]);
    assert.equal(parada.restaurantesEncontrados, 1);
    assert.equal(parada.recomendacionesElegibles, 1);
    assert.equal(parada.motivo, null);
    assert.equal(parada.mensaje, null);
    assert.deepEqual(parada.sinEstimacion, []);
    assert.deepEqual(parada.busqueda, {
      proveedor: "geoapify",
      categorias: ["catering.restaurant", "catering.fast_food", "catering.food_court"],
      radioMetros: 2000,
      limiteProveedor: 40,
      resultadosProveedor: 1,
      resultadosDescartados: 0,
      fueraDeRadio: 0,
      sinEstimacion: 0,
      excluidosPorPresupuesto: 0,
      posiblesResultadosAdicionales: false,
      busquedaCompartida: false,
    });

    const [restaurante] = parada.restaurantes;
    assert.deepEqual(
      { ...restaurante, tarifaReferencial: undefined },
      {
        idExterno: "rapida-1",
        proveedor: "geoapify",
        nombre: "Pollo de ejemplo",
        direccion: "Dirección rapida-1",
        lat: 14.5596,
        lng: -90.7295,
        categorias: RAPIDA,
        distanciaLineaRectaMetros: Math.round(distanciaMetros(P1, { lat: 14.5596, lng: -90.7295 })),
        estimacion: "estimado",
        tarifaReferencial: undefined,
        costoReferencialGrupo: { comensales: 2, importe: 140, importeCentavos: 14000, moneda: "GTQ" },
        elegiblePorPresupuesto: true,
      },
    );
    const tarifa = restaurante.tarifaReferencial;
    assert.equal(tarifa.referencial, true);
    assert.equal(tarifa.precioConfirmado, false);
    assert.equal(tarifa.referenciaId, "gt-comida-rapida");
    assert.equal(tarifa.perfil, "comida_rapida");
    assert.equal(tarifa.aplicabilidad, "perfil_correspondiente");
    assert.deepEqual([tarifa.minimo, tarifa.minimoCentavos, tarifa.maximo, tarifa.maximoCentavos], [50, 5000, 70, 7000]);
    assert.deepEqual([tarifa.criterioEvaluacion, tarifa.valorEvaluacion, tarifa.valorEvaluacionCentavos], ["maximo_del_rango", 70, 7000]);
    assert.deepEqual([tarifa.moneda, tarifa.unidad, tarifa.region], ["GTQ", "persona_comida", "Guatemala"]);
    assert.ok(tarifa.fuentes.length > 0 && tarifa.fuentes.every((f) => f.url.startsWith("https://") && f.consultadoEn === "2026-10-18"));
    assert.equal("tipo_entorno" in restaurante, false);
    sinSecretos(texto);
  });

  test("conserva el orden de las paradas aunque las búsquedas terminen en otro orden", async () => {
    const retrasos = new Map([
      [P1.id, 30],
      [P2.id, 0],
      [P3.id, 15],
    ]);
    geoapify = async (centro) => {
      const parada = [P1, P2, P3].find((p) => cerca(centro, p));
      await new Promise((resolve) => setTimeout(resolve, retrasos.get(parada?.id ?? "") ?? 0));
      return respuestaJson({ features: [] });
    };
    const instancia = crear({ restaurantes: { intervaloMs: 0, concurrencia: 3 } });
    const { cuerpo } = await enviarA<RespuestaRecomendacionesRestaurantes>(instancia, solicitud({ paradas: [P1, P2, P3] }));
    assert.deepEqual(cuerpo.paradas.map((p) => p.id), ["p1", "p2", "p3"]);
  });

  test("ordena por cercanía a su parada aunque el proveedor entregue otro orden y desempata por idExterno", async () => {
    devolverPorParada([
      [
        P1,
        [
          { id: "lejano", lat: 14.5686, lng: -90.7295 },
          { id: "cercano-b", lat: 14.5591, lng: -90.7295 },
          { id: "medio", lat: 14.5636, lng: -90.7295 },
          { id: "cercano-a", lat: 14.5591, lng: -90.7295 },
        ],
      ],
    ]);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1] }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.deepEqual(parada.restaurantes.map((r) => r.idExterno), ["cercano-a", "cercano-b", "medio", "lejano"]);
    const distancias = parada.restaurantes.map((r) => r.distanciaLineaRectaMetros);
    assert.deepEqual(distancias, [...distancias].sort((a, b) => a - b));
    assert.ok(Math.abs(distancias[3] - 1112) <= 1, String(distancias[3]));
  });

  test("calcula la distancia respecto a cada parada y asocia el mismo restaurante a varias paradas", async () => {
    const compartido = { id: "compartido", lat: 14.5574, lng: -90.7317 };
    devolverPorParada([
      [P1, [compartido, { id: "solo-p1", lat: 14.5588, lng: -90.7295 }]],
      [P2, [compartido]],
    ]);
    const { cuerpo } = await enviar(solicitud());
    const [p1, p2] = cuerpo.paradas.map(procesada);
    const enP1 = p1.restaurantes.find((r) => r.idExterno === "compartido");
    const enP2 = p2.restaurantes.find((r) => r.idExterno === "compartido");
    assert.ok(enP1 && enP2);
    assert.equal(enP1.distanciaLineaRectaMetros, Math.round(distanciaMetros(P1, compartido)));
    assert.equal(enP2.distanciaLineaRectaMetros, Math.round(distanciaMetros(P2, compartido)));
    assert.deepEqual(p1.restaurantes.map((r) => r.idExterno), ["solo-p1", "compartido"]);
    assert.deepEqual(p2.restaurantes.map((r) => r.idExterno), ["compartido"]);
  });

  test("elimina duplicados dentro de una parada conservando la primera aparición", async () => {
    devolverPorParada([
      [
        P1,
        [
          { id: "dup", lat: 14.5596, lng: -90.7295, nombre: "Primero" },
          { id: "dup", lat: 14.5590, lng: -90.7295, nombre: "Repetido" },
          { id: "otro", lat: 14.5600, lng: -90.7295 },
        ],
      ],
    ]);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1] }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.deepEqual(parada.restaurantes.map((r) => [r.idExterno, r.nombre]), [["dup", "Primero"], ["otro", "Restaurante otro"]]);
    assert.equal(parada.busqueda.resultadosProveedor, 3);
    assert.equal(parada.busqueda.resultadosDescartados, 1);
  });

  test("reutiliza la búsqueda de paradas con las mismas coordenadas", async () => {
    devolverSiempre([{ id: "uno", lat: 14.5596, lng: -90.7295 }]);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1, { ...P1, id: "p1-bis" }, P2] }));
    assert.equal(llamadas.length, 2);
    const paradas = cuerpo.paradas.map(procesada);
    assert.deepEqual(paradas.map((p) => [p.id, p.busqueda.busquedaCompartida]), [["p1", false], ["p1-bis", true], ["p2", false]]);
    assert.deepEqual(paradas[1].restaurantes, paradas[0].restaurantes);
    assert.equal(cuerpo.resumen.busquedasIntentadas, 2);
  });

  test("descarta restaurantes fuera del radio aunque el proveedor los devuelva", async () => {
    devolverPorParada([[P1, [{ id: "dentro", lat: 14.5686, lng: -90.7295 }, { id: "fuera", lat: 14.6086, lng: -90.7295 }]]]);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1] }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.deepEqual(parada.restaurantes.map((r) => r.idExterno), ["dentro"]);
    assert.equal(parada.busqueda.fueraDeRadio, 1);
    assert.equal(parada.restaurantesEncontrados, 1);
  });

  test("aplica el radio configurado en la consulta y en el filtro", async () => {
    devolverPorParada([[P1, [{ id: "a-1500", lat: 14.5721, lng: -90.7295 }]]]);
    const corto = await enviar(solicitud({ paradas: [P1], radio: 1000 }));
    assert.equal(llamadas[0].searchParams.get("filter"), `circle:${P1.lng},${P1.lat},1000`);
    assert.equal(procesada(corto.cuerpo.paradas[0]).motivo, "sin_restaurantes_en_radio");
    const largo = await enviar(solicitud({ paradas: [P1], radio: 1600 }));
    assert.deepEqual(procesada(largo.cuerpo.paradas[0]).restaurantes.map((r) => r.idExterno), ["a-1500"]);
  });

  test("aplica el límite por parada después de filtrar y ordenar, sin cambiar los conteos", async () => {
    devolverPorParada([
      [
        P1,
        Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, lat: P1.lat + (6 - i) * 0.0005, lng: P1.lng })),
      ],
    ]);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1], limite: 2 }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.deepEqual(parada.restaurantes.map((r) => r.idExterno), ["r5", "r4"]);
    assert.equal(parada.recomendacionesElegibles, 6);
    assert.equal(cuerpo.limitePorParada, 2);
  });

  test("informa que pueden existir más resultados cuando el proveedor llena el límite", async () => {
    devolverPorParada([[P1, Array.from({ length: 40 }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}`, lat: P1.lat + i * 0.0001, lng: P1.lng }))]]);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1] }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.equal(parada.busqueda.posiblesResultadosAdicionales, true);
    assert.equal(parada.restaurantes.length, 10);
  });

  test("descarta datos incompletos y coordenadas inválidas del proveedor", async () => {
    geoapify = () =>
      respuestaJson({
        features: [
          feature({ id: "valido", lat: 14.5596, lng: -90.7295 }),
          feature({ id: "lat-invalida", lat: 95, lng: -90.7295 }),
          feature({ id: "lng-invalida", lat: 14.5596, lng: -190 }),
          { properties: { place_id: "sin-nombre", lat: 14.5596, lon: -90.7295, categories: RAPIDA, country_code: "gt" } },
          { properties: { name: "Sin id", lat: 14.5596, lon: -90.7295, categories: RAPIDA } },
          { properties: { place_id: "sin-categorias", name: "X", lat: 14.5596, lon: -90.7295, country_code: "gt" } },
          "no es un objeto",
        ],
      });
    const { cuerpo } = await enviar(solicitud({ paradas: [P1] }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.deepEqual(parada.restaurantes.map((r) => r.idExterno), ["valido"]);
    assert.equal(parada.busqueda.resultadosProveedor, 7);
    assert.equal(parada.busqueda.resultadosDescartados, 6);
  });
});

describe("POST /api/restaurantes/recomendaciones - presupuesto", () => {
  const MIXTOS: RestauranteSimulado[] = [
    { id: "rapida", lat: 14.5591, lng: -90.7295, categorias: RAPIDA },
    { id: "patio", lat: 14.5596, lng: -90.7295, categorias: PATIO },
    { id: "general", lat: 14.5601, lng: -90.7295, categorias: GENERAL },
  ];
  const elegibles = (cuerpo: RespuestaRecomendacionesRestaurantes) => procesada(cuerpo.paradas[0]).restaurantes.map((r) => r.idExterno);

  test("Q500 y dos comensales: Q150 para comer, admite comida rápida (Q140) y excluye el resto", async () => {
    devolverSiempre(MIXTOS);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1] }));
    assert.deepEqual(elegibles(cuerpo), ["rapida"]);
    const parada = procesada(cuerpo.paradas[0]);
    assert.equal(parada.busqueda.excluidosPorPresupuesto, 2);
    assert.equal(parada.restaurantesEncontrados, 3);
    assert.equal(parada.restaurantes[0].costoReferencialGrupo.importeCentavos, 14000);
  });

  test("una persona con Q500 admite comida rápida y patio de comidas pero no el escenario general de Q300", async () => {
    devolverSiempre(MIXTOS);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1], comensales: 1 }));
    assert.deepEqual(elegibles(cuerpo), ["rapida", "patio"]);
    assert.equal(cuerpo.presupuestoPorPersonaCentavos, 15000);
  });

  test("con Q1000 y una persona el costo general de Q300 es exactamente igual al límite y se admite", async () => {
    devolverSiempre(MIXTOS);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1], comensales: 1, presupuestoDiario: 1000 }));
    assert.deepEqual(elegibles(cuerpo), ["rapida", "patio", "general"]);
    const general = procesada(cuerpo.paradas[0]).restaurantes[2];
    assert.equal(general.costoReferencialGrupo.importeCentavos, cuerpo.presupuestoAlimentacionCentavos);
    assert.equal(general.tarifaReferencial.aplicabilidad, "escenario_general");
  });

  test("con decimales: Q466.67 deja Q140.00 y admite Q140; Q466.66 deja Q139.99 y lo excluye por un centavo", async () => {
    devolverSiempre([MIXTOS[0]]);
    const igual = await enviar(solicitud({ paradas: [P1], presupuestoDiario: 466.67 }));
    assert.equal(igual.cuerpo.presupuestoAlimentacionCentavos, 14000);
    assert.deepEqual(elegibles(igual.cuerpo), ["rapida"]);
    const debajo = await enviar(solicitud({ paradas: [P1], presupuestoDiario: 466.66 }));
    assert.equal(debajo.cuerpo.presupuestoAlimentacionCentavos, 13999);
    assert.deepEqual(elegibles(debajo.cuerpo), []);
    assert.equal(procesada(debajo.cuerpo.paradas[0]).motivo, "sin_restaurantes_en_presupuesto");
  });

  test("con presupuesto insuficiente no recomienda nada e informa el motivo", async () => {
    devolverSiempre(MIXTOS);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1], presupuestoDiario: 100, comensales: 3 }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.deepEqual(parada.restaurantes, []);
    assert.equal(parada.recomendacionesElegibles, 0);
    assert.equal(parada.motivo, "sin_restaurantes_en_presupuesto");
    assert.equal(typeof parada.mensaje, "string");
  });

  test("todas las paradas se evalúan contra el mismo límite diario sin sumar costos", async () => {
    geoapify = (centro) => respuestaJson({ features: [feature({ id: "rapida", lat: centro.lat + 0.0005, lng: centro.lng })] });
    const paradas = [P1, P2, P3, { id: "p4", lat: 14.6, lng: -90.5 }, { id: "p5", lat: 14.61, lng: -90.51 }];
    const { cuerpo } = await enviar(solicitud({ paradas }));
    assert.equal(cuerpo.paradas.length, 5);
    assert.equal(cuerpo.presupuestoAlimentacionCentavos, 15000);
    assert.equal(cuerpo.comidasPresupuestadas, 1);
    for (const parada of cuerpo.paradas.map(procesada)) {
      assert.deepEqual(parada.restaurantes.map((r) => r.costoReferencialGrupo.importeCentavos), [14000]);
    }
  });

  test("ignora un porcentaje de alimentación enviado por el cliente", async () => {
    const { cuerpo } = await enviar(solicitud({ paradas: [P1], porcentajeAlimentacion: 100 }));
    assert.equal(cuerpo.porcentajeAlimentacion, 30);
    assert.equal(cuerpo.presupuestoAlimentacionCentavos, 15000);
  });

  test("separa los restaurantes sin estimación y nunca los presenta como elegibles", async () => {
    devolverSiempre([
      { id: "sin-pais", lat: 14.5591, lng: -90.7295, pais: null },
      { id: "otro-pais", lat: 14.5592, lng: -90.7295, pais: "mx" },
      { id: "cafeteria", lat: 14.5593, lng: -90.7295, categorias: ["catering", "catering.cafe"] },
    ]);
    const { cuerpo } = await enviar(solicitud({ paradas: [P1], presupuestoDiario: 100000 }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.deepEqual(parada.restaurantes, []);
    assert.equal(parada.motivo, "sin_tarifas_aplicables");
    assert.equal(parada.busqueda.sinEstimacion, 3);
    assert.deepEqual(
      parada.sinEstimacion.map((r) => [r.idExterno, r.estimacion, r.motivoSinEstimacion, r.tarifaReferencial, r.costoReferencialGrupo, r.elegiblePorPresupuesto]),
      [
        ["sin-pais", "sin_estimacion", "region_no_identificada", null, null, false],
        ["otro-pais", "sin_estimacion", "region_no_cubierta", null, null, false],
        ["cafeteria", "sin_estimacion", "categoria_sin_referencia", null, null, false],
      ],
    );
  });
});

describe("POST /api/restaurantes/recomendaciones - respuestas sin recomendaciones", () => {
  test("un itinerario sin paradas responde 200 sin consultar al proveedor", async () => {
    const { estado, cuerpo } = await enviar(solicitud({ paradas: [] }));
    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, "itinerario_sin_paradas");
    assert.equal(typeof cuerpo.mensaje, "string");
    assert.deepEqual(cuerpo.paradas, []);
    assert.equal(cuerpo.presupuestoAlimentacionCentavos, 15000);
    assert.equal(llamadas.length, 0);
  });

  test("una búsqueda vacía informa que no se encontraron restaurantes", async () => {
    const { cuerpo } = await enviar(solicitud({ paradas: [P1] }));
    const parada = procesada(cuerpo.paradas[0]);
    assert.equal(parada.motivo, "sin_restaurantes_encontrados");
    assert.equal(parada.restaurantesEncontrados, 0);
    assert.equal(parada.error, null);
    assert.equal(cuerpo.resumen.completo, true);
  });

  test("la fecha es opcional y se devuelve null si no se envía", async () => {
    const { estado, cuerpo } = await enviar(solicitud({ paradas: [], fecha: undefined }));
    assert.equal(estado, 200);
    assert.equal(cuerpo.fecha, null);
  });
});

describe("POST /api/restaurantes/recomendaciones - errores del proveedor", () => {
  test("sin clave de Geoapify responde SERVICIO_NO_CONFIGURADO sin llamadas externas", async () => {
    const instancia = crear({ apiKey: "" });
    verificarError(await enviarA<CuerpoError>(instancia, solicitud({ paradas: [P1, P2, P3] })), 500, "SERVICIO_NO_CONFIGURADO");
    assert.equal(llamadas.length, 0);
  });

  const errores: [string, Simulador, number, string][] = [
    ["clave inválida", () => respuestaJson({ error: "Invalid apiKey" }, 401), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
    ["acceso prohibido", () => respuestaJson({}, 403), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS"],
    ["límite de solicitudes", () => respuestaJson({}, 429), 503, "PROVEEDOR_LIMITE_SOLICITUDES"],
    ["error HTTP", () => respuestaJson({}, 500), 502, "PROVEEDOR_ERROR"],
    ["respuesta no JSON", () => new Response("<html>", { status: 200 }), 502, "PROVEEDOR_RESPUESTA_INVALIDA"],
    ["estructura inesperada", () => respuestaJson({ resultados: [] }), 502, "PROVEEDOR_RESPUESTA_INVALIDA"],
    [
      "fallo de red",
      () => {
        throw new TypeError("fetch failed");
      },
      502,
      "PROVEEDOR_NO_DISPONIBLE",
    ],
    [
      "tiempo agotado",
      (_centro, _url, opciones) =>
        new Promise<Response>((_, rechazar) => {
          opciones?.signal?.addEventListener("abort", () => rechazar(new Error("abortado")));
        }),
      504,
      "PROVEEDOR_TIEMPO_AGOTADO",
    ],
  ];

  for (const [nombre, simular, estado, codigo] of errores) {
    test(`si fallan todas las paradas responde el error del proveedor, no una lista vacía: ${nombre}`, async () => {
      geoapify = simular;
      const resultado = await enviar<CuerpoError>(solicitud({ paradas: [P1] }));
      verificarError(resultado, estado, codigo);
      assert.equal((resultado.cuerpo as unknown as Record<string, unknown>).paradas, undefined);
    });
  }

  test("un fallo parcial devuelve las paradas procesadas e identifica la fallida", async () => {
    geoapify = (centro) =>
      cerca(centro, P2) ? respuestaJson({}, 500) : respuestaJson({ features: [feature({ id: "r", lat: centro.lat + 0.001, lng: centro.lng })] });
    const { estado, cuerpo, texto } = await enviar(solicitud({ paradas: [P1, P2, P3] }));
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.paradas.map((p) => [p.id, p.estado]), [["p1", "procesada"], ["p2", "fallida"], ["p3", "procesada"]]);
    const p2 = fallida(cuerpo.paradas[1]);
    assert.equal(p2.motivo, "busqueda_fallida");
    assert.equal(p2.restaurantesEncontrados, null);
    assert.deepEqual(p2.restaurantes, []);
    assert.equal(p2.busqueda, null);
    assert.deepEqual([p2.error.codigo, p2.error.consultada], ["PROVEEDOR_ERROR", true]);
    assert.match(p2.mensaje, /no significa que no existan restaurantes/);
    assert.deepEqual(cuerpo.resumen, { paradasSolicitadas: 3, paradasProcesadas: 2, paradasFallidas: 1, busquedasIntentadas: 3, busquedasOmitidas: 0, completo: false });
    sinSecretos(texto);
  });

  test("tras alcanzar el límite de solicitudes no consulta las paradas pendientes", async () => {
    geoapify = (centro) => (cerca(centro, P1) ? respuestaJson({ features: [] }) : respuestaJson({}, 429));
    const instancia = crear({ restaurantes: { intervaloMs: 0, concurrencia: 1 } });
    const { estado, cuerpo } = await enviarA<RespuestaRecomendacionesRestaurantes>(instancia, solicitud({ paradas: [P1, P2, P3] }));
    assert.equal(estado, 200);
    assert.equal(llamadas.length, 2);
    assert.deepEqual(cuerpo.paradas.map((p) => p.estado), ["procesada", "fallida", "fallida"]);
    assert.deepEqual([fallida(cuerpo.paradas[1]).error.consultada, fallida(cuerpo.paradas[2]).error.consultada], [true, false]);
    assert.equal(fallida(cuerpo.paradas[2]).error.codigo, "PROVEEDOR_LIMITE_SOLICITUDES");
    assert.deepEqual([cuerpo.resumen.busquedasIntentadas, cuerpo.resumen.busquedasOmitidas], [2, 1]);
  });

  test("con credenciales rechazadas deja de consultar y responde el error", async () => {
    geoapify = () => respuestaJson({}, 401);
    const instancia = crear({ restaurantes: { intervaloMs: 0, concurrencia: 1 } });
    verificarError(await enviarA<CuerpoError>(instancia, solicitud({ paradas: [P1, P2, P3] })), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS");
    assert.equal(llamadas.length, 1);
  });
});

describe("POST /api/restaurantes/recomendaciones - solicitudes inválidas", () => {
  const muchas = Array.from({ length: 26 }, (_, i) => ({ id: `p${i}`, lat: 14.6, lng: -90.5 }));
  const casos: [string, unknown, string][] = [
    ["sin paradas", solicitud({ paradas: undefined }), "paradas"],
    ["paradas no lista", solicitud({ paradas: { id: "p1", lat: 1, lng: 1 } }), "paradas"],
    ["demasiadas paradas", solicitud({ paradas: muchas }), "paradas"],
    ["parada nula", solicitud({ paradas: [null] }), "paradas.0"],
    ["parada sin id", solicitud({ paradas: [{ lat: 14.6, lng: -90.5 }] }), "paradas.0.id"],
    ["id vacío", solicitud({ paradas: [{ ...P1, id: "   " }] }), "paradas.0.id"],
    ["id numérico", solicitud({ paradas: [{ ...P1, id: 1 }] }), "paradas.0.id"],
    ["id demasiado largo", solicitud({ paradas: [{ ...P1, id: "x".repeat(101) }] }), "paradas.0.id"],
    ["id con caracteres de control", solicitud({ paradas: [{ ...P1, id: "p\u0000" }] }), "paradas.0.id"],
    ["ids repetidos", solicitud({ paradas: [P1, { ...P2, id: "p1" }] }), "paradas.1.id"],
    ["ids repetidos tras recortar espacios", solicitud({ paradas: [P1, { ...P2, id: " p1 " }] }), "paradas.1.id"],
    ["latitud fuera de rango", solicitud({ paradas: [{ ...P1, lat: 90.1 }] }), "paradas.0.lat"],
    ["longitud fuera de rango", solicitud({ paradas: [{ ...P1, lng: -180.1 }] }), "paradas.0.lng"],
    ["coordenada como texto", solicitud({ paradas: [{ ...P1, lat: "14.5" }] }), "paradas.0.lat"],
    ["coordenada ausente", solicitud({ paradas: [{ id: "p1", lat: 14.5 }] }), "paradas.0.lng"],
    ["sin presupuesto", solicitud({ presupuestoDiario: undefined }), "presupuestoDiario"],
    ["presupuesto cero", solicitud({ presupuestoDiario: 0 }), "presupuestoDiario"],
    ["presupuesto negativo", solicitud({ presupuestoDiario: -1 }), "presupuestoDiario"],
    ["presupuesto con tres decimales", solicitud({ presupuestoDiario: 500.001 }), "presupuestoDiario"],
    ["presupuesto como texto", solicitud({ presupuestoDiario: "500" }), "presupuestoDiario"],
    ["presupuesto excesivo", solicitud({ presupuestoDiario: 1_000_000.01 }), "presupuestoDiario"],
    ["presupuesto no finito", JSON.stringify(solicitud({ presupuestoDiario: 0 })).replace('"presupuestoDiario":0', '"presupuestoDiario":1e999'), "presupuestoDiario"],
    ["sin moneda", solicitud({ moneda: undefined }), "moneda"],
    ["otra moneda", solicitud({ moneda: "USD" }), "moneda"],
    ["sin comensales", solicitud({ comensales: undefined }), "comensales"],
    ["comensales cero", solicitud({ comensales: 0 }), "comensales"],
    ["comensales decimales", solicitud({ comensales: 1.5 }), "comensales"],
    ["comensales excesivos", solicitud({ comensales: 11 }), "comensales"],
    ["comensales como texto", solicitud({ comensales: "2" }), "comensales"],
    ["radio cero", solicitud({ radio: 0 }), "radio"],
    ["radio excesivo", solicitud({ radio: 10001 }), "radio"],
    ["radio decimal", solicitud({ radio: 100.5 }), "radio"],
    ["límite cero", solicitud({ limite: 0 }), "limite"],
    ["límite excesivo", solicitud({ limite: 21 }), "limite"],
    ["fecha irreal", solicitud({ fecha: "2026-02-30" }), "fecha"],
    ["fecha con otro formato", solicitud({ fecha: "20/11/2026" }), "fecha"],
    ["fecha no texto", solicitud({ fecha: 20261120 }), "fecha"],
    ["cuerpo como lista", [solicitud()], "cuerpo"],
  ];

  for (const [nombre, cuerpo, parametro] of casos) {
    test(`responde 400 sin consultar Geoapify: ${nombre}`, async () => {
      const resultado = await enviar<CuerpoError>(cuerpo);
      verificarError(resultado, 400, "PARAMETRO_INVALIDO");
      assert.ok(resultado.cuerpo.error.detalles?.some((d) => d.parametro === parametro), JSON.stringify(resultado.cuerpo.error.detalles));
      assert.equal(llamadas.length, 0);
    });
  }

  test("rechaza JSON mal formado, vacío, nulo y cuerpos de más de 32 KB sin consultar Geoapify", async () => {
    verificarError(await enviar<CuerpoError>("{ paradas: "), 400, "PARAMETRO_INVALIDO");
    verificarError(await enviar<CuerpoError>("null"), 400, "PARAMETRO_INVALIDO");
    verificarError(await enviar<CuerpoError>(JSON.stringify({ ...solicitud(), relleno: "x".repeat(33 * 1024) })), 400, "PARAMETRO_INVALIDO");
    assert.equal(llamadas.length, 0);
  });

  test("recorta los espacios del id y acepta coordenadas cero", async () => {
    const { estado, cuerpo } = await enviar(solicitud({ paradas: [{ id: "  centro  ", lat: 0, lng: 0 }] }));
    assert.equal(estado, 200);
    assert.equal(cuerpo.paradas[0].id, "centro");
  });

  test("solo admite POST", async () => {
    const respuesta = await app.inject({ method: "GET", url: RUTA });
    assert.equal(respuesta.statusCode, 404);
  });
});
