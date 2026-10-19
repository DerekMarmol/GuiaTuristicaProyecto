import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LugarAbiertoAhora, RespuestaLugaresAbiertosAhora } from "../../shared/types";
import { crearApp } from "../src/app";
import { CATEGORIAS_TURISTICAS_PREDETERMINADAS } from "../src/config/abiertosAhora";
import { zonaHorariaDeDetalles } from "../src/geoapify/detalles";
import type { ConsultarApertura, DatosApertura } from "../src/geoapify/enriquecer";
import type { Horario } from "../src/geoapify/horario";
import { evaluarAperturaActual } from "../src/lugares/aperturaActual";
import { crearCacheApertura } from "../src/lugares/cacheApertura";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const GUATEMALA = "America/Guatemala";
const CLAVE = "clave-de-prueba-no-real-abiertos";
// Martes 13 de octubre de 2026, 10:00 en Guatemala (UTC-6).
const MARTES_10_GT = Date.parse("2026-10-13T16:00:00Z");
const ORIGEN = { lat: 14.6349, lng: -90.5069 };

function disponible(valorOriginal: string): Horario {
  return { estado: "disponible", valorOriginal, fuente: "geoapify" };
}

const NO_PUBLICADO: Horario = { estado: "no_publicado", valorOriginal: null, fuente: "geoapify" };

function conZonaDelServidor<T>(zona: string, ejecutar: () => T): T {
  const anterior = process.env.TZ;
  process.env.TZ = zona;
  try {
    return ejecutar();
  } finally {
    if (anterior === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = anterior;
    }
  }
}

const ZONAS_DEL_SERVIDOR = ["UTC", "Asia/Tokyo", "America/Guatemala", "Europe/Madrid"];

// ---------------------------------------------------------------------------
// Evaluación de la apertura actual
// ---------------------------------------------------------------------------

