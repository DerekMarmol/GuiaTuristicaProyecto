import { test, describe } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { manejarErrores } from "../src/errores";
import { crearClienteOptimizador } from "../src/optimizador/cliente";
import { crearAgenteChat } from "../src/chat/agente";
import { crearRutaChat } from "../src/chat/rutaChat";
import type { ClienteChat } from "../src/chat/clienteChat";
import { crearReoptimizadorChat, ErrorOptimizador, type ClienteOptimizador } from "../src/chat/optimizador";

const PARADAS = [
  { id: "a", nombre: "Catedral", lat: 14.6425, lng: -90.5133, horaApertura: "08:00", horaCierre: "18:00", tiempoEstanciaMinutos: 30 },
  { id: "b", nombre: "Mercado", lat: 14.6066, lng: -90.5059, horaApertura: "09:00", horaCierre: "17:00", tiempoEstanciaMinutos: 60 },
];

function respuestaOptimizador(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "content-type": "application/json" } });
}

function crearReoptimizador(responder: () => Response) {
  const cuerpos: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: URL | RequestInfo, opciones?: RequestInit) => {
    cuerpos.push(JSON.parse(String(opciones?.body)));
    return responder();
  }) as typeof fetch;
  const reoptimizador = crearReoptimizadorChat(crearClienteOptimizador({ url: "http://optimizador.test", fetchImpl }));
  return { reoptimizador, cuerpos };
}

const PARADAS_OPTIMIZADOR = PARADAS.map(({ nombre: _nombre, ...p }) => p);

describe("crearReoptimizadorChat", () => {
  test("envía modo de transporte y origen al optimizador", async () => {
    const { reoptimizador, cuerpos } = crearReoptimizador(() =>
      respuestaOptimizador({ orden_optimo: ["b", "a"], distancia_total_km: 4.7 })
    );
    const resultado = await reoptimizador.reoptimizar({
      paradas: PARADAS_OPTIMIZADOR,
      horaActualMinutos: 600,
      modoTransporte: "pedestrian",
      origen: { lat: 14.6, lng: -90.5 },
    });
    assert.deepEqual(resultado, { alcanza: true, ordenOptimo: ["b", "a"], distanciaTotalKm: 4.7 });
    assert.equal(cuerpos[0].modo_transporte, "pedestrian");
    assert.deepEqual(cuerpos[0].origen, { lat: 14.6, lng: -90.5 });
  });

  test("sin modo ni origen usa auto y no manda origen", async () => {
    const { reoptimizador, cuerpos } = crearReoptimizador(() =>
      respuestaOptimizador({ orden_optimo: ["a", "b"], distancia_total_km: 1 })
    );
    await reoptimizador.reoptimizar({ paradas: PARADAS_OPTIMIZADOR, horaActualMinutos: 600 });
    assert.equal(cuerpos[0].modo_transporte, "auto");
    assert.equal("origen" in cuerpos[0], false);
  });

  test("un 422 del optimizador significa que no alcanza el tiempo", async () => {
    const { reoptimizador } = crearReoptimizador(() => respuestaOptimizador({ detail: "sin ruta" }, 422));
    const resultado = await reoptimizador.reoptimizar({ paradas: PARADAS_OPTIMIZADOR, horaActualMinutos: 600 });
    assert.equal(resultado.alcanza, false);
  });

  test("un 500 del optimizador es una falla, no un 'no alcanza'", async () => {
    const { reoptimizador } = crearReoptimizador(() => respuestaOptimizador({ detail: "boom" }, 500));
    await assert.rejects(
      reoptimizador.reoptimizar({ paradas: PARADAS_OPTIMIZADOR, horaActualMinutos: 600 }),
      ErrorOptimizador
    );
  });
});

function clienteQueLlama(nombre: string, args: Record<string, unknown> = {}) {
  const resultados: unknown[] = [];
  const cliente: ClienteChat = {
    async responder({ herramientas }) {
      const herramienta = herramientas.find((h) => h.nombre === nombre);
      assert.ok(herramienta, `no existe la herramienta ${nombre}`);
      resultados.push(await herramienta.ejecutar(args));
      return "Listo.";
    },
  };
  return { cliente, resultados };
}

function crearApp(cliente: ClienteChat | undefined, optimizador?: ClienteOptimizador) {
  const app = Fastify();
  app.setErrorHandler(manejarErrores);
  app.register(crearRutaChat(crearAgenteChat({ cliente, optimizador })), { prefix: "/api/chat" });
  return app;
}

function chatear(app: ReturnType<typeof Fastify>, cuerpo: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/chat",
    payload: { mensaje: "Voy tarde, reordena", horaActual: "10:00", paradas: PARADAS, ...cuerpo },
  });
}

