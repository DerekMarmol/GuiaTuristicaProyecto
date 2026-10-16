import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crearApp } from "../src/app";

interface LugarSimulado {
  name: string;
  lat: number;
  lon: number;
  opening_hours?: string;
}

interface HorarioRespuesta {
  estado: string;
  valorOriginal: string | null;
  fuente: string;
}

interface ParadaRespuesta {
  id: string;
  placeId: string;
  nombre: string;
  lat: number;
  lng: number;
  direccion: string | null;
  horario: HorarioRespuesta;
  llegada: string;
  traslado: { tiempoTotalConHolgura: number; estimado: boolean };
}

interface DescarteRespuesta {
  numeroDia: number;
  fecha: string;
  placeId: string;
  nombre: string;
  motivo: string;
  mensaje: string;
  llegada?: string;
  horario: HorarioRespuesta;
}

interface PlanRespuesta {
  viable: boolean;
  zonaHoraria: string;
  itinerarios: { numeroDia: number; paradas: ParadaRespuesta[] }[];
  descartes: DescarteRespuesta[];
  diasSinParadas: { numeroDia: number; fecha: string }[];
}

interface CuerpoError {
  error: { codigo: string; mensaje: string; detalles?: { parametro: string; mensaje: string }[] };
}

type ParadaPropuesta = [placeId: string, tiempoEstanciaMinutos: number, extra?: Record<string, unknown>];

interface CuerpoPropuesta {
  viaje: { id: string; fechaInicio: string; fechaFin: string; zonaHoraria?: string; horaInicio?: string };
  propuesta: { dias: { numeroDia: number; paradas: Record<string, unknown>[] }[] };
}

const CLAVE = "clave-de-prueba-no-real-789";
const RUTA = "/api/itinerarios/validar";

const LUGARES: Record<string, LugarSimulado> = {
  "geo-museo": { name: "Museo real", lat: 14.6, lon: -90.5, opening_hours: "Mo-Su 08:00-20:00" },
  "geo-cerrado-temprano": { name: "Mercado matutino", lat: 14.656, lon: -90.5, opening_hours: "Mo-Su 08:00-10:00" },
  "geo-parque": { name: "Parque real", lat: 14.656, lon: -90.5, opening_hours: "Mo-Su 06:00-20:00" },
  "geo-sin-horario": { name: "Mirador sin horario", lat: 14.6, lon: -90.5 },
  "geo-domingo": { name: "Galería", lat: 14.6, lon: -90.5, opening_hours: "Mo-Sa 09:00-18:00; Su off" },
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
          lat: lugar.lat,
          lon: lugar.lon,
          categories: ["tourism", "tourism.sights"],
          ...(lugar.opening_hours ? { opening_hours: lugar.opening_hours } : {}),
        },
        geometry: { type: "Point", coordinates: [lugar.lon, lugar.lat] },
      },
      {
        type: "Feature",
        properties: { feature_type: "building", place_id: "edificio", opening_hours: "24/7" },
        geometry: { type: "Point", coordinates: [lugar.lon, lugar.lat] },
      },
    ],
  };
}

function cuerpo(dias: ParadaPropuesta[][], viaje: Partial<CuerpoPropuesta["viaje"]> = {}): CuerpoPropuesta {
  return {
    viaje: { id: "viaje-1", fechaInicio: "2026-10-13", fechaFin: "2026-10-13", zonaHoraria: "America/Guatemala", ...viaje },
    propuesta: {
      dias: dias.map((paradas, i) => ({
        numeroDia: i + 1,
        paradas: paradas.map(([placeId, tiempoEstanciaMinutos, extra = {}]) => ({ placeId, tiempoEstanciaMinutos, ...extra })),
      })),
    },
  };
}

