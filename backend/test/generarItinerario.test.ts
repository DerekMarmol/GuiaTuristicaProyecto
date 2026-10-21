import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crearApp } from "../src/app";
import type { ClienteLLM } from "../src/ai/cliente";

interface LugarSimulado {
  name: string;
  lat: number;
  lon: number;
  categories: string[];
  opening_hours?: string;
}

interface ParadaRespuesta {
  placeId: string;
  nombre: string;
  lat: number;
  lng: number;
  llegada: string;
  categorias?: string[];
  tipo_entorno?: string;
  horarioEstimado: boolean;
}

interface Respuesta {
  destino: { nombre: string; lat: number; lng: number; zonaHoraria: string };
  horaInicio: string;
  generadoCon: "ia" | "respaldo";
  viable: boolean;
  itinerarios: { numeroDia: number; fecha: string; paradas: ParadaRespuesta[] }[];
  diasSinParadas: { numeroDia: number }[];
  advertencias: string[];
}

interface CuerpoError {
  error: { codigo: string; mensaje: string; detalles?: { parametro: string; mensaje: string }[] };
}

const CLAVE = "clave-de-prueba-no-real-321";
const RUTA = "/api/itinerarios/generar";
const PUERTO_BARRIOS = { lat: 15.7275, lon: -88.5952 };

const CATALOGO_PUERTO_BARRIOS: Record<string, LugarSimulado> = {
  "pb-playa": { name: "Playa Pública", lat: 15.6944, lon: -88.6243, categories: ["beach"] },
  "pb-playa-2": { name: "Playa Cocolí", lat: 15.71, lon: -88.62, categories: ["beach"] },
  "pb-parque": { name: "Parque Belga", lat: 15.6916, lon: -88.6165, categories: ["leisure", "leisure.park"] },
  "pb-parque-2": { name: "Parque Tecún Umán", lat: 15.736, lon: -88.6046, categories: ["leisure", "leisure.park"] },
  "pb-parque-3": { name: "Parque Reyna Barrios", lat: 15.734, lon: -88.5966, categories: ["leisure", "leisure.park"] },
  "pb-restaurante": {
    name: "Restaurante La Cabaña",
    lat: 15.7202,
    lon: -88.5931,
    categories: ["catering", "catering.restaurant"],
    opening_hours: "Mo-Su 07:00-21:00",
  },
  "pb-cafe": { name: "Stop Café", lat: 15.7326, lon: -88.5999, categories: ["catering", "catering.cafe"] },
  "pb-antojitos": { name: "Antojitos Dana", lat: 15.7324, lon: -88.5997, categories: ["catering", "catering.restaurant"] },
};

const SOLO_RESTAURANTES: Record<string, LugarSimulado> = {
  "ja-sheik": { name: "El Sheik", lat: 14.6318, lon: -89.9892, categories: ["catering", "catering.restaurant"] },
  "ja-casa-real": { name: "Casa Real", lat: 14.6324, lon: -89.9875, categories: ["catering", "catering.restaurant"] },
  "ja-mastinos": { name: "Mastino's", lat: 14.632, lon: -89.9871, categories: ["catering", "catering.restaurant"] },
};

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

function feature(id: string, lugar: LugarSimulado, extra: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    properties: {
      place_id: id,
      name: lugar.name,
      formatted: `Dirección de ${lugar.name}`,
      lat: lugar.lat,
      lon: lugar.lon,
      categories: lugar.categories,
      ...extra,
    },
    geometry: { type: "Point", coordinates: [lugar.lon, lugar.lat] },
  };
}

function coincide(categorias: string[], pedidas: string[]): boolean {
  return categorias.some((c) => pedidas.some((p) => c === p || c.startsWith(`${p}.`)));
}