describe("evaluarAperturaActual", () => {
  test("abierto dentro del horario, con el cierre en la hora local del lugar", () => {
    assert.deepEqual(evaluarAperturaActual(disponible("Mo-Fr 09:00-17:00"), GUATEMALA, MARTES_10_GT), {
      estadoApertura: "abierto",
      open_now: true,
      cierreEstimado: "2026-10-13T17:00-06:00",
    });
  });

  test("cerrado fuera del horario", () => {
    assert.deepEqual(evaluarAperturaActual(disponible("Mo-Fr 09:00-17:00"), GUATEMALA, Date.parse("2026-10-13T23:30:00Z")), {
      estadoApertura: "cerrado",
      open_now: false,
    });
  });

  test("abierto en el minuto exacto de apertura y cerrado en el minuto exacto de cierre", () => {
    const horario = disponible("Mo-Fr 09:00-17:00");
    assert.equal(evaluarAperturaActual(horario, GUATEMALA, Date.parse("2026-10-13T15:00:00Z")).open_now, true);
    assert.equal(evaluarAperturaActual(horario, GUATEMALA, Date.parse("2026-10-13T14:59:00Z")).open_now, false);
    assert.equal(evaluarAperturaActual(horario, GUATEMALA, Date.parse("2026-10-13T22:59:00Z")).open_now, true);
    assert.equal(evaluarAperturaActual(horario, GUATEMALA, Date.parse("2026-10-13T23:00:00Z")).open_now, false);
  });

  test("24/7 está abierto sin cierre estimado", () => {
    assert.deepEqual(evaluarAperturaActual(disponible("24/7"), GUATEMALA, Date.parse("2026-10-18T09:30:00Z")), {
      estadoApertura: "abierto",
      open_now: true,
      cierreEstimado: null,
    });
  });

  test("un turno que cruza la medianoche sigue abierto de madrugada", () => {
    // Sábado 17 a la 01:00 en Guatemala, dentro del turno que empezó el viernes a las 22:00.
    assert.deepEqual(evaluarAperturaActual(disponible("Fr 22:00-03:00"), GUATEMALA, Date.parse("2026-10-17T07:00:00Z")), {
      estadoApertura: "abierto",
      open_now: true,
      cierreEstimado: "2026-10-17T03:00-06:00",
    });
    assert.equal(evaluarAperturaActual(disponible("Fr 22:00-03:00"), GUATEMALA, Date.parse("2026-10-17T09:00:00Z")).open_now, false);
  });

  test("usa el día local del lugar y no el día UTC", () => {
    // 05:00 UTC del domingo es sábado 23:00 en Guatemala.
    const instante = Date.parse("2026-10-18T05:00:00Z");
    assert.equal(evaluarAperturaActual(disponible("Sa 18:00-23:30; Su off"), GUATEMALA, instante).open_now, true);
    assert.equal(evaluarAperturaActual(disponible("Sa off; Su 00:00-23:59"), GUATEMALA, instante).open_now, false);
  });

  test("un día sin atención está cerrado", () => {
    // Domingo 18, 10:00 en Guatemala.
    assert.equal(evaluarAperturaActual(disponible("Mo-Sa 09:00-18:00; Su off"), GUATEMALA, Date.parse("2026-10-18T16:00:00Z")).estadoApertura, "cerrado");
  });

  test("sin horario publicado o interpretable el estado es desconocido y open_now es null", () => {
    assert.deepEqual(evaluarAperturaActual(NO_PUBLICADO, GUATEMALA, MARTES_10_GT), { estadoApertura: "desconocido", open_now: null, motivo: "no_publicado" });
    assert.deepEqual(evaluarAperturaActual({ estado: "no_interpretable", valorOriginal: "Mo-Fr 9am-5pm", fuente: "geoapify" }, GUATEMALA, MARTES_10_GT), {
      estadoApertura: "desconocido",
      open_now: null,
      motivo: "no_interpretable",
    });
    assert.deepEqual(evaluarAperturaActual({ estado: "error_consulta", valorOriginal: null, fuente: "geoapify" }, GUATEMALA, MARTES_10_GT), {
      estadoApertura: "desconocido",
      open_now: null,
      motivo: "error_consulta",
    });
    assert.deepEqual(evaluarAperturaActual(disponible("Mo-Fr 09:00-17:00 unknown"), GUATEMALA, MARTES_10_GT), {
      estadoApertura: "desconocido",
      open_now: null,
      motivo: "estado_desconocido",
    });
  });

  test("sin una zona horaria IANA válida no afirma que el lugar esté abierto", () => {
    for (const zona of [null, "", "-06:00", "Zona/Inexistente"]) {
      assert.deepEqual(evaluarAperturaActual(disponible("24/7"), zona, MARTES_10_GT), {
        estadoApertura: "desconocido",
        open_now: null,
        motivo: "zona_horaria_desconocida",
      });
    }
    assert.equal(evaluarAperturaActual(NO_PUBLICADO, null, MARTES_10_GT).estadoApertura, "desconocido");
  });

  test("el resultado no depende de la zona horaria del servidor", () => {
    const horario = disponible("Mo-Fr 09:00-17:00");
    for (const zonaServidor of ZONAS_DEL_SERVIDOR) {
      conZonaDelServidor(zonaServidor, () => {
        assert.deepEqual(evaluarAperturaActual(horario, GUATEMALA, MARTES_10_GT), {
          estadoApertura: "abierto",
          open_now: true,
          cierreEstimado: "2026-10-13T17:00-06:00",
        });
        // El mismo instante es miércoles 01:00 en Tokio.
        assert.equal(evaluarAperturaActual(horario, "Asia/Tokyo", MARTES_10_GT).open_now, false);
      });
    }
  });

  test("aplica el horario de verano de la zona del lugar", () => {
    const horario = disponible("Mo-Su 09:00-17:00");
    conZonaDelServidor("UTC", () => {
      // 13:30 UTC es 08:30 en Nueva York antes del cambio (UTC-5) y 09:30 después (UTC-4).
      assert.equal(evaluarAperturaActual(horario, "America/New_York", Date.parse("2026-03-06T13:30:00Z")).open_now, false);
      assert.deepEqual(evaluarAperturaActual(horario, "America/New_York", Date.parse("2026-03-09T13:30:00Z")), {
        estadoApertura: "abierto",
        open_now: true,
        cierreEstimado: "2026-03-09T17:00-04:00",
      });
    });
  });
});

describe("zonaHorariaDeDetalles", () => {
  test("toma timezone.name solo si es una zona IANA válida", () => {
    assert.equal(zonaHorariaDeDetalles({ timezone: { name: GUATEMALA, offset_STD: "-06:00" } }), GUATEMALA);
    for (const timezone of [undefined, null, "America/Guatemala", { name: "-06:00" }, { name: 5 }, { offset_STD: "-06:00" }, { name: "No/Existe" }]) {
      assert.equal(zonaHorariaDeDetalles({ timezone }), null);
    }
  });
});

