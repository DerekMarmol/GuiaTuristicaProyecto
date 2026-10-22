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

describe("velocidad real en carro (GUI-119)", () => {
  const kmh = (v: number) => v / 3.6;

  for (const velocidad of [20, 40, 60]) {
    test(`a ${velocidad} km/h con margen de error de teléfono (30 m) marca ${velocidad} km/h`, () => {
      const { velocidadKmh } = ultimaEstimacion(recorrido(kmh(velocidad), 20, 30));
      assert.ok(Math.abs(velocidadKmh! - velocidad) <= 1, `marcó ${velocidadKmh?.toFixed(1)} km/h`);
    });
  }

  test("con ruido en las posiciones se mantiene cerca de la velocidad real", () => {
    // Desvío determinista de hasta ±8 m, como el que da un GPS con 15 m de margen.
    const desvio = (i: number) => (((i * 37) % 17) - 8);
    const { velocidadKmh } = ultimaEstimacion(recorrido(kmh(40), 20, 15, desvio));
    assert.ok(Math.abs(velocidadKmh! - 40) <= 4, `marcó ${velocidadKmh?.toFixed(1)} km/h`);
  });

  test("al acelerar de 20 a 60 km/h lo refleja en pocos segundos", () => {
    const estimador = crearEstimadorVelocidad();
    let metros = 0;
    let ultima: number | null = null;
    for (let s = 0; s <= 26; s++) {
      metros += s <= 20 ? kmh(20) : kmh(60);
      ultima = estimador.agregar({
        lat: INICIO.lat + metros / METROS_POR_GRADO,
        lng: INICIO.lng,
        precisionMetros: 10,
        tiempoMs: 1_000_000 + s * 1000,
        velocidadMs: null,
      }).velocidadKmh;
    }
    assert.ok(ultima! >= 52, `a los 6 s de acelerar marcaba ${ultima?.toFixed(1)} km/h`);
  });

  test("al detenerse marca detenido", () => {
    const estimador = crearEstimadorVelocidad();
    recorrido(kmh(40), 10, 10).forEach((l) => estimador.agregar(l));
    const ultimaPosicion = recorrido(kmh(40), 10, 10).at(-1)!;
    let resultado = null;
    for (let s = 1; s <= 25; s++) {
      resultado = estimador.agregar({ ...ultimaPosicion, tiempoMs: ultimaPosicion.tiempoMs + s * 1000 });
    }
    assert.equal(detectarTransporte(resultado!.velocidadKmh), "detenido");
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