describe("POST /api/chat con herramientas", () => {
  test("reoptimizar_ruta devuelve la acción aplicada y pasa origen y modo", async () => {
    const llamadas: Parameters<ClienteOptimizador["reoptimizar"]>[0][] = [];
    const optimizador: ClienteOptimizador = {
      async reoptimizar(args) {
        llamadas.push(args);
        return { alcanza: true, ordenOptimo: ["b", "a"], distanciaTotalKm: 3.2 };
      },
    };
    const { cliente } = clienteQueLlama("reoptimizar_ruta");
    const res = await chatear(crearApp(cliente, optimizador), {
      modoTransporte: "pedestrian",
      origen: { lat: 14.6, lng: -90.5 },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().acciones, [
      { tipo: "reoptimizar_ruta", estado: "aplicada", ordenOptimo: ["b", "a"], distanciaTotalKm: 3.2 },
    ]);
    assert.equal(llamadas[0].horaActualMinutos, 600);
    assert.equal(llamadas[0].modoTransporte, "pedestrian");
    assert.deepEqual(llamadas[0].origen, { lat: 14.6, lng: -90.5 });
  });

  test("acepta paradas con estancia de 0 minutos", async () => {
    const optimizador: ClienteOptimizador = {
      async reoptimizar() {
        return { alcanza: true, ordenOptimo: ["a", "b"], distanciaTotalKm: 1 };
      },
    };
    const { cliente, resultados } = clienteQueLlama("reoptimizar_ruta");
    const paradas = [PARADAS[0], { ...PARADAS[1], tiempoEstanciaMinutos: 0 }];
    const res = await chatear(crearApp(cliente, optimizador), { paradas });

    assert.equal(res.statusCode, 200);
    assert.equal((resultados[0] as { ok: boolean }).ok, true);
  });

  test("si el optimizador falla no registra acción ni dice que no alcanza", async () => {
    const optimizador: ClienteOptimizador = {
      async reoptimizar() {
        throw new ErrorOptimizador("caído");
      },
    };
    const { cliente, resultados } = clienteQueLlama("reoptimizar_ruta");
    const res = await chatear(crearApp(cliente, optimizador), {});

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().acciones, []);
    assert.equal((resultados[0] as { ok: boolean; noAlcanza?: boolean }).noAlcanza, undefined);
  });

  test("si no alcanza el tiempo registra la acción no_alcanza", async () => {
    const optimizador: ClienteOptimizador = {
      async reoptimizar() {
        return { alcanza: false, detalle: "No hay orden viable." };
      },
    };
    const { cliente } = clienteQueLlama("reoptimizar_ruta");
    const res = await chatear(crearApp(cliente, optimizador), {});

    assert.deepEqual(res.json().acciones, [{ tipo: "reoptimizar_ruta", estado: "no_alcanza", detalle: "No hay orden viable." }]);
  });

  test("rechaza un orden que no corresponde a las paradas", async () => {
    const optimizador: ClienteOptimizador = {
      async reoptimizar() {
        return { alcanza: true, ordenOptimo: ["a", "x"], distanciaTotalKm: 1 };
      },
    };
    const { cliente, resultados } = clienteQueLlama("reoptimizar_ruta");
    const res = await chatear(crearApp(cliente, optimizador), {});

    assert.deepEqual(res.json().acciones, []);
    assert.equal((resultados[0] as { ok: boolean }).ok, false);
  });

  test("proponer_ajuste descarta paradas inventadas", async () => {
    const { cliente, resultados } = clienteQueLlama("proponer_ajuste", {
      tipo: "quitar_parada",
      paradaId: "inventada",
      motivo: "Está lejos.",
    });
    const res = await chatear(crearApp(cliente), {});

    assert.deepEqual(res.json().ajustes, []);
    assert.equal((resultados[0] as { ok: boolean }).ok, false);
  });

  test("proponer_ajuste guarda un ajuste válido", async () => {
    const ajuste = { tipo: "cambiar_tiempo", paradaId: "a", minutos: 45, motivo: "Quiere quedarse más." };
    const { cliente } = clienteQueLlama("proponer_ajuste", ajuste);
    const res = await chatear(crearApp(cliente), {});

    assert.deepEqual(res.json().ajustes, [ajuste]);
  });

  test("rechaza un origen fuera de rango", async () => {
    const { cliente } = clienteQueLlama("reoptimizar_ruta");
    const res = await chatear(crearApp(cliente), { origen: { lat: 200, lng: 0 } });

    assert.equal(res.statusCode, 400);
  });

  test("sin cliente de IA responde 503", async () => {
    const res = await chatear(crearApp(undefined), {});
    assert.equal(res.statusCode, 503);
  });
});
