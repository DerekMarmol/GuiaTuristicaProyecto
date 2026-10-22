import { test, describe, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { convertirRespuesta, generarItinerario, type ParadaConHorario } from "../src/services/itinerario.ts";

const traslado = {
  tiempoBaseMinutos: 6,
  tipoTraslado: "pie" as const,
  desgloseHolgura: { margenEstandar: 10, estacionamientoOAdicional: 5, imprevistos: 1, totalHolgura: 16 },
  tiempoTotalConHolgura: 22,
};

function respuesta() {
  return {
    destino: { nombre: "Cobán, AV, Guatemala", lat: 15.4702, lng: -90.3735, zonaHoraria: "America/Guatemala" },
    itinerarios: [
      {
        id: "it-1",
        viajeId: "borrador",
        numeroDia: 1,
        fecha: "2026-10-25",
        paradas: [
          {
            id: "p1-1", placeId: "geo-victorias", nombre: "Parque Nacional Las Victorias", lat: 15.4777, lng: -90.3826,
            horaApertura: "06:00", horaCierre: "18:00", tiempoEstanciaMinutos: 120,
            llegada: "2026-10-25T09:00-06:00", salida: "2026-10-25T11:00-06:00", estadoEstancia: "completa" as const,
            traslado: null, categorias: ["national_park"], tipo_entorno: "outdoor" as const, sensibilidad_clima: "alta" as const,
            horarioEstimado: true, motivo: "Bosque nuboso dentro de la ciudad.",
          },
          {
            id: "p1-2", placeId: "geo-palacio", nombre: "Palacio Municipal", lat: 15.4707, lng: -90.3734,
            tiempoEstanciaMinutos: 45,
            llegada: "2026-10-25T11:22-06:00", salida: "2026-10-25T12:07-06:00", estadoEstancia: "ajustada" as const,
            traslado, horarioEstimado: false,
          },
        ],
      },
    ],
    diasSinParadas: [{ numeroDia: 2, fecha: "2026-10-26" }],
    advertencias: ["1 parada(s) no publican horario; se usó uno típico de su tipo. Confírmalo antes de ir."],
  };
}

describe("convertirRespuesta", () => {
  test("adapta las paradas del backend al formato del paso 4", () => {
    const { itinerarios, destino } = convertirRespuesta(respuesta());
    const [primera, segunda] = itinerarios[0].paradas as ParadaConHorario[];

    assert.deepEqual(destino, { lat: 15.4702, lng: -90.3735 });
    assert.equal(primera.horaInicioProgramada, "09:00");
    assert.equal(primera.horaFinProgramada, "11:00");
    assert.equal(primera.horarioEstimado, true);
    assert.equal(primera.tiempoTrasladoMinutos, 0);
    assert.equal(primera.holgura, undefined);
    assert.equal(primera.motivo, "Bosque nuboso dentro de la ciudad.");

    assert.equal(segunda.tiempoTrasladoMinutos, 6);
    assert.equal(segunda.tiempoTrasladoConHolguraMinutos, 22);
    assert.deepEqual(segunda.holgura, traslado);
    assert.equal(segunda.estadoHorario, "ajustada");
    assert.match(segunda.mensajeHorario ?? "", /45 minutos/);
  });

  test("sin apertura y cierre del día muestra la ventana de la visita", () => {
    const [, segunda] = convertirRespuesta(respuesta()).itinerarios[0].paradas;
    assert.deepEqual([segunda.horaApertura, segunda.horaCierre], ["11:22", "12:07"]);
  });

  test("avisa de los días que quedaron sin paradas", () => {
    const { advertencias } = convertirRespuesta(respuesta());
    assert.equal(advertencias.length, 2);
    assert.match(advertencias[1], /día 2 quedó sin paradas/);
  });
});

describe("generarItinerario", () => {
  const fetchOriginal = globalThis.fetch;
  const viaje = { destino: "Cobán", fechaInicio: "2026-10-25", fechaFin: "2026-10-26", intereses: ["Naturaleza"] };

  before(() => {
    Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  test("envía los datos del viaje y completa el progreso", async () => {
    let cuerpo: Record<string, unknown> = {};
    globalThis.fetch = async (_url, opciones) => {
      cuerpo = JSON.parse(String(opciones?.body));
      return new Response(JSON.stringify(respuesta()), { status: 200 });
    };
    const progreso: number[] = [];

    const resultado = await generarItinerario(viaje, (n) => progreso.push(n));

    assert.equal(cuerpo.destino, "Cobán");
    assert.deepEqual(cuerpo.intereses, ["Naturaleza"]);
    assert.equal(resultado.itinerarios.length, 1);
    assert.equal(progreso.at(-1), 4);
  });

  test("envía la ubicación del viajero como punto de partida", async () => {
    let cuerpo: Record<string, unknown> = {};
    globalThis.fetch = async (_url, opciones) => {
      cuerpo = JSON.parse(String(opciones?.body));
      return new Response(JSON.stringify(respuesta()), { status: 200 });
    };

    await generarItinerario(viaje, undefined, undefined, { lat: 14.6105, lng: -89.995 });

    assert.deepEqual(cuerpo.origen, { lat: 14.6105, lng: -89.995 });
  });

  test("muestra el mensaje del backend cuando falla", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { codigo: "DESTINO_NO_ENCONTRADO", mensaje: "No encontramos \"zzz\" en Guatemala." } }), { status: 422 });

    await assert.rejects(generarItinerario(viaje), /No encontramos "zzz" en Guatemala/);
  });

  test("explica cuando no hay conexión con el servidor", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await assert.rejects(generarItinerario(viaje), /No se pudo conectar con el servidor/);
  });
});
