import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ErrorGeneracionIA, generarItinerarios } from "../src/ai/generarItinerario";
import type { ClienteLLM } from "../src/ai/cliente";
import { LUGARES_PRUEBA, VIAJE_PRUEBA } from "../src/ai/scripts/lugaresPrueba";

const errorGemini = (codigo: number, estado: string) =>
  new Error(JSON.stringify({ error: { code: codigo, message: "…", status: estado } }));

function clienteQueFalla(error: Error) {
  let llamadas = 0;
  const cliente: ClienteLLM = {
    generarPlan: async () => {
      llamadas++;
      throw error;
    },
  };
  return { cliente, llamadas: () => llamadas };
}

async function fallo(cliente: ClienteLLM): Promise<ErrorGeneracionIA> {
  try {
    await generarItinerarios({ viaje: VIAJE_PRUEBA, candidatos: LUGARES_PRUEBA, cliente, esperaReintentoMs: 1 });
  } catch (error) {
    assert.ok(error instanceof ErrorGeneracionIA);
    return error;
  }
  throw new Error("Se esperaba que fallara");
}

describe("fallos de Gemini", () => {
  test("con la cuota agotada (429) no reintenta, para no gastar más solicitudes", async () => {
    const { cliente, llamadas } = clienteQueFalla(errorGemini(429, "RESOURCE_EXHAUSTED"));
    const error = await fallo(cliente);
    assert.equal(error.motivo, "cuota_agotada");
    assert.equal(llamadas(), 1);
  });

  test("con el modelo saturado (503) reintenta una vez y avisa que está saturado", async () => {
    const { cliente, llamadas } = clienteQueFalla(errorGemini(503, "UNAVAILABLE"));
    const error = await fallo(cliente);
    assert.equal(error.motivo, "modelo_saturado");
    assert.equal(llamadas(), 2);
  });

  test("lee el código del error que da el SDK en status", async () => {
    const conEstado = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const { cliente, llamadas } = clienteQueFalla(conEstado);
    assert.equal((await fallo(cliente)).motivo, "cuota_agotada");
    assert.equal(llamadas(), 1);
  });

  test("otros errores de conexión reintentan como antes", async () => {
    const { cliente, llamadas } = clienteQueFalla(new Error("fetch failed"));
    const error = await fallo(cliente);
    assert.equal(error.motivo, "error_modelo");
    assert.equal(llamadas(), 3);
  });

  test("si la IA responde pero el plan no es válido, lo explica así", async () => {
    const cliente: ClienteLLM = { generarPlan: async () => ({ dias: [{ numeroDia: 1, paradas: [{ placeId: "inventado", tiempoEstanciaMinutos: 60 }] }] }) };
    assert.equal((await fallo(cliente)).motivo, "plan_invalido");
  });
});
