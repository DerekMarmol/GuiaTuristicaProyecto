import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  anguloManiobra,
  calcularProgreso,
  convertirRuta,
  formatearDistancia,
  formatearDuracion,
  pedirRuta,
  perfilPorTransporte,
  tramoPendiente,
} from "../src/services/navegacion.ts";

// Ruta de ejemplo: 500 m al norte y luego 300 m al este (giro a la derecha).
const LAT0 = 14.6105;
const LNG0 = -89.995;
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const punto = (norte: number, este: number): [number, number] => [LNG0 + este * M_LNG, LAT0 + norte * M_LAT];
const comoPosicion = ([lng, lat]: [number, number]) => ({ lat, lng });

const respuestaMapbox = {
  routes: [
    {
      distance: 800,
      duration: 160,
      geometry: { coordinates: [punto(0, 0), punto(250, 0), punto(500, 0), punto(500, 150), punto(500, 300)] },
      legs: [
        {
          steps: [
            { distance: 500, name: "", maneuver: { instruction: "Conduzca hacia el norte.", type: "depart", location: punto(0, 0) } },
            { distance: 300, name: "1a Calle", maneuver: { instruction: "Gire a la derecha hacia 1a Calle.", type: "turn", modifier: "right", location: punto(500, 0) } },
            { distance: 0, name: "1a Calle", maneuver: { instruction: "Su destino está a la derecha.", type: "arrive", modifier: "right", location: punto(500, 300) } },
          ],
        },
      ],
    },
  ],
};

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("navegación guiada (GUI-116)", () => {
  const ruta = convertirRuta(respuestaMapbox);

  test("convierte la respuesta de Mapbox con la posición de cada maniobra en la ruta", () => {
    assert.equal(ruta.pasos.length, 3);
    assert.equal(ruta.pasos[1].calle, "1a Calle");
    assert.equal(ruta.pasos[0].calle, null);
    assert.ok(Math.abs(ruta.posicionPasos[1] - 500) < 1);
    assert.ok(Math.abs(ruta.posicionPasos[2] - 800) < 1);
  });

  test("a mitad de la recta, la siguiente indicación es el giro y faltan 300 m para él", () => {
    const progreso = calcularProgreso(ruta, comoPosicion(punto(200, 3)), 10);
    assert.equal(progreso.indicePaso, 1);
    assert.ok(Math.abs(progreso.distanciaAlPaso - 300) < 2, `${progreso.distanciaAlPaso}`);
    assert.ok(Math.abs(progreso.distanciaRestante - 600) < 2);
    assert.equal(progreso.segundosRestantes, 120);
    assert.equal(progreso.fueraDeRuta, false);
    assert.equal(progreso.llego, false);
  });

  test("después del giro, la siguiente indicación es la llegada", () => {
    const progreso = calcularProgreso(ruta, comoPosicion(punto(500, 100)), 10);
    assert.equal(progreso.indicePaso, 2);
    assert.ok(Math.abs(progreso.distanciaAlPaso - 200) < 2);
  });

  test("detecta que el usuario se salió de la ruta, con tolerancia al error del GPS", () => {
    assert.equal(calcularProgreso(ruta, comoPosicion(punto(250, 80)), 10).fueraDeRuta, true);
    assert.equal(calcularProgreso(ruta, comoPosicion(punto(250, 30)), 10).fueraDeRuta, false);
    // Con un GPS impreciso (60 m), 80 m de desvío todavía no cuenta como salirse.
    assert.equal(calcularProgreso(ruta, comoPosicion(punto(250, 80)), 60).fueraDeRuta, false);
  });

  test("si salió de un punto lejos de la calle, estar a esa distancia no cuenta como salirse", () => {
    // Salió de una casa a 80 m de la ruta: a 85 m sigue en ruta; a 130 m ya se salió.
    assert.equal(calcularProgreso(ruta, comoPosicion(punto(100, 85)), 8, 80).fueraDeRuta, false);
    assert.equal(calcularProgreso(ruta, comoPosicion(punto(100, 130)), 8, 80).fueraDeRuta, true);
  });

  test("avisa la llegada cerca del destino", () => {
    const progreso = calcularProgreso(ruta, comoPosicion(punto(500, 290)), 10);
    assert.equal(progreso.llego, true);
    assert.equal(progreso.fueraDeRuta, false);
  });

  test("elige caminar o manejar según el transporte del viaje", () => {
    assert.equal(perfilPorTransporte("A pie"), "walking");
    assert.equal(perfilPorTransporte("Moto"), "driving-traffic");
    assert.equal(perfilPorTransporte(undefined), "driving-traffic");
  });

  test("formatea distancias, tiempos y giros", () => {
    assert.equal(formatearDistancia(4), "10 m");
    assert.equal(formatearDistancia(234), "230 m");
    assert.equal(formatearDistancia(1580), "1.6 km");
    assert.equal(formatearDuracion(40), "1 min");
    assert.equal(formatearDuracion(4000), "1 h 7 min");
    assert.equal(anguloManiobra("left"), -90);
    assert.equal(anguloManiobra(null), 0);
  });

  test("pide la ruta en español con indicaciones paso a paso", async () => {
    let url = "";
    globalThis.fetch = async (destino) => {
      url = String(destino);
      return new Response(JSON.stringify(respuestaMapbox));
    };
    const pedida = await pedirRuta({ lat: 14.61, lng: -89.995 }, { lat: 14.63, lng: -89.99 }, "walking", "pk.prueba");
    assert.match(url, /\/mapbox\/walking\/-89\.995,14\.61;-89\.99,14\.63\?/);
    assert.match(url, /language=es/);
    assert.match(url, /steps=true/);
    assert.equal(pedida.pasos.length, 3);
  });

  test("solo deja por dibujar lo que falta: el tramo recorrido se borra", () => {
    const pendiente = tramoPendiente(ruta, comoPosicion(punto(200, 3)));
    assert.equal(pendiente.length, 5);
    assert.ok(Math.abs(pendiente[0][1] - punto(200, 0)[1]) < 1e-7);
    assert.ok(Math.abs(pendiente[0][0] - punto(200, 0)[0]) < 1e-7);
    assert.deepEqual(pendiente.at(-1), punto(500, 300));
    assert.equal(tramoPendiente(ruta, comoPosicion(punto(500, 290))).length, 2);
    assert.equal(tramoPendiente(ruta, null).length, ruta.coordenadas.length);
  });

  test("explica cuando no hay ruta", () => {
    assert.throws(() => convertirRuta({ routes: [] }), /No encontramos una ruta/);
  });
});
