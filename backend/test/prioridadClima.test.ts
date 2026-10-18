import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crearApp } from "../src/app";

interface LugarSimulado {
  name: string;
  categories: string[];
  opening_hours: string;
}

interface ParadaRespuesta {
  placeId: string;
  nombre: string;
  lat: number;
  lng: number;
  llegada: string;
  tipo_entorno?: string;
  sensibilidad_clima?: string;
  regla_clima?: string | null;
}

interface DecisionRespuesta {
  numeroDia: number;
  fecha: string;
  estadoPronostico: string;
  lluviaMm: number | null;
  prioridadAplicada: boolean;
  ordenModificado: boolean;
  motivo: string;
  mensaje: string;
}

interface PlanRespuesta {
  viable: boolean;
  itinerarios: { numeroDia: number; fecha: string; paradas: ParadaRespuesta[] }[];
  descartes: { numeroDia: number; placeId: string; nombre: string; motivo: string; llegada: string | null }[];
  diasSinParadas: { numeroDia: number; fecha: string }[];
  errores: string[];
  clima: {
    fuente: string;
    ubicacion: { lat: number; lng: number };
    consulta: { estado: string; codigo?: string; mensaje?: string };
    dias: DecisionRespuesta[];
  };
}

interface CuerpoError {
  error: { codigo: string; mensaje: string; detalles?: { parametro: string; mensaje: string }[] };
}

type ParadaPropuesta = string | [placeId: string, tiempoEstanciaMinutos: number, extra?: Record<string, unknown>];

const CLAVE_GEO = "clave-geo-de-prueba-no-real-prioridad";
const CLAVE_CLIMA = "clave-clima-de-prueba-no-real-prioridad";
const RUTA = "/api/itinerarios/priorizar-clima";
const DESTINO = { lat: 14.6349, lng: -90.5069 };
const DESPLAZAMIENTO_GUATEMALA = -21600;
const HORA_MS = 3600 * 1000;

const LUGARES: Record<string, LugarSimulado> = {
  "geo-parque": { name: "Parque real", categories: ["leisure", "leisure.park"], opening_hours: "Mo-Su 06:00-20:00" },
  "geo-museo": { name: "Museo real", categories: ["building", "entertainment", "entertainment.museum"], opening_hours: "Mo-Su 08:00-20:00" },
  "geo-mercado-matutino": { name: "Mercado matutino", categories: ["commercial", "commercial.marketplace"], opening_hours: "Mo-Su 08:00-10:00" },
  "geo-galeria-temprana": {
    name: "Galería de la mañana",
    categories: ["entertainment", "entertainment.culture", "entertainment.culture.gallery"],
    opening_hours: "Mo-Su 09:00-10:00",
  },
  "geo-mirador": { name: "Mirador real", categories: ["tourism", "tourism.attraction", "tourism.attraction.viewpoint"], opening_hours: "Mo-Su 06:00-18:00" },
  "geo-cafe": { name: "Café real", categories: ["catering", "catering.cafe"], opening_hours: "Mo-Su 07:00-19:00" },
  "geo-playa": { name: "Playa real", categories: ["beach"], opening_hours: "Mo-Su 06:00-18:00" },
  "geo-galeria": { name: "Galería real", categories: ["entertainment.culture.gallery"], opening_hours: "Mo-Su 09:00-18:00" },
};

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

function detalles(id: string) {
  const lugar = LUGARES[id];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          feature_type: "details",
          place_id: `${id}-codificado-distinto`,
          name: lugar.name,
          formatted: `Dirección de ${lugar.name}`,
          lat: 14.6,
          lon: -90.5,
          categories: lugar.categories,
          opening_hours: lugar.opening_hours,
        },
      },
    ],
  };
}

function serie(inicioIso: string, cantidad: number, lluvia: (indice: number) => number | undefined = () => undefined) {
  const inicio = Date.parse(inicioIso);
  return Array.from({ length: cantidad }, (_, indice) => {
    const registro: Record<string, unknown> = { dt: (inicio + indice * 3 * HORA_MS) / 1000, main: { temp: 20 } };
    const mm = lluvia(indice);
    if (mm !== undefined) {
      registro.rain = { "3h": mm };
    }
    return registro;
  });
}

function pronostico(list: unknown[]) {
  return { cod: "200", list, city: { name: "Prueba", timezone: DESPLAZAMIENTO_GUATEMALA } };
}

