import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { calcularTrasladoInicio, distanciaKm, etiquetaPartida, horaDeSalida } from "../src/services/puntoPartida.ts";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("punto de partida", () => {
  test("calcula la hora de salida para llegar a la primera parada", () => {
    assert.equal(horaDeSalida("09:00", 21), "08:39");
    assert.equal(horaDeSalida("00:10", 30), "23:40");
  });

  test("mide la distancia en línea recta", () => {
    // Jalapa → Cobán, unos 100 km en línea recta.
    assert.equal(Math.round(distanciaKm({ lat: 14.6344, lng: -89.9898 }, { lat: 15.4702, lng: -90.3735 })), 102);
    assert.equal(distanciaKm({ lat: 15.47, lng: -90.37 }, { lat: 15.47, lng: -90.37 }), 0);
  });

  test("distingue la ubicación del dispositivo de un punto marcado en el mapa", () => {
    assert.equal(etiquetaPartida({ lat: 0, lng: 0, fuente: "ubicacion" }), "Tú estás aquí");
    assert.equal(etiquetaPartida({ lat: 0, lng: 0, fuente: "mapa" }), "Tu punto de partida");
  });

  test("pide el traslado al backend y explica si falla", async () => {
    let cuerpo: unknown;
    globalThis.fetch = async (_url, opciones) => {
      cuerpo = JSON.parse(String(opciones?.body));
      return new Response(JSON.stringify({ traslado: { tiempoBaseMinutos: 3, tiempoTotalConHolgura: 23, distanciaKm: 2.2 } }));
    };
    const traslado = await calcularTrasladoInicio({ lat: 15.47, lng: -90.37 }, { lat: 15.49, lng: -90.37 });
    assert.deepEqual(cuerpo, { origen: { lat: 15.47, lng: -90.37 }, destino: { lat: 15.49, lng: -90.37 } });
    assert.equal(traslado.tiempoTotalConHolgura, 23);

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { mensaje: "Los puntos del traslado no son válidos." } }), { status: 400 });
    await assert.rejects(calcularTrasladoInicio({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), /no son válidos/);
  });
});

describe("hora de salida en un viaje de hoy (GUI-112)", () => {
  test("si la hora sugerida ya pasó, dice a qué hora llega saliendo ahora", async () => {
    const { textoSalida } = await import("../src/components/PuntoPartida.tsx");
    assert.equal(textoSalida("09:00", 20, true, "14:05"), "Si sales ahora, llegas a las 14:25.");
    assert.equal(textoSalida("14:30", 20, true, "14:05"), "Sal a las 14:10 para llegar a las 14:30.");
    assert.equal(textoSalida("09:00", 20, false, "14:05"), "Sal a las 08:40 para llegar a las 09:00.");
  });
});