// ---------------------------------------------------------------------------
// Caché de horarios
// ---------------------------------------------------------------------------

describe("crearCacheApertura", () => {
  const DATOS: DatosApertura = { horario: disponible("24/7"), zonaHoraria: GUATEMALA };
  const ERROR: DatosApertura = { horario: { estado: "error_consulta", valorOriginal: null, fuente: "geoapify" }, zonaHoraria: null };

  function consultaSimulada(respuestas: Record<string, DatosApertura>) {
    const pedidos: string[][] = [];
    const consultar: ConsultarApertura = async (identificadores) => {
      pedidos.push([...identificadores]);
      return new Map(identificadores.map((id) => [id, respuestas[id] ?? ERROR]));
    };
    return { consultar, pedidos };
  }

  test("reutiliza los horarios vigentes y solo consulta los que faltan", async () => {
    let reloj = 0;
    const { consultar, pedidos } = consultaSimulada({ a: DATOS, b: DATOS });
    const conCache = crearCacheApertura({ consultar, vigenciaMs: 1000, ahora: () => new Date(reloj) });

    await conCache(["a"]);
    reloj = 500;
    const resultado = await conCache(["a", "b", "a"]);

    assert.deepEqual(pedidos, [["a"], ["b"]]);
    assert.deepEqual([...resultado.keys()], ["a", "b"]);
  });

  test("vuelve a consultar cuando la entrada expira", async () => {
    let reloj = 0;
    const { consultar, pedidos } = consultaSimulada({ a: DATOS });
    const conCache = crearCacheApertura({ consultar, vigenciaMs: 1000, ahora: () => new Date(reloj) });

    await conCache(["a"]);
    reloj = 1000;
    await conCache(["a"]);

    assert.deepEqual(pedidos, [["a"], ["a"]]);
  });

  test("no guarda los fallos de consulta", async () => {
    const { consultar, pedidos } = consultaSimulada({});
    const conCache = crearCacheApertura({ consultar, vigenciaMs: 1000, ahora: () => new Date(0) });

    await conCache(["x"]);
    await conCache(["x"]);

    assert.deepEqual(pedidos, [["x"], ["x"]]);
  });

  test("respeta el máximo de entradas descartando la más antigua", async () => {
    const { consultar, pedidos } = consultaSimulada({ a: DATOS, b: DATOS, c: DATOS });
    const conCache = crearCacheApertura({ consultar, vigenciaMs: 10_000, maxEntradas: 2, ahora: () => new Date(0) });

    await conCache(["a", "b", "c"]);
    await conCache(["a", "b", "c"]);

    assert.deepEqual(pedidos, [["a", "b", "c"], ["a"]]);
  });
});

// ---------------------------------------------------------------------------
// Endpoint GET /api/lugares/abiertos-ahora
// ---------------------------------------------------------------------------

interface CuerpoError {
  error: { codigo: string; mensaje: string; detalles?: { parametro: string; mensaje: string }[] };
}

interface Resultado<T> {
  estado: number;
  texto: string;
  cuerpo: T;
}

interface DatosLugarSimulado {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  categorias?: string[];
  horario?: string;
  zona?: string | null;
  detalles?: "error" | "colgado";
}

type RespuestaPlaces = (opciones?: RequestInit) => Response | Promise<Response>;

let reloj = MARTES_10_GT;
let lugaresSimulados: DatosLugarSimulado[] = [];
let responderPlaces: RespuestaPlaces | null = null;
let llamadasPlaces: URL[] = [];
let llamadasDetalles: string[] = [];
let servidor: Server;
let baseUrl: string;

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

function featurePlaces(lugar: DatosLugarSimulado) {
  return {
    type: "Feature",
    properties: {
      place_id: lugar.id,
      name: lugar.nombre,
      formatted: `${lugar.nombre}, Ciudad de Guatemala`,
      lat: lugar.lat,
      lon: lugar.lng,
      categories: lugar.categorias ?? ["tourism", "tourism.attraction"],
    },
    geometry: { type: "Point", coordinates: [lugar.lng, lugar.lat] },
  };
}