const LLUVIA_DIA_1_SECO_DIA_2 = () => respuestaJson(pronostico(serie("2026-10-13T06:00:00Z", 16, (i) => (i === 3 ? 0.6 : undefined))));
const LLUVIA_TODO = () => respuestaJson(pronostico(serie("2026-10-13T06:00:00Z", 16, () => 0.5)));
const SECO_TODO = () => respuestaJson(pronostico(serie("2026-10-13T06:00:00Z", 16)));

function cuerpo(dias: ParadaPropuesta[][], extra: Record<string, unknown> = {}) {
  return {
    viaje: {
      id: "viaje-clima",
      fechaInicio: "2026-10-13",
      fechaFin: `2026-10-${String(12 + dias.length).padStart(2, "0")}`,
      zonaHoraria: "America/Guatemala",
    },
    destino: DESTINO,
    propuesta: {
      dias: dias.map((paradas, i) => ({
        numeroDia: i + 1,
        paradas: paradas.map((parada) => {
          const [placeId, tiempoEstanciaMinutos, adicional = {}] = typeof parada === "string" ? [parada, 60] : parada;
          return { placeId, tiempoEstanciaMinutos, ...adicional };
        }),
      })),
    },
    ...extra,
  };
}

describe("POST /api/itinerarios/priorizar-clima", () => {
  let servidor: Server;
  let baseUrl: string;
  let consultasDetalles: string[];
  let consultasClima: URL[];
  let responderClima: () => Response | Promise<Response>;

  before(async () => {
    const app = crearApp({
      apiKey: CLAVE_GEO,
      detalles: { tiempoEsperaMs: 200, intervaloMs: 0, presupuestoMs: 2000 },
      fetch: async (url) => {
        const direccion = new URL(url);
        assert.equal(direccion.pathname, "/v2/place-details");
        const id = direccion.searchParams.get("id") ?? "";
        consultasDetalles.push(id);
        return LUGARES[id] ? respuestaJson(detalles(id)) : respuestaJson({ type: "FeatureCollection", features: [] });
      },
      clima: {
        apiKey: CLAVE_CLIMA,
        tiempoEsperaMs: 200,
        fetch: async (url) => {
          consultasClima.push(new URL(url));
          return responderClima();
        },
      },
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
    consultasDetalles = [];
    consultasClima = [];
    responderClima = LLUVIA_DIA_1_SECO_DIA_2;
  });

  async function enviar<T = PlanRespuesta>(datos: unknown, ruta = RUTA): Promise<{ estado: number; texto: string; cuerpo: T }> {
    const respuesta = await fetch(`${baseUrl}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof datos === "string" ? datos : JSON.stringify(datos),
    });
    const texto = await respuesta.text();
    return { estado: respuesta.status, texto, cuerpo: JSON.parse(texto) as T };
  }

  function placeIds(plan: PlanRespuesta, numeroDia: number): string[] {
    return plan.itinerarios.find((it) => it.numeroDia === numeroDia)?.paradas.map((p) => p.placeId) ?? [];
  }

  test("clasifica cada parada y, con lluvia, devuelve indoor–outdoor; sin lluvia conserva el orden", async () => {
    const { estado, cuerpo: plan } = await enviar(cuerpo([["geo-parque", "geo-museo"], ["geo-mirador", "geo-cafe"]]));

    assert.equal(estado, 200);
    assert.equal(plan.viable, true);
    assert.deepEqual(placeIds(plan, 1), ["geo-museo", "geo-parque"]);
    assert.deepEqual(placeIds(plan, 2), ["geo-mirador", "geo-cafe"]);
    assert.deepEqual(
      plan.itinerarios.flatMap((it) => it.paradas.map((p) => [p.placeId, p.tipo_entorno, p.sensibilidad_clima, p.regla_clima])),
      [
        ["geo-museo", "indoor", "baja", "entertainment.museum"],
        ["geo-parque", "outdoor", "alta", "leisure.park"],
        ["geo-mirador", "outdoor", "alta", "tourism.attraction.viewpoint"],
        ["geo-cafe", "indoor", "baja", "catering.cafe"],
      ],
    );
    assert.equal(plan.clima.fuente, "openweathermap");
    assert.deepEqual(plan.clima.ubicacion, DESTINO);
    assert.deepEqual(plan.clima.consulta, { estado: "completada" });
    assert.deepEqual(
      plan.clima.dias.map((d) => [d.numeroDia, d.fecha, d.estadoPronostico, d.lluviaMm, d.prioridadAplicada, d.ordenModificado, d.motivo]),
      [
        [1, "2026-10-13", "disponible", 0.6, true, true, "lluvia_pronosticada"],
        [2, "2026-10-14", "disponible", 0, false, false, "sin_lluvia_pronosticada"],
      ],
    );
    assert.ok(plan.clima.dias.every((d) => d.mensaje.length > 0));
  });

  test("consulta el clima una sola vez por operación y cada lugar una sola vez", async () => {
    await enviar(cuerpo([["geo-parque", "geo-museo"], ["geo-mirador", "geo-cafe"]]));

    assert.equal(consultasClima.length, 1);
    const consulta = consultasClima[0];
    assert.equal(consulta.searchParams.get("lat"), String(DESTINO.lat));
    assert.equal(consulta.searchParams.get("lon"), String(DESTINO.lng));
    assert.deepEqual([...consultasDetalles].sort(), ["geo-cafe", "geo-mirador", "geo-museo", "geo-parque"]);
  });

  test("asocia el pronóstico a la fecha local de cada día: parcial sin lluvia, fuera de cobertura y lluvia", async () => {
    responderClima = () =>
      respuestaJson(pronostico(serie("2026-10-13T06:00:00Z", 11, (i) => (i < 8 ? 0.3 : undefined))));

    const { cuerpo: plan } = await enviar(cuerpo([["geo-parque", "geo-museo"], ["geo-mirador", "geo-cafe"], ["geo-playa", "geo-galeria"]]));

    assert.deepEqual(placeIds(plan, 1), ["geo-museo", "geo-parque"]);
    assert.deepEqual(placeIds(plan, 2), ["geo-mirador", "geo-cafe"]);
    assert.deepEqual(placeIds(plan, 3), ["geo-playa", "geo-galeria"]);
    assert.deepEqual(
      plan.clima.dias.map((d) => [d.fecha, d.estadoPronostico, d.lluviaMm, d.prioridadAplicada, d.motivo]),
      [
        ["2026-10-13", "disponible", 2.4, true, "lluvia_pronosticada"],
        ["2026-10-14", "parcial", 0, false, "sin_lluvia_en_cobertura_parcial"],
        ["2026-10-15", "fuera_de_cobertura", null, false, "pronostico_fuera_de_cobertura"],
      ],
    );
    assert.equal(consultasClima.length, 1);
  });

  test("una serie vacía marca los días sin datos y conserva el orden", async () => {
    responderClima = () => respuestaJson(pronostico([]));

    const { cuerpo: plan } = await enviar(cuerpo([["geo-parque", "geo-museo"]]));

    assert.deepEqual(placeIds(plan, 1), ["geo-parque", "geo-museo"]);
    assert.deepEqual(
      plan.clima.dias.map((d) => [d.estadoPronostico, d.lluviaMm, d.prioridadAplicada, d.motivo]),
      [["sin_datos", null, false, "pronostico_sin_datos"]],
    );
  });

  test("valida los horarios sobre el nuevo orden y excluye la visita que queda cerrada", async () => {
    responderClima = LLUVIA_TODO;

    const priorizado = await enviar(cuerpo([[["geo-mercado-matutino", 60], ["geo-museo", 120]]]));
    const original = await enviar(cuerpo([[["geo-mercado-matutino", 60], ["geo-museo", 120]]]), "/api/itinerarios/validar");

    assert.deepEqual(placeIds(original.cuerpo, 1), ["geo-mercado-matutino", "geo-museo"]);
    assert.deepEqual(original.cuerpo.descartes, []);

    const plan = priorizado.cuerpo;
    assert.equal(plan.clima.dias[0].prioridadAplicada, true);
    assert.deepEqual(placeIds(plan, 1), ["geo-museo"]);
    assert.equal(plan.itinerarios[0].paradas[0].llegada, "2026-10-13T09:00-06:00");
    assert.deepEqual(
      plan.descartes.map((d) => [d.placeId, d.nombre, d.motivo, d.llegada]),
      [["geo-mercado-matutino", "Mercado matutino", "cerrado", "2026-10-13T11:20-06:00"]],
    );
  });

  test("el nuevo orden puede volver viable una visita y la llegada se recalcula desde la parada anterior", async () => {
    responderClima = LLUVIA_TODO;

    const { cuerpo: plan } = await enviar(cuerpo([[["geo-parque", 60], ["geo-galeria-temprana", 45]]]));

    assert.deepEqual(placeIds(plan, 1), ["geo-galeria-temprana", "geo-parque"]);
    assert.deepEqual(plan.itinerarios[0].paradas.map((p) => p.llegada), ["2026-10-13T09:00-06:00", "2026-10-13T10:05-06:00"]);
    assert.deepEqual(plan.descartes, []);
  });

  test("conserva la respuesta explícita de un día que queda sin paradas", async () => {
    responderClima = LLUVIA_TODO;

    const datos = cuerpo([["geo-museo"], ["geo-mercado-matutino", "geo-galeria-temprana"]]);
    const { cuerpo: plan } = await enviar({ ...datos, viaje: { ...datos.viaje, horaInicio: "12:00" } });

    assert.equal(plan.viable, false);
    assert.deepEqual(plan.itinerarios.map((it) => it.numeroDia), [1]);
    assert.deepEqual(plan.diasSinParadas, [{ numeroDia: 2, fecha: "2026-10-14" }]);
    assert.deepEqual(plan.descartes.map((d) => [d.placeId, d.motivo]), [
      ["geo-galeria-temprana", "cerrado"],
      ["geo-mercado-matutino", "cerrado"],
    ]);
    assert.ok(plan.errores.some((error) => error.includes("día 2")));
    assert.equal(plan.clima.dias[1].prioridadAplicada, true);
  });

  test("ignora clasificaciones, pronósticos y datos de establecimientos enviados por el cliente", async () => {
    responderClima = LLUVIA_TODO;
    const falsos = { tipo_entorno: "indoor", sensibilidad_clima: "baja", regla_clima: "entertainment.museum", nombre: "Falso", lat: 0, lng: 0, categorias: ["entertainment.museum"], horario: { estado: "disponible", valorOriginal: "24/7", fuente: "geoapify" } };

    const { cuerpo: plan } = await enviar(
      cuerpo([[["geo-parque", 60, falsos], ["geo-museo", 60, { tipo_entorno: "outdoor", sensibilidad_clima: "alta" }]]], {
        pronostico: { dias: [{ fecha: "2026-10-13", lluviaMm: 0, estado: "disponible" }] },
        clima: { dias: [{ prioridadAplicada: false }] },
      }),
    );

    assert.deepEqual(placeIds(plan, 1), ["geo-museo", "geo-parque"]);
    const parque = plan.itinerarios[0].paradas[1];
    assert.deepEqual([parque.nombre, parque.lat, parque.lng, parque.tipo_entorno, parque.sensibilidad_clima, parque.regla_clima], ["Parque real", 14.6, -90.5, "outdoor", "alta", "leisure.park"]);
    assert.equal(plan.clima.dias[0].lluviaMm, 4);
  });

  test("un pronóstico inventado por el cliente no activa la prioridad cuando OpenWeather no pronostica lluvia", async () => {
    responderClima = SECO_TODO;

    const { cuerpo: plan } = await enviar(
      cuerpo([["geo-parque", "geo-museo"]], { pronostico: { lluviaMm: 50 }, lluviaMm: 50, destino: { ...DESTINO, lluviaMm: 50 } }),
    );

    assert.deepEqual(placeIds(plan, 1), ["geo-parque", "geo-museo"]);
    assert.deepEqual([plan.clima.dias[0].lluviaMm, plan.clima.dias[0].prioridadAplicada], [0, false]);
  });

  test("ante un fallo de OpenWeather conserva el orden, informa el fallo y valida los horarios", async () => {
    const fallos: [descripcion: string, responder: () => Response | Promise<Response>, codigo: string][] = [
      ["error HTTP", () => respuestaJson({ message: `error ${CLAVE_CLIMA}` }, 500), "PROVEEDOR_ERROR"],
      ["fallo de red", () => Promise.reject(new TypeError(`fetch failed appid=${CLAVE_CLIMA}`)), "PROVEEDOR_NO_DISPONIBLE"],
      ["respuesta inválida", () => respuestaJson({ list: "no" }), "PROVEEDOR_RESPUESTA_INVALIDA"],
    ];
    for (const [descripcion, responder, codigo] of fallos) {
      responderClima = responder;

      const { estado, texto, cuerpo: plan } = await enviar(cuerpo([[["geo-parque", 60], ["geo-galeria-temprana", 45]]]));

      assert.equal(estado, 200, descripcion);
      assert.equal(plan.clima.consulta.estado, "fallida", descripcion);
      assert.equal(plan.clima.consulta.codigo, codigo, descripcion);
      assert.equal(typeof plan.clima.consulta.mensaje, "string");
      assert.deepEqual(
        plan.clima.dias.map((d) => [d.estadoPronostico, d.lluviaMm, d.prioridadAplicada, d.motivo]),
        [["error_consulta", null, false, "consulta_clima_fallida"]],
        descripcion,
      );
      assert.deepEqual(placeIds(plan, 1), ["geo-parque"], descripcion);
      assert.deepEqual(plan.descartes.map((d) => [d.placeId, d.motivo]), [["geo-galeria-temprana", "cerrado"]], descripcion);
      assert.equal(plan.itinerarios[0].paradas[0].tipo_entorno, "outdoor");
      assert.ok(!texto.includes(CLAVE_CLIMA) && !texto.includes(CLAVE_GEO) && !texto.includes("appid"), descripcion);
    }
  });

  test("sin clave de OpenWeather continúa con el orden original e informa el servicio no configurado", async () => {
    const app = crearApp({
      apiKey: CLAVE_GEO,
      detalles: { tiempoEsperaMs: 200, intervaloMs: 0, presupuestoMs: 2000 },
      fetch: async (url) => respuestaJson(detalles(new URL(url).searchParams.get("id") ?? "")),
      clima: { apiKey: "", fetch: async () => assert.fail("no debe consultar OpenWeather sin clave") },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const otro: Server = app.server;
    try {
      const respuesta = await fetch(`http://127.0.0.1:${(otro.address() as AddressInfo).port}${RUTA}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo([["geo-parque", "geo-museo"]])),
      });
      const plan = (await respuesta.json()) as PlanRespuesta;

      assert.equal(respuesta.status, 200);
      assert.deepEqual(plan.clima.consulta, { estado: "fallida", codigo: "SERVICIO_NO_CONFIGURADO", mensaje: plan.clima.consulta.mensaje });
      assert.deepEqual(placeIds(plan, 1), ["geo-parque", "geo-museo"]);
    } finally {
      otro.closeAllConnections();
      otro.close();
    }
  });

  test("un lugar que Geoapify no resuelve conserva el tratamiento existente y no detiene la priorización", async () => {
    responderClima = LLUVIA_TODO;

    const { cuerpo: plan } = await enviar(cuerpo([["geo-inexistente", "geo-parque", "geo-museo"]]));

    assert.deepEqual(placeIds(plan, 1), ["geo-museo", "geo-parque"]);
    assert.deepEqual(plan.descartes.map((d) => [d.placeId, d.motivo, d.llegada]), [["geo-inexistente", "error_consulta", null]]);
  });

  test("rechaza entradas inválidas sin consultar a Geoapify ni a OpenWeather", async () => {
    const base = cuerpo([["geo-parque", "geo-museo"]]);
    const { destino: _destino, ...sinDestino } = base;
    const invalidos: [descripcion: string, datos: unknown, parametro: string][] = [
      ["sin destino", sinDestino, "destino"],
      ["latitud fuera de rango", { ...base, destino: { lat: 91, lng: -90.5 } }, "destino.lat"],
      ["longitud fuera de rango", { ...base, destino: { lat: 14.6, lng: -181 } }, "destino.lng"],
      ["latitud como texto", { ...base, destino: { lat: "14.6", lng: -90.5 } }, "destino.lat"],
      ["destino como nombre", { ...base, destino: "Ciudad de Guatemala" }, "destino"],
      ["sin zona horaria", { ...base, viaje: { ...base.viaje, zonaHoraria: undefined } }, "viaje.zonaHoraria"],
      ["fechas invertidas", { ...base, viaje: { ...base.viaje, fechaInicio: "2026-10-14", fechaFin: "2026-10-13" } }, "viaje.fechaFin"],
      ["sin paradas", { ...base, propuesta: { dias: [{ numeroDia: 1, paradas: [] }] } }, "propuesta.dias.0.paradas"],
    ];

    for (const [descripcion, datos, parametro] of invalidos) {
      const { estado, cuerpo: error } = await enviar<CuerpoError>(datos);
      assert.equal(estado, 400, descripcion);
      assert.equal(error.error.codigo, "PARAMETRO_INVALIDO", descripcion);
      assert.ok(error.error.detalles?.some((d) => d.parametro === parametro), `${descripcion}: ${JSON.stringify(error.error.detalles)}`);
    }

    const malformado = await enviar<CuerpoError>("{ no es json");
    assert.equal(malformado.estado, 400);
    assert.deepEqual(consultasDetalles, []);
    assert.deepEqual(consultasClima, []);
  });

  test("POST /api/itinerarios/validar no aplica la prioridad climática ni consulta el clima", async () => {
    responderClima = LLUVIA_TODO;

    const { estado, cuerpo: plan } = await enviar(cuerpo([["geo-parque", "geo-museo"]]), "/api/itinerarios/validar");

    assert.equal(estado, 200);
    assert.deepEqual(placeIds(plan, 1), ["geo-parque", "geo-museo"]);
    assert.equal(plan.clima, undefined);
    assert.equal(plan.itinerarios[0].paradas[0].tipo_entorno, undefined);
    assert.deepEqual(consultasClima, []);
  });
});
