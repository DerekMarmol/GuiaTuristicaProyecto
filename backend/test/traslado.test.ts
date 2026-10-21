import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { crearApp } from "../src/app";

describe("POST /api/itinerarios/traslado", () => {
  let app: FastifyInstance;

  before(async () => {
    app = crearApp({ apiKey: "clave-de-prueba" });
    await app.ready();
  });

  after(() => app.close());

  const enviar = (payload: unknown) => app.inject({ method: "POST", url: "/api/itinerarios/traslado", payload: payload as object });

  test("estima el traslado del punto de partida a la primera parada con su margen", async () => {
    // Unos 2.2 km en línea recta dentro de Cobán.
    const respuesta = await enviar({ origen: { lat: 15.4702, lng: -90.3735 }, destino: { lat: 15.4900, lng: -90.3735 } });

    assert.equal(respuesta.statusCode, 200);
    const { traslado } = respuesta.json();
    assert.equal(traslado.distanciaKm, 2.2);
    assert.equal(traslado.tiempoBaseMinutos, 3);
    assert.equal(traslado.estimado, true);
    assert.equal(traslado.tiempoTotalConHolgura, traslado.tiempoBaseMinutos + traslado.desgloseHolgura.totalHolgura);
  });

  test("valida que lleguen los dos puntos", async () => {
    const respuesta = await enviar({ origen: { lat: 200, lng: -90 } });

    assert.equal(respuesta.statusCode, 400);
    const parametros = respuesta.json().error.detalles.map((d: { parametro: string }) => d.parametro);
    assert.ok(parametros.includes("origen.lat"));
    assert.ok(parametros.includes("destino"));
  });
});