function respuestaDetalles(lugar: DatosLugarSimulado): Record<string, unknown> {
  const propiedades: Record<string, unknown> = { feature_type: "details", place_id: lugar.id, name: lugar.nombre };
  if (lugar.horario !== undefined) {
    propiedades.opening_hours = lugar.horario;
  }
  const zona = lugar.zona === undefined ? GUATEMALA : lugar.zona;
  if (zona !== null) {
    propiedades.timezone = { name: zona, offset_STD: "-06:00", offset_STD_seconds: -21600 };
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: propiedades }] };
}

async function simularFetch(url: string | URL, opciones?: RequestInit): Promise<Response> {
  const direccion = new URL(url);
  if (direccion.pathname === "/v2/place-details") {
    const id = direccion.searchParams.get("id") ?? "";
    llamadasDetalles.push(id);
    const lugar = lugaresSimulados.find((candidato) => candidato.id === id);
    if (!lugar || lugar.detalles === "error") {
      return respuestaJson({ message: "error" }, 500);
    }
    if (lugar.detalles === "colgado") {
      const senal = opciones?.signal;
      return new Promise<Response>((_resolve, reject) => {
        senal?.addEventListener("abort", () => reject(senal.reason));
      });
    }
    return respuestaJson(respuestaDetalles(lugar));
  }
  llamadasPlaces.push(direccion);
  if (responderPlaces) {
    return responderPlaces(opciones);
  }
  return respuestaJson({ type: "FeatureCollection", features: lugaresSimulados.map(featurePlaces) });
}

// Desplazamientos en latitud: 0.001° son unos 111 m.
const CERCA_ABIERTO: DatosLugarSimulado = { id: "abierto-cerca", nombre: "Museo Abierto", lat: 14.6359, lng: -90.5069, horario: "Mo-Su 08:00-18:00" };
const LEJOS_ABIERTO: DatosLugarSimulado = { id: "abierto-lejos", nombre: "Mirador 24 horas", lat: 14.6449, lng: -90.5069, horario: "24/7" };
const CERRADO: DatosLugarSimulado = { id: "cerrado", nombre: "Teatro Nocturno", lat: 14.6369, lng: -90.5069, horario: "Mo-Su 18:00-22:00" };
const SIN_HORARIO: DatosLugarSimulado = { id: "sin-horario", nombre: "Plaza sin horario", lat: 14.6352, lng: -90.5069 };
const NO_INTERPRETABLE: DatosLugarSimulado = { id: "no-interpretable", nombre: "Galería", lat: 14.6353, lng: -90.5069, horario: "Mo-Fr 9am-5pm" };
const SIN_ZONA: DatosLugarSimulado = { id: "sin-zona", nombre: "Parque sin zona", lat: 14.6354, lng: -90.5069, horario: "24/7", zona: null };
const ERROR_DETALLES: DatosLugarSimulado = { id: "error-detalles", nombre: "Sitio con error", lat: 14.6355, lng: -90.5069, horario: "24/7", detalles: "error" };
const FUERA_DE_RADIO: DatosLugarSimulado = { id: "fuera-radio", nombre: "Lejano 24 horas", lat: 14.6649, lng: -90.5069, horario: "24/7" };

async function consultar<T = RespuestaLugaresAbiertosAhora>(ruta: string): Promise<Resultado<T>> {
  const respuesta = await fetch(`${baseUrl}${ruta}`);
  const texto = await respuesta.text();
  return { estado: respuesta.status, texto, cuerpo: JSON.parse(texto) as T };
}

function ruta(parametros: Record<string, string> = {}): string {
  return `/api/lugares/abiertos-ahora?${new URLSearchParams({ lat: String(ORIGEN.lat), lng: String(ORIGEN.lng), ...parametros })}`;
}

function verificarError(resultado: Resultado<CuerpoError>, estado: number, codigo: string): void {
  assert.equal(resultado.estado, estado);
  assert.equal(resultado.cuerpo.error.codigo, codigo);
  assert.equal(typeof resultado.cuerpo.error.mensaje, "string");
  assert.ok(!resultado.texto.includes(CLAVE));
}

