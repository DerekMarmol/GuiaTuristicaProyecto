import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { consultarClimaActual } from "../src/services/clima.ts";

const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("consultarClimaActual", () => {
  test("pide el clima de las coordenadas del destino", async () => {
    let url = "";
    globalThis.fetch = async (destino) => {
      url = String(destino);
      return new Response(JSON.stringify({ observadoEn: "2026-10-20T22:00:00.000Z", temperaturaC: 29.2, descripcion: "nubes" }));
    };

    const clima = await consultarClimaActual({ lat: 15.7275154, lng: -88.5952506 });

    assert.equal(url, "/api/clima/actual?lat=15.727515&lng=-88.595251");
    assert.equal(clima?.temperaturaC, 29.2);
  });

  test("sin temperatura o con error no muestra nada en lugar de fallar", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ observadoEn: "x", temperaturaC: null, descripcion: null }));
    assert.equal(await consultarClimaActual({ lat: 15, lng: -88 }), null);

    globalThis.fetch = async () => new Response("{}", { status: 503 });
    assert.equal(await consultarClimaActual({ lat: 15, lng: -88 }), null);
  });
});
