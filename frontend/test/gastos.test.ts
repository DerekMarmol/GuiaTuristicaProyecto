import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Itinerario } from "../../shared/types";
import { cobraEntrada, generarGastosSimulados } from "../src/services/gastos.ts";

function parada(id: string, categorias: string[]) {
  return { id, nombre: id, lat: 14.63, lng: -89.99, horaApertura: "09:00", horaCierre: "17:00", tiempoEstanciaMinutos: 60, categorias };
}

function dia(paradas: ReturnType<typeof parada>[]): Itinerario {
  // id elegido para que el tope simulado del día deje entrar todos los gastos.
  return { id: "it-x", viajeId: "v", numeroDia: 1, fecha: "2026-10-25", paradas };
}

describe("cobraEntrada", () => {
  test("parques, plazas, playas y restaurantes no cobran", () => {
    assert.equal(cobraEntrada({ categorias: ["leisure", "leisure.park"] }), false);
    assert.equal(cobraEntrada({ categorias: ["beach"] }), false);
    assert.equal(cobraEntrada({ categorias: ["tourism.sights.memorial"] }), false);
    assert.equal(cobraEntrada({ categorias: ["catering.restaurant"] }), false);
    assert.equal(cobraEntrada({}), false);
  });

  test("museos, parques nacionales y sitios arqueológicos cobran", () => {
    assert.equal(cobraEntrada({ categorias: ["entertainment", "entertainment.museum"] }), true);
    assert.equal(cobraEntrada({ categorias: ["leisure.park", "national_park"] }), true);
    assert.equal(cobraEntrada({ categorias: ["tourism.sights.archaeological_site"] }), true);
  });

  test("respeta las marcas fee y no_fee de Geoapify", () => {
    assert.equal(cobraEntrada({ categorias: ["entertainment.museum", "no_fee"] }), false);
    assert.equal(cobraEntrada({ categorias: ["leisure.park", "fee"] }), true);
  });
});

describe("generarGastosSimulados", () => {
  test("no simula entrada a un parque central", () => {
    const gastos = generarGastosSimulados([dia([parada("Parque Central de Jalapa", ["leisure.park"]), parada("Comedor", ["catering.restaurant"])])], 10_000);
    assert.equal(gastos.filter((g) => g.categoria === "Entradas").length, 0);
  });

  test("simula entrada solo a los lugares que cobran", () => {
    const gastos = generarGastosSimulados([
      dia([parada("Parque Central", ["leisure.park"]), parada("Museo", ["entertainment.museum"]), parada("Las Victorias", ["national_park"])]),
    ], 10_000);
    assert.deepEqual(
      gastos.filter((g) => g.categoria === "Entradas").map((g) => g.descripcion),
      ["Entrada a Museo", "Entrada a Las Victorias"],
    );
  });
});