before(async () => {
  const app = crearApp({
    apiKey: CLAVE,
    tiempoEsperaMs: 200,
    detalles: { tiempoEsperaMs: 50, intervaloMs: 0, presupuestoMs: 1000 },
    abiertosAhora: { ahora: () => new Date(reloj), vigenciaCacheMs: 0 },
    fetch: simularFetch,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  servidor = app.server;
  baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

beforeEach(() => {
  reloj = MARTES_10_GT;
  lugaresSimulados = [];
  responderPlaces = null;
  llamadasPlaces = [];
  llamadasDetalles = [];
});

describe("GET /api/lugares/abiertos-ahora - filtro", () => {
  test("devuelve solo los lugares abiertos, ordenados por cercanía y con el contrato completo", async () => {
    lugaresSimulados = [LEJOS_ABIERTO, CERRADO, SIN_HORARIO, NO_INTERPRETABLE, SIN_ZONA, ERROR_DETALLES, CERCA_ABIERTO];

    const resultado = await consultar(ruta());

    assert.equal(resultado.estado, 200);
    const cuerpo = resultado.cuerpo;
    assert.deepEqual(
      cuerpo.lugares.map((lugar) => lugar.idExterno),
      ["abierto-cerca", "abierto-lejos"],
    );
    assert.equal(cuerpo.evaluadoEn, "2026-10-13T16:00:00.000Z");
    assert.equal(cuerpo.criterio, "horarios_publicados");
    assert.deepEqual(cuerpo.origen, ORIGEN);
    assert.equal(cuerpo.radioMetros, 2000);
    assert.equal(cuerpo.limite, 10);
    assert.equal(cuerpo.total, 2);
    assert.equal(cuerpo.categoriasPredeterminadas, true);
    assert.deepEqual(cuerpo.categorias, [...CATEGORIAS_TURISTICAS_PREDETERMINADAS]);
    assert.deepEqual(cuerpo.cobertura, {
      candidatosEvaluados: 7,
      limiteCandidatos: 30,
      busquedaLimitada: false,
      abiertos: 2,
      cerrados: 1,
      desconocidos: 4,
      desconocidosPorMotivo: { no_publicado: 1, no_interpretable: 1, zona_horaria_desconocida: 1, error_consulta: 1 },
    });

    const esperado: LugarAbiertoAhora = {
      idExterno: "abierto-cerca",
      proveedor: "geoapify",
      nombre: "Museo Abierto",
      direccion: "Museo Abierto, Ciudad de Guatemala",
      lat: 14.6359,
      lng: -90.5069,
      categorias: ["tourism", "tourism.attraction"],
      tipo_entorno: cuerpo.lugares[0].tipo_entorno,
      sensibilidad_clima: cuerpo.lugares[0].sensibilidad_clima,
      regla_clima: cuerpo.lugares[0].regla_clima,
      horario: { estado: "disponible", valorOriginal: "Mo-Su 08:00-18:00", fuente: "geoapify" },
      open_now: true,
      estadoApertura: "abierto",
      evaluadoEn: "2026-10-13T16:00:00.000Z",
      zonaHoraria: GUATEMALA,
      horaLocalEvaluacion: "2026-10-13T10:00-06:00",
      cierreEstimado: "2026-10-13T18:00-06:00",
      distanciaMetros: 111,
    };
    assert.deepEqual(cuerpo.lugares[0], esperado);
    assert.equal(cuerpo.lugares[1].cierreEstimado, null);
    assert.ok(cuerpo.lugares.every((lugar) => lugar.open_now === true && lugar.estadoApertura === "abierto"));
  });

  test("usa las categorías turísticas predeterminadas, el radio de 2000 m y un límite de candidatos acotado", async () => {
    await consultar(ruta());

    assert.equal(llamadasPlaces.length, 1);
    const [url] = llamadasPlaces;
    assert.equal(url.searchParams.get("categories"), CATEGORIAS_TURISTICAS_PREDETERMINADAS.join(","));
    assert.equal(url.searchParams.get("filter"), "circle:-90.5069,14.6349,2000");
    assert.equal(url.searchParams.get("bias"), "proximity:-90.5069,14.6349");
    assert.equal(url.searchParams.get("limit"), "30");
  });

  test("reutiliza las reglas de categoria e intereses de /api/lugares", async () => {
    await consultar(ruta({ categoria: "entertainment.museum", intereses: " cultura ,Arte", radio: "1500", limite: "4" }));

    const [url] = llamadasPlaces;
    assert.equal(
      url.searchParams.get("categories"),
      "entertainment.museum,entertainment.culture,entertainment.culture.gallery,entertainment.culture.arts_centre,tourism.attraction.artwork,commercial.art",
    );
    assert.equal(url.searchParams.get("filter"), "circle:-90.5069,14.6349,1500");
    assert.equal(url.searchParams.get("limit"), "12");
  });

  test("respeta el límite de resultados abiertos", async () => {
    lugaresSimulados = Array.from({ length: 5 }, (_, indice) => ({
      id: `p${indice}`,
      nombre: `Lugar ${indice}`,
      lat: 14.6349 + (5 - indice) * 0.001,
      lng: -90.5069,
      horario: "24/7",
    }));

    const resultado = await consultar(ruta({ limite: "2" }));

    assert.equal(llamadasPlaces[0].searchParams.get("limit"), "6");
    assert.deepEqual(resultado.cuerpo.lugares.map((lugar) => lugar.idExterno), ["p4", "p3"]);
    assert.equal(resultado.cuerpo.total, 2);
    assert.equal(resultado.cuerpo.cobertura.abiertos, 5);
  });

  test("excluye los lugares fuera del radio aunque el proveedor los devuelva", async () => {
    lugaresSimulados = [CERCA_ABIERTO, FUERA_DE_RADIO];

    const resultado = await consultar(ruta());

    assert.deepEqual(resultado.cuerpo.lugares.map((lugar) => lugar.idExterno), ["abierto-cerca"]);
    assert.equal(resultado.cuerpo.cobertura.candidatosEvaluados, 1);
    assert.ok(!llamadasDetalles.includes("fuera-radio"));
  });

  test("no devuelve duplicados ni consulta dos veces el mismo lugar", async () => {
    lugaresSimulados = [CERCA_ABIERTO, CERCA_ABIERTO, LEJOS_ABIERTO];

    const resultado = await consultar(ruta());

    assert.deepEqual(resultado.cuerpo.lugares.map((lugar) => lugar.idExterno), ["abierto-cerca", "abierto-lejos"]);
    assert.deepEqual([...llamadasDetalles].sort(), ["abierto-cerca", "abierto-lejos"]);
  });

  test("indica que la búsqueda quedó limitada cuando el proveedor llena el cupo de candidatos", async () => {
    lugaresSimulados = Array.from({ length: 3 }, (_, indice) => ({ id: `c${indice}`, nombre: `Cerrado ${indice}`, lat: 14.635 + indice * 0.0001, lng: -90.5069, horario: "Mo-Su 20:00-22:00" }));

    const resultado = await consultar(ruta({ limite: "1" }));

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo.lugares, []);
    assert.equal(resultado.cuerpo.cobertura.busquedaLimitada, true);
    assert.equal(resultado.cuerpo.cobertura.cerrados, 3);
  });

  test("reutiliza los horarios en caché y recalcula open_now con el reloj actual", async () => {
    lugaresSimulados = [CERCA_ABIERTO];
    const app = crearApp({
      apiKey: CLAVE,
      detalles: { tiempoEsperaMs: 50, intervaloMs: 0, presupuestoMs: 1000 },
      abiertosAhora: { ahora: () => new Date(reloj) },
      fetch: simularFetch,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const pedir = async () => (await (await fetch(`${base}${ruta()}`)).json()) as RespuestaLugaresAbiertosAhora;
    try {
      // 17:50 en Guatemala, diez minutos antes del cierre.
      reloj = Date.parse("2026-10-13T23:50:00Z");
      const abierto = await pedir();
      // 18:05: el museo ya cerró y la caché de 30 minutos sigue vigente.
      reloj = Date.parse("2026-10-14T00:05:00Z");
      const cerrado = await pedir();

      assert.deepEqual(abierto.lugares.map((lugar) => [lugar.idExterno, lugar.cierreEstimado]), [["abierto-cerca", "2026-10-13T18:00-06:00"]]);
      assert.deepEqual(cerrado.lugares, []);
      assert.equal(cerrado.cobertura.cerrados, 1);
      assert.equal(cerrado.evaluadoEn, "2026-10-14T00:05:00.000Z");
      assert.deepEqual(llamadasDetalles, ["abierto-cerca"]);
      assert.equal(llamadasPlaces.length, 2);

      // Pasada la vigencia se vuelve a consultar el horario.
      reloj = Date.parse("2026-10-14T00:40:00Z");
      await pedir();
      assert.deepEqual(llamadasDetalles, ["abierto-cerca", "abierto-cerca"]);
    } finally {
      app.server.closeAllConnections();
      await app.close();
    }
  });
});

describe("GET /api/lugares/abiertos-ahora - respuestas vacías y errores", () => {
  test("sin resultados responde 200 con el contrato completo y sin consultar detalles", async () => {
    const resultado = await consultar(ruta());

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo.lugares, []);
    assert.equal(resultado.cuerpo.total, 0);
    assert.deepEqual(resultado.cuerpo.cobertura, {
      candidatosEvaluados: 0,
      limiteCandidatos: 30,
      busquedaLimitada: false,
      abiertos: 0,
      cerrados: 0,
      desconocidos: 0,
      desconocidosPorMotivo: {},
    });
    assert.equal(llamadasDetalles.length, 0);
  });

  test("si ningún lugar está abierto responde 200 con la lista vacía", async () => {
    lugaresSimulados = [CERRADO, SIN_HORARIO];

    const resultado = await consultar(ruta());

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo.lugares, []);
    assert.equal(resultado.cuerpo.cobertura.cerrados, 1);
    assert.equal(resultado.cuerpo.cobertura.desconocidos, 1);
  });

  test("el tiempo agotado en Place Details excluye solo ese lugar", async () => {
    lugaresSimulados = [CERCA_ABIERTO, { ...LEJOS_ABIERTO, detalles: "colgado" }];

    const resultado = await consultar(ruta());

    assert.equal(resultado.estado, 200);
    assert.deepEqual(resultado.cuerpo.lugares.map((lugar) => lugar.idExterno), ["abierto-cerca"]);
    assert.deepEqual(resultado.cuerpo.cobertura.desconocidosPorMotivo, { error_consulta: 1 });
  });

  test("si fallan todos los detalles responde 502 en lugar de una lista vacía", async () => {
    lugaresSimulados = [{ ...CERCA_ABIERTO, detalles: "error" }, { ...LEJOS_ABIERTO, detalles: "colgado" }];

    verificarError(await consultar<CuerpoError>(ruta()), 502, "PROVEEDOR_DETALLES_NO_DISPONIBLES");
  });

  test("mantiene los errores de la búsqueda de Geoapify", async () => {
    responderPlaces = () => respuestaJson({ message: "Too Many Requests" }, 429);
    verificarError(await consultar<CuerpoError>(ruta()), 503, "PROVEEDOR_LIMITE_SOLICITUDES");

    responderPlaces = () => respuestaJson({ message: `Invalid apiKey ${CLAVE}` }, 401);
    verificarError(await consultar<CuerpoError>(ruta()), 502, "PROVEEDOR_CREDENCIALES_INVALIDAS");

    responderPlaces = () => respuestaJson({ type: "FeatureCollection" });
    verificarError(await consultar<CuerpoError>(ruta()), 502, "PROVEEDOR_RESPUESTA_INVALIDA");

    responderPlaces = () => {
      throw new TypeError("fetch failed");
    };
    verificarError(await consultar<CuerpoError>(ruta()), 502, "PROVEEDOR_NO_DISPONIBLE");
    assert.equal(llamadasDetalles.length, 0);
  });

  test("el tiempo agotado en la búsqueda produce 504", async () => {
    responderPlaces = (opciones) =>
      new Promise<Response>((_resolve, reject) => {
        const senal = opciones?.signal;
        assert.ok(senal instanceof AbortSignal);
        senal.addEventListener("abort", () => reject(senal.reason));
      });
    verificarError(await consultar<CuerpoError>(ruta()), 504, "PROVEEDOR_TIEMPO_AGOTADO");
  });

  test("sin clave configurada responde 500 sin consultar al proveedor", async () => {
    const app = crearApp({ apiKey: " ", fetch: async () => assert.fail("no debe consultar al proveedor") });
    await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const respuesta = await fetch(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}${ruta()}`);
      assert.equal(respuesta.status, 500);
      assert.equal(((await respuesta.json()) as CuerpoError).error.codigo, "SERVICIO_NO_CONFIGURADO");
    } finally {
      app.server.closeAllConnections();
      await app.close();
    }
  });
});

describe("GET /api/lugares/abiertos-ahora - validación", () => {
  const casos: [descripcion: string, consulta: string, parametro: string][] = [
    ["falta lat", "lng=-90.5", "lat"],
    ["falta lng", "lat=14.6", "lng"],
    ["lat vacía", "lat=&lng=-90.5", "lat"],
    ["lat con texto", "lat=14abc&lng=-90.5", "lat"],
    ["lat NaN", "lat=NaN&lng=-90.5", "lat"],
    ["lat Infinity", "lat=Infinity&lng=-90.5", "lat"],
    ["lat exponencial", "lat=1e1&lng=-90.5", "lat"],
    ["lat fuera de rango", "lat=91&lng=-90.5", "lat"],
    ["lng fuera de rango", "lat=14.6&lng=-180.1", "lng"],
    ["lat repetida", "lat=14.6&lat=15&lng=-90.5", "lat"],
    ["radio cero", "lat=14.6&lng=-90.5&radio=0", "radio"],
    ["radio negativo", "lat=14.6&lng=-90.5&radio=-5", "radio"],
    ["radio mayor al máximo", "lat=14.6&lng=-90.5&radio=10001", "radio"],
    ["radio decimal", "lat=14.6&lng=-90.5&radio=1.5", "radio"],
    ["limite cero", "lat=14.6&lng=-90.5&limite=0", "limite"],
    ["limite mayor al máximo", "lat=14.6&lng=-90.5&limite=21", "limite"],
    ["categoria no admitida", "lat=14.6&lng=-90.5&categoria=commercial.supermarket", "categoria"],
    ["categoria repetida", "lat=14.6&lng=-90.5&categoria=leisure.park&categoria=tourism.sights", "categoria"],
    ["interés desconocido", "lat=14.6&lng=-90.5&intereses=Cultura,Deportes", "intereses"],
    ["interés vacío", "lat=14.6&lng=-90.5&intereses=Cultura,", "intereses"],
    ["parámetro no admitido", "lat=14.6&lng=-90.5&abierto=true", "abierto"],
    ["estructura de objeto", "lat[valor]=14.6&lng=-90.5", "lat"],
  ];

  for (const [descripcion, consulta, parametro] of casos) {
    test(`rechaza ${descripcion} sin consultar a Geoapify`, async () => {
      const resultado = await consultar<CuerpoError>(`/api/lugares/abiertos-ahora?${consulta}`);

      verificarError(resultado, 400, "PARAMETRO_INVALIDO");
      assert.ok(resultado.cuerpo.error.detalles?.some((detalle) => detalle.parametro === parametro), `falta el detalle de ${parametro}`);
      assert.equal(llamadasPlaces.length, 0);
      assert.equal(llamadasDetalles.length, 0);
    });
  }

  test("informa todos los parámetros inválidos a la vez", async () => {
    const resultado = await consultar<CuerpoError>("/api/lugares/abiertos-ahora?lat=abc&radio=0");

    assert.deepEqual(resultado.cuerpo.error.detalles?.map((detalle) => detalle.parametro), ["lat", "lng", "radio"]);
  });
});

describe("compatibilidad de GET /api/lugares", () => {
  test("el endpoint original conserva su contrato sin campos de apertura", async () => {
    lugaresSimulados = [CERCA_ABIERTO];

    const resultado = await consultar<{ lugares: Record<string, unknown>[] }>("/api/lugares?lat=14.6349&lng=-90.5069&categoria=tourism.attraction");

    assert.equal(resultado.estado, 200);
    assert.deepEqual(Object.keys(resultado.cuerpo), ["lugares"]);
    const [lugar] = resultado.cuerpo.lugares;
    assert.deepEqual(lugar.horario, { estado: "disponible", valorOriginal: "Mo-Su 08:00-18:00", fuente: "geoapify" });
    for (const campo of ["open_now", "estadoApertura", "zonaHoraria", "evaluadoEn", "distanciaMetros"]) {
      assert.ok(!(campo in lugar), `no debe incluir ${campo}`);
    }
    assert.equal(llamadasPlaces[0].searchParams.get("limit"), "20");
    assert.equal(llamadasPlaces[0].searchParams.get("filter"), "circle:-90.5069,14.6349,5000");
  });

  test("sin categoria ni intereses sigue respondiendo 400", async () => {
    verificarError(await consultar<CuerpoError>("/api/lugares?lat=14.6&lng=-90.5"), 400, "PARAMETRO_INVALIDO");
  });
});
