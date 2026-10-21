import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Itinerario } from "../../shared/types";
import { buscarHoteles, buscarRestaurantes, personasDelViaje } from "../src/services/recomendaciones.ts";

const fetchOriginal = globalThis.fetch;
let solicitudes: { url: string; cuerpo: Record<string, unknown> }[] = [];

function responder(cuerpo: unknown, estado = 200) {
  globalThis.fetch = async (url, opciones) => {
    solicitudes.push({ url: String(url), cuerpo: JSON.parse(String(opciones?.body)) });
    return new Response(JSON.stringify(cuerpo), { status: estado });
  };
}

const dia: Itinerario = {
  id: "it-1",
  viajeId: "borrador",
  numeroDia: 1,
  fecha: "2026-10-25",
  paradas: [
    { id: "p1-1", nombre: "Las Victorias", lat: 15.4777, lng: -90.3826, horaApertura: "06:00", horaCierre: "18:00", tiempoEstanciaMinutos: 120 },
    { id: "p1-2", nombre: "Palacio Municipal", lat: 15.4707, lng: -90.3734, horaApertura: "09:00", horaCierre: "17:00", tiempoEstanciaMinutos: 60 },
  ],
};
const viaje = { destino: "Cobán", fechaInicio: "2026-10-25", fechaFin: "2026-10-25", presupuestoDiario: 500, tipoViaje: "pareja" as const, hospedaje: false };

function restaurante(id: string, nombre: string, metros: number) {
  return {
    idExterno: id, nombre, lat: 15.47, lng: -90.37, distanciaLineaRectaMetros: metros,
    tarifaReferencial: { minimo: 50, maximo: 70 },
  };
}

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  solicitudes = [];
});

describe("personasDelViaje", () => {
  test("usa el tipo de viaje y, sin él, una persona", () => {
    assert.equal(personasDelViaje("pareja"), 2);
    assert.equal(personasDelViaje(undefined), 1);
  });
});

describe("buscarHoteles", () => {
  test("pide hoteles para la primera noche con todas las paradas y adapta la respuesta", async () => {
    responder({
      ocupacion: 2,
      presupuestoHospedaje: 200,
      mensaje: null,
      hoteles: [
        { idExterno: "h-lejos", nombre: "Hotel Casa Itzel", lat: 15.47, lng: -90.37, distanciaLineaRectaMetros: 1027, tarifa: { importe: 137.6 } },
        { idExterno: "h-cerca", nombre: "Hotel Bethel", lat: 15.47, lng: -90.37, distanciaLineaRectaMetros: 317, tarifa: { importe: 183.46 } },
      ],
    });

    const resultado = await buscarHoteles(viaje, [dia]);

    const { url, cuerpo } = solicitudes[0];
    assert.equal(url, "/api/hoteles/recomendaciones");
    assert.equal(cuerpo.fecha, "2026-10-25");
    assert.equal(cuerpo.ocupacion, 2);
    assert.equal((cuerpo.paradas as unknown[]).length, 2);
    assert.deepEqual(resultado.hoteles.map((h) => [h.nombre, h.precio, h.distanciaKm]), [
      ["Hotel Bethel", 183, 0.3],
      ["Hotel Casa Itzel", 138, 1],
    ]);
  });

  test("si ningún hotel entra en el presupuesto, sugiere subirlo", async () => {
    responder({ ocupacion: 2, presupuestoHospedaje: 200, hoteles: [], motivo: "sin_hoteles_en_presupuesto", mensaje: "Mensaje técnico." });
    const resultado = await buscarHoteles(viaje, [dia]);
    assert.match(resultado.mensaje ?? "", /Q 200 por noche.*paso 3/);
  });

  test("muestra el mensaje del backend si falla", async () => {
    responder({ error: { codigo: "SERVICIO_NO_CONFIGURADO", mensaje: "El servicio de hoteles no está configurado." } }, 503);
    await assert.rejects(buscarHoteles(viaje, [dia]), /El servicio de hoteles no está configurado/);
  });
});

describe("buscarRestaurantes", () => {
  test("une los restaurantes de todas las paradas sin repetirlos", async () => {
    responder({
      presupuestoPorPersona: 150,
      comensales: 2,
      mensaje: null,
      paradas: [
        { id: "p1-1", estado: "procesada", mensaje: null, restaurantes: [restaurante("r-pollo", "Pollo Granjero", 800)] },
        { id: "p1-2", estado: "procesada", mensaje: null, restaurantes: [restaurante("r-pollo", "Pollo Granjero", 113), restaurante("r-pizza", "Pizzeria Bambino", 125)] },
      ],
    });

    const resultado = await buscarRestaurantes(viaje, dia);

    assert.equal(solicitudes[0].url, "/api/restaurantes/recomendaciones");
    assert.equal(solicitudes[0].cuerpo.comensales, 2);
    assert.deepEqual(resultado.restaurantes.map((r) => [r.nombre, r.distanciaKm, r.cercaDe]), [
      ["Pollo Granjero", 0.1, "Palacio Municipal"],
      ["Pizzeria Bambino", 0.1, "Palacio Municipal"],
    ]);
    assert.equal(resultado.incompleto, false);
  });

  test("avisa si alguna parada falló y explica por qué no hay resultados", async () => {
    responder({
      presupuestoPorPersona: 30,
      comensales: 1,
      mensaje: null,
      paradas: [
        { id: "p1-1", estado: "fallida", mensaje: "No se pudo consultar.", restaurantes: [] },
        { id: "p1-2", estado: "procesada", mensaje: "Ningún restaurante entra en tu presupuesto.", restaurantes: [] },
      ],
    });

    const resultado = await buscarRestaurantes(viaje, dia);

    assert.equal(resultado.incompleto, true);
    assert.equal(resultado.restaurantes.length, 0);
    assert.ok(resultado.mensaje);
  });
});
