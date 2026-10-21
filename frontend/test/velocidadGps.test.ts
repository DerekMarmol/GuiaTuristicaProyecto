import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { crearEstimadorVelocidad, type LecturaGps } from "../src/utils/velocidadGps.ts";
import { detectarTransporte } from "../src/utils/detectarTransporte.ts";

const INICIO = { lat: 15.4702, lng: -90.3735 };
const METROS_POR_GRADO = 111_320;

// Lecturas cada segundo avanzando hacia el norte a la velocidad indicada, sin coords.speed.
function recorrido(metrosPorSegundo: number, segundos: number, precisionMetros = 10, desvio = (_i: number) => 0): LecturaGps[] {
  return Array.from({ length: segundos + 1 }, (_, i) => ({
    lat: INICIO.lat + (metrosPorSegundo * i + desvio(i)) / METROS_POR_GRADO,
    lng: INICIO.lng,
    precisionMetros,
    tiempoMs: 1_000_000 + i * 1000,
    velocidadMs: null,
  }));
}

function ultimaEstimacion(lecturas: LecturaGps[]) {
  const estimador = crearEstimadorVelocidad();
  return lecturas.map((l) => estimador.agregar(l)).at(-1)!;
}

describe("velocidad calculada sin coords.speed", () => {
  test("en un carro a 54 km/h detecta vehículo a los pocos segundos", () => {
    const { velocidadKmh, fuente } = ultimaEstimacion(recorrido(15, 5));
    assert.equal(fuente, "calculada");
    assert.equal(detectarTransporte(velocidadKmh), "vehiculo");
  });

  test("caminando a 5 km/h detecta que camina", () => {
    const { velocidadKmh } = ultimaEstimacion(recorrido(1.4, 20));
    assert.equal(detectarTransporte(velocidadKmh), "caminando");
  });

  test("el temblor del GPS estando quieto no cuenta como movimiento", () => {
    const { velocidadKmh } = ultimaEstimacion(recorrido(0, 20, 15, (i) => (i % 2 === 0 ? 7 : -7)));
    assert.equal(detectarTransporte(velocidadKmh), "detenido");
  });

  test("no calcula con muy pocos segundos de lecturas", () => {
    assert.equal(ultimaEstimacion(recorrido(15, 2)).velocidadKmh, null);
  });

  test("ignora la ubicación imprecisa por Wi-Fi de una computadora", () => {
    const { velocidadKmh } = ultimaEstimacion(recorrido(20, 20, 300));
    assert.equal(velocidadKmh, null);
    assert.equal(detectarTransporte(velocidadKmh), "desconocido");
  });

  test("tras una pausa larga sin lecturas vuelve a empezar", () => {
    const estimador = crearEstimadorVelocidad();
    recorrido(15, 5).forEach((l) => estimador.agregar(l));
    const despues = estimador.agregar({ ...INICIO, precisionMetros: 10, tiempoMs: 1_000_000 + 5_000 + 120_000, velocidadMs: null });
    assert.equal(despues.velocidadKmh, null);
  });
});

describe("velocidad informada por el GPS", () => {
  test("usa coords.speed promediando las últimas lecturas", () => {
    const estimador = crearEstimadorVelocidad();
    const base = { ...INICIO, precisionMetros: 5, velocidadMs: 0 };
    estimador.agregar({ ...base, tiempoMs: 0, velocidadMs: 10 });
    const resultado = estimador.agregar({ ...base, tiempoMs: 1000, velocidadMs: 12 });
    assert.equal(resultado.fuente, "gps");
    assert.equal(Math.round(resultado.velocidadKmh!), 40);
  });
});