describe("POST /api/itinerarios/generar", () => {
  let servidor: Server;
  let baseUrl: string;
  let catalogo: Record<string, LugarSimulado>;
  let consultasGeocodificacion: URLSearchParams[];
  let clienteIA: ClienteLLM | null;

  before(async () => {
    const app = crearApp({
      apiKey: CLAVE,
      detalles: { tiempoEsperaMs: 200, intervaloMs: 0, presupuestoMs: 2000 },
      // El cliente se decide en cada prueba; la app delega en él a través de este envoltorio.
      generacion: {
        cliente: {
          generarPlan: (args) => {
            assert.ok(clienteIA, "La prueba no configuró un cliente de IA.");
            return clienteIA.generarPlan(args);
          },
        },
      },
      fetch: async (url) => {
        const direccion = new URL(url);
        const parametros = direccion.searchParams;
        if (direccion.pathname === "/v1/geocode/search") {
          consultasGeocodificacion.push(parametros);
          if (parametros.get("text")?.includes("inexistente")) {
            return respuestaJson({ results: [{ lat: 14.55, lon: -90.73, formatted: "Restaurante cualquiera", rank: { confidence: 0.12 }, timezone: { name: "America/Guatemala" } }] });
          }
          return respuestaJson({
            results: [
              {
                lat: PUERTO_BARRIOS.lat,
                lon: PUERTO_BARRIOS.lon,
                formatted: "Puerto Barrios, IZ, Guatemala",
                rank: { confidence: 1 },
                timezone: { name: "America/Guatemala" },
              },
            ],
          });
        }
        if (direccion.pathname === "/v2/places") {
          const pedidas = parametros.get("categories")?.split(",") ?? [];
          const limite = Number(parametros.get("limit"));
          const features = Object.entries(catalogo)
            .filter(([, lugar]) => coincide(lugar.categories, pedidas))
            .slice(0, limite)
            .map(([id, lugar]) => feature(id, lugar));
          return respuestaJson({ type: "FeatureCollection", features });
        }
        if (direccion.pathname === "/v2/place-details") {
          const id = parametros.get("id") ?? "";
          const lugar = catalogo[id];
          if (!lugar) return respuestaJson({ type: "FeatureCollection", features: [] });
          const extra = { feature_type: "details", ...(lugar.opening_hours ? { opening_hours: lugar.opening_hours } : {}) };
          return respuestaJson({ type: "FeatureCollection", features: [feature(id, lugar, extra)] });
        }
        throw new Error(`URL inesperada en la prueba: ${direccion.pathname}`);
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
    catalogo = CATALOGO_PUERTO_BARRIOS;
    consultasGeocodificacion = [];
    clienteIA = {
      // Un plan imposible obliga a usar el planificador de respaldo, igual que si no hubiera GEMINI_API_KEY.
      generarPlan: async () => ({ dias: [{ numeroDia: 1, paradas: [{ placeId: "inventado", tiempoEstanciaMinutos: 60 }] }] }),
    };
  });

  async function enviar<T = Respuesta>(datos: unknown): Promise<{ estado: number; cuerpo: T }> {
    const respuesta = await fetch(`${baseUrl}${RUTA}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    return { estado: respuesta.status, cuerpo: (await respuesta.json()) as T };
  }

  const viajePuertoBarrios = {
    destino: "Puerto Barrios, Izabal",
    fechaInicio: "2026-11-10",
    fechaFin: "2026-11-12",
    intereses: ["Playa", "Naturaleza", "Gastronomía"],
    tipoViaje: "pareja",
    transporte: "Automovil",
  };

  test("arma el itinerario con lugares reales del destino y sus coordenadas", async () => {
    const { estado, cuerpo } = await enviar(viajePuertoBarrios);

    assert.equal(estado, 200);
    assert.equal(cuerpo.generadoCon, "respaldo");
    assert.equal(cuerpo.viable, true);
    assert.deepEqual(cuerpo.destino, { nombre: "Puerto Barrios, IZ, Guatemala", lat: PUERTO_BARRIOS.lat, lng: PUERTO_BARRIOS.lon, zonaHoraria: "America/Guatemala" });
    assert.equal(consultasGeocodificacion[0].get("filter"), "countrycode:gt");
    assert.equal(cuerpo.itinerarios.length, 3);

    const paradas = cuerpo.itinerarios.flatMap((it) => it.paradas);
    assert.equal(new Set(paradas.map((p) => p.placeId)).size, paradas.length, "no repite lugares");
    for (const parada of paradas) {
      const real = CATALOGO_PUERTO_BARRIOS[parada.placeId];
      assert.ok(real, `${parada.placeId} viene del catálogo del destino`);
      assert.equal(parada.lat, real.lat);
      assert.equal(parada.lng, real.lon);
      assert.deepEqual(parada.categorias, real.categories);
      assert.ok(parada.tipo_entorno, "trae la clasificación climática");
      assert.equal(parada.horarioEstimado, real.opening_hours === undefined);
    }
    assert.ok(paradas.some((p) => p.placeId.startsWith("pb-playa")), "incluye una playa");
    assert.ok(cuerpo.advertencias.some((a) => a.includes("se usó uno típico")));
  });

  test("no pone más de dos comidas por día", async () => {
    const { cuerpo } = await enviar(viajePuertoBarrios);
    for (const it of cuerpo.itinerarios) {
      const comidas = it.paradas.filter((p) => p.categorias?.includes("catering")).length;
      assert.ok(comidas <= 2, `día ${it.numeroDia} tiene ${comidas} comidas`);
    }
  });

  test("usa el plan de la IA cuando es válido", async () => {
    clienteIA = {
      generarPlan: async () => ({
        dias: [
          { numeroDia: 1, paradas: [{ placeId: "pb-playa", tiempoEstanciaMinutos: 120, motivo: "Para disfrutar el mar." }] },
          { numeroDia: 2, paradas: [{ placeId: "pb-parque", tiempoEstanciaMinutos: 60 }] },
          { numeroDia: 3, paradas: [{ placeId: "pb-restaurante", tiempoEstanciaMinutos: 60 }] },
        ],
      }),
    };

    const { estado, cuerpo } = await enviar(viajePuertoBarrios);

    assert.equal(estado, 200);
    assert.equal(cuerpo.generadoCon, "ia");
    assert.deepEqual(
      cuerpo.itinerarios.map((it) => it.paradas.map((p) => p.placeId)),
      [["pb-playa"], ["pb-parque"], ["pb-restaurante"]],
    );
  });

  test("si la IA no logra un plan válido, usa el planificador de respaldo y lo avisa", async () => {
    const { estado, cuerpo } = await enviar(viajePuertoBarrios);

    assert.equal(estado, 200);
    assert.equal(cuerpo.generadoCon, "respaldo");
    assert.ok(cuerpo.advertencias.some((a) => a.includes("No se pudo generar el itinerario con IA")));
  });

  test("empieza el día más tarde si a la hora pedida no hay nada abierto", async () => {
    catalogo = SOLO_RESTAURANTES;

    const { estado, cuerpo } = await enviar({ ...viajePuertoBarrios, fechaFin: "2026-11-10", intereses: ["Gastronomía", "Cultura"] });

    assert.equal(estado, 200);
    assert.equal(cuerpo.horaInicio, "11:00");
    assert.match(cuerpo.itinerarios[0].paradas[0].llegada, /T11:00/);
    assert.ok(cuerpo.advertencias.some((a) => a.includes("empieza a las 11:00")));
    assert.ok(cuerpo.advertencias.some((a) => a.includes("No encontramos lugares de Cultura")));
  });

  test("trata como uno solo los registros duplicados del mismo lugar", async () => {
    catalogo = {
      ...CATALOGO_PUERTO_BARRIOS,
      "pb-cabana-duplicado": { ...CATALOGO_PUERTO_BARRIOS["pb-restaurante"], name: "restaurante la cabana", lat: 15.7203 },
    };

    const { cuerpo } = await enviar(viajePuertoBarrios);

    const nombres = cuerpo.itinerarios.flatMap((it) => it.paradas.map((p) => p.nombre.toLowerCase()));
    assert.ok(!nombres.includes("restaurante la cabana"), "no usa el registro duplicado");
  });

  test("responde 422 si el destino no se encuentra en Guatemala", async () => {
    const { estado, cuerpo } = await enviar<CuerpoError>({ ...viajePuertoBarrios, destino: "lugar inexistente" });

    assert.equal(estado, 422);
    assert.equal(cuerpo.error.codigo, "DESTINO_NO_ENCONTRADO");
  });

  test("responde 422 si no hay lugares para los intereses", async () => {
    catalogo = {};

    const { estado, cuerpo } = await enviar<CuerpoError>(viajePuertoBarrios);

    assert.equal(estado, 422);
    assert.equal(cuerpo.error.codigo, "SIN_LUGARES");
  });

  test("valida los datos del viaje", async () => {
    const { estado, cuerpo } = await enviar<CuerpoError>({
      ...viajePuertoBarrios,
      fechaFin: "2026-11-01",
      intereses: ["Playa", "Astronomía"],
    });

    assert.equal(estado, 400);
    assert.equal(cuerpo.error.codigo, "PARAMETRO_INVALIDO");
    const parametros = cuerpo.error.detalles?.map((d) => d.parametro) ?? [];
    assert.ok(parametros.includes("intereses"));
    assert.equal(consultasGeocodificacion.length, 0, "no consulta proveedores si los datos son inválidos");
  });
});
