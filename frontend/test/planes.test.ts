import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { convertirPlan } from "../src/services/planes.ts";

const planDelServidor = {
  id: "plan-1",
  destino: "Jalapa",
  tipoViaje: "solo" as const,
  lat: 14.6344,
  lng: -89.9898,
  presupuesto: 1000,
  transporte: "Moto" as const,
  intereses: ["Compras"],
  fechaInicio: "2026-10-23T00:00:00.000Z",
  fechaFin: "2026-10-24T00:00:00.000Z",
  hospedaje: false,
  nombreHotel: null,
  itinerarios: [
    {
      id: "it-a",
      numeroDia: 1,
      fecha: "2026-10-23T00:00:00.000Z",
      paradas: [
        {
          id: "par-1", nombre: "Plaza San Francisco", lat: 14.63, lng: -89.99, horaApertura: "09:00", horaCierre: "19:00",
          tiempoEstanciaMinutos: 60, placeId: "geo-1", restriccion: { tipoEntorno: "Bajo Techo", sensibilidadClima: "baja" },
        },
        {
          id: "par-2", nombre: "Parque Central", lat: 14.634, lng: -89.989, horaApertura: "06:00", horaCierre: "18:00",
          tiempoEstanciaMinutos: 45, placeId: null, restriccion: null,
        },
      ],
    },
  ],
};

describe("convertirPlan (GUI-114)", () => {
  test("arma el viaje del paso 4 a partir del plan guardado", () => {
    const { viaje } = convertirPlan(planDelServidor);
    assert.equal(viaje.fechaInicio, "2026-10-23");
    assert.equal(viaje.fechaFin, "2026-10-24");
    assert.equal(viaje.presupuestoDiario, 500);
    assert.equal(viaje.idPlanGuardado, "plan-1");
    assert.equal(viaje.nombreHotel, undefined);
  });

  test("conserva las paradas en orden con su entorno para el clima", () => {
    const { itinerarios } = convertirPlan(planDelServidor);
    const [primera, segunda] = itinerarios[0].paradas;
    assert.equal(itinerarios[0].fecha, "2026-10-23");
    assert.deepEqual([primera.nombre, segunda.nombre], ["Plaza San Francisco", "Parque Central"]);
    assert.equal(primera.tipo_entorno, "indoor");
    assert.equal(primera.sensibilidad_clima, "baja");
    assert.equal(primera.placeId, "geo-1");
    assert.equal(segunda.tipo_entorno, undefined);
  });
});