describe("POST /api/itinerarios/validar", () => {
  let servidor: Server;
  let baseUrl: string;
  let consultas: (string | null)[];

  before(async () => {
    const app = crearApp({
      apiKey: CLAVE,
      detalles: { tiempoEsperaMs: 200, intervaloMs: 0, presupuestoMs: 2000 },
      fetch: async (url) => {
        const direccion = new URL(url);
        assert.equal(direccion.pathname, "/v2/place-details");
        const id = direccion.searchParams.get("id");
        consultas.push(id);
        if (id === "geo-falla") {
          return respuestaJson({ message: "error" }, 500);
        }
        if (!id || !LUGARES[id]) {
          return respuestaJson({ type: "FeatureCollection", features: [] });
        }
        return respuestaJson(detalles(id));
      },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    servidor = app.server;
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  after(() => {
    servidor.close();
  });

  beforeEach(() => {
    consultas = [];
  });

  async function enviar<T = PlanRespuesta>(datos: unknown): Promise<{ estado: number; cuerpo: T }> {
    const respuesta = await fetch(`${baseUrl}${RUTA}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof datos === "string" ? datos : JSON.stringify(datos),
    });
    return { estado: respuesta.status, cuerpo: (await respuesta.json()) as T };
  }

  test("excluye del plan final el lugar cerrado a la llegada y recalcula desde la última parada conservada", async () => {
    const { estado, cuerpo: plan } = await enviar(
      cuerpo([[["geo-museo", 360], ["geo-cerrado-temprano", 60], ["geo-parque", 60]]]),
    );

    assert.equal(estado, 200);
    assert.equal(plan.viable, true);
    assert.equal(plan.zonaHoraria, "America/Guatemala");
    const paradas = plan.itinerarios[0].paradas;
    assert.deepEqual(paradas.map((p) => p.placeId), ["geo-museo", "geo-parque"]);
    assert.equal(paradas[1].llegada, "2026-10-13T15:30-06:00");
    assert.equal(paradas[1].traslado.tiempoTotalConHolgura, 30);
    assert.equal(paradas[1].traslado.estimado, true);
    assert.deepEqual(plan.descartes, [
      {
        numeroDia: 1,
        fecha: "2026-10-13",
        placeId: "geo-cerrado-temprano",
        nombre: "Mercado matutino",
        motivo: "cerrado",
        mensaje: plan.descartes[0].mensaje,
        llegada: "2026-10-13T15:30-06:00",
        horario: { estado: "disponible", valorOriginal: "Mo-Su 08:00-10:00", fuente: "geoapify" },
      },
    ]);
  });

  test("usa los datos de Place Details del identificador solicitado e ignora los horarios enviados por el cliente", async () => {
    const { cuerpo: plan } = await enviar(
      cuerpo([[["geo-cerrado-temprano", 60, { nombre: "Nombre inventado", lat: 0, lng: 0, opening_hours: "24/7", horario: { estado: "disponible", valorOriginal: "24/7", fuente: "geoapify" } }]]], { horaInicio: "12:00" }),
    );

    assert.deepEqual(consultas, ["geo-cerrado-temprano"]);
    assert.deepEqual(plan.itinerarios, []);
    assert.equal(plan.descartes[0].placeId, "geo-cerrado-temprano");
    assert.equal(plan.descartes[0].nombre, "Mercado matutino");
    assert.equal(plan.descartes[0].horario.valorOriginal, "Mo-Su 08:00-10:00");
    assert.equal(plan.descartes[0].motivo, "cerrado");
  });

  test("conserva identificador, nombre, coordenadas, dirección y horario reales de las paradas aceptadas", async () => {
    const { cuerpo: plan } = await enviar(cuerpo([[["geo-museo", 60, { nombre: "Otro nombre" }]]]));

    const parada = plan.itinerarios[0].paradas[0];
    assert.equal(parada.placeId, "geo-museo");
    assert.equal(parada.id, "p1-1");
    assert.equal(parada.nombre, "Museo real");
    assert.equal(parada.lat, 14.6);
    assert.equal(parada.lng, -90.5);
    assert.equal(parada.direccion, "Dirección de Museo real");
    assert.deepEqual(parada.horario, { estado: "disponible", valorOriginal: "Mo-Su 08:00-20:00", fuente: "geoapify" });
    assert.equal(parada.llegada, "2026-10-13T09:00-06:00");
  });

  test("consulta una sola vez cada lugar aunque se repita en la propuesta", async () => {
    await enviar(cuerpo([[["geo-museo", 60]], [["geo-museo", 60], ["geo-parque", 60]]], { fechaFin: "2026-10-14" }));

    assert.deepEqual([...consultas].sort(), ["geo-museo", "geo-parque"]);
  });

  test("excluye con motivos diferenciados los lugares sin apertura verificable", async () => {
    const { cuerpo: plan } = await enviar(
      cuerpo([[["geo-sin-horario", 30], ["geo-falla", 30], ["geo-inexistente", 30], ["geo-museo", 30]]]),
    );

    assert.deepEqual(plan.itinerarios[0].paradas.map((p) => p.placeId), ["geo-museo"]);
    assert.deepEqual(
      plan.descartes.map((d) => [d.placeId, d.motivo]),
      [
        ["geo-sin-horario", "horario_no_publicado"],
        ["geo-falla", "error_consulta"],
        ["geo-inexistente", "error_consulta"],
      ],
    );
  });

  test("informa explícitamente un día sin paradas válidas", async () => {
    const { estado, cuerpo: plan } = await enviar(
      cuerpo([[["geo-museo", 60]], [["geo-domingo", 60]]], { fechaInicio: "2026-10-17", fechaFin: "2026-10-18" }),
    );

    assert.equal(estado, 200);
    assert.equal(plan.viable, false);
    assert.deepEqual(plan.itinerarios.map((it) => it.numeroDia), [1]);
    assert.deepEqual(plan.diasSinParadas, [{ numeroDia: 2, fecha: "2026-10-18" }]);
    assert.equal(plan.descartes[0].motivo, "cerrado");
  });

  test("rechaza una propuesta sin zona horaria IANA válida sin consultar al proveedor", async () => {
    const sinZona = cuerpo([[["geo-museo", 60]]]);
    delete sinZona.viaje.zonaHoraria;
    const zonaInvalida = cuerpo([[["geo-museo", 60]]], { zonaHoraria: "-06:00" });

    for (const datos of [sinZona, zonaInvalida]) {
      const { estado, cuerpo: error } = await enviar<CuerpoError>(datos);
      assert.equal(estado, 400);
      assert.equal(error.error.codigo, "PARAMETRO_INVALIDO");
      assert.ok(error.error.detalles?.some((d) => d.parametro === "viaje.zonaHoraria"));
    }
    assert.deepEqual(consultas, []);
  });

  test("rechaza JSON mal formado y propuestas con formato inválido", async () => {
    const malformado = await enviar<CuerpoError>("{ no es json");
    const sinParadas = await enviar<CuerpoError>(cuerpo([[]]));
    const fechasInvertidas = await enviar<CuerpoError>(cuerpo([[["geo-museo", 60]]], { fechaInicio: "2026-10-14", fechaFin: "2026-10-13" }));

    assert.equal(malformado.estado, 400);
    assert.equal(malformado.cuerpo.error.codigo, "PARAMETRO_INVALIDO");
    assert.equal(sinParadas.estado, 400);
    assert.equal(fechasInvertidas.estado, 400);
    assert.deepEqual(consultas, []);
  });
});
