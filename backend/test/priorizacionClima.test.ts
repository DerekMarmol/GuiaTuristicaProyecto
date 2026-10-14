import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { priorizarPorClima, type PronosticoDia } from "../src/clima/priorizacion";

type Entorno = "indoor" | "outdoor";
type Sensibilidad = "baja" | "media" | "alta";

interface LugarPrueba {
  id: string;
  lat: number;
  lng: number;
  duracion: number;
  horario: { estado: string };
  tipo_entorno: Entorno;
  sensibilidad_clima: Sensibilidad;
}

function lugar(id: string, tipo_entorno: Entorno, sensibilidad_clima: Sensibilidad): LugarPrueba {
  return Object.freeze({ id, lat: 14.6, lng: -90.5, duracion: 60, horario: Object.freeze({ estado: "disponible" }), tipo_entorno, sensibilidad_clima });
}

function ids(lugares: readonly LugarPrueba[]): string[] {
  return lugares.map((l) => l.id);
}

const LLUVIA: PronosticoDia = { estado: "disponible", lluviaMm: 4.5 };
const SECO: PronosticoDia = { estado: "disponible", lluviaMm: 0 };

describe("priorizarPorClima - con lluvia pronosticada", () => {
  test("una propuesta outdoor–indoor se devuelve indoor–outdoor", () => {
    const entrada = [lugar("parque", "outdoor", "alta"), lugar("museo", "indoor", "baja")];

    const { lugares, decision } = priorizarPorClima(entrada, LLUVIA);

    assert.deepEqual(ids(lugares), ["museo", "parque"]);
    assert.deepEqual(decision, {
      estadoPronostico: "disponible",
      lluviaMm: 4.5,
      prioridadAplicada: true,
      ordenModificado: true,
      motivo: "lluvia_pronosticada",
      mensaje: decision.mensaje,
    });
    assert.ok(decision.mensaje.length > 0);
  });

  test("una lluvia positiva inferior a 10 mm también activa la regla", () => {
    for (const lluviaMm of [0.01, 0.2, 9.99]) {
      const { lugares, decision } = priorizarPorClima([lugar("parque", "outdoor", "alta"), lugar("museo", "indoor", "baja")], { estado: "disponible", lluviaMm });
      assert.equal(decision.prioridadAplicada, true, String(lluviaMm));
      assert.deepEqual(ids(lugares), ["museo", "parque"], String(lluviaMm));
    }
  });

  test("la sensibilidad ordena dentro de cada grupo de entorno", () => {
    const entrada = [
      lugar("o-alta", "outdoor", "alta"),
      lugar("i-alta", "indoor", "alta"),
      lugar("o-baja", "outdoor", "baja"),
      lugar("i-media", "indoor", "media"),
      lugar("o-media", "outdoor", "media"),
      lugar("i-baja", "indoor", "baja"),
    ];

    assert.deepEqual(ids(priorizarPorClima(entrada, LLUVIA).lugares), ["i-baja", "i-media", "i-alta", "o-baja", "o-media", "o-alta"]);
  });

  test("el entorno prevalece sobre la sensibilidad: un outdoor de sensibilidad baja no adelanta a un indoor", () => {
    const entrada = [lugar("mercado", "outdoor", "baja"), lugar("iglesia", "indoor", "alta")];

    assert.deepEqual(ids(priorizarPorClima(entrada, LLUVIA).lugares), ["iglesia", "mercado"]);
  });

  test("los empates conservan el orden original", () => {
    const entrada = [
      lugar("museo-1", "indoor", "baja"),
      lugar("parque-1", "outdoor", "alta"),
      lugar("museo-2", "indoor", "baja"),
      lugar("parque-2", "outdoor", "alta"),
      lugar("museo-3", "indoor", "baja"),
    ];

    assert.deepEqual(ids(priorizarPorClima(entrada, LLUVIA).lugares), ["museo-1", "museo-2", "museo-3", "parque-1", "parque-2"]);
  });

  test("un día parcial con lluvia también activa la prioridad", () => {
    const { lugares, decision } = priorizarPorClima([lugar("parque", "outdoor", "alta"), lugar("museo", "indoor", "baja")], { estado: "parcial", lluviaMm: 1.2 });

    assert.deepEqual(ids(lugares), ["museo", "parque"]);
    assert.equal(decision.estadoPronostico, "parcial");
    assert.equal(decision.motivo, "lluvia_pronosticada");
  });
});

describe("priorizarPorClima - sin aplicar la prioridad", () => {
  const ENTRADA = [lugar("parque", "outdoor", "alta"), lugar("museo", "indoor", "baja"), lugar("playa", "outdoor", "alta")];

  const casos: [descripcion: string, pronostico: PronosticoDia | null, estado: string, lluvia: number | null, motivo: string][] = [
    ["día disponible sin lluvia", SECO, "disponible", 0, "sin_lluvia_pronosticada"],
    ["día parcial sin lluvia", { estado: "parcial", lluviaMm: 0 }, "parcial", 0, "sin_lluvia_en_cobertura_parcial"],
    ["fecha sin datos", { estado: "sin_datos", lluviaMm: null }, "sin_datos", null, "pronostico_sin_datos"],
    ["fecha fuera de cobertura", { estado: "fuera_de_cobertura", lluviaMm: null }, "fuera_de_cobertura", null, "pronostico_fuera_de_cobertura"],
    ["consulta meteorológica fallida", null, "error_consulta", null, "consulta_clima_fallida"],
    ["estado disponible sin cantidad de lluvia", { estado: "disponible", lluviaMm: null }, "disponible", null, "pronostico_sin_datos"],
  ];

  for (const [descripcion, pronostico, estado, lluvia, motivo] of casos) {
    test(`${descripcion}: conserva exactamente el orden de entrada`, () => {
      const { lugares, decision } = priorizarPorClima(ENTRADA, pronostico);

      assert.deepEqual(ids(lugares), ["parque", "museo", "playa"]);
      lugares.forEach((l, i) => assert.equal(l, ENTRADA[i]));
      assert.equal(decision.prioridadAplicada, false);
      assert.equal(decision.ordenModificado, false);
      assert.equal(decision.estadoPronostico, estado);
      assert.equal(decision.lluviaMm, lluvia);
      assert.equal(decision.motivo, motivo);
    });
  }

  test("un día parcial sin lluvia no se describe como un día completo sin lluvia", () => {
    const parcial = priorizarPorClima(ENTRADA, { estado: "parcial", lluviaMm: 0 }).decision;
    const completo = priorizarPorClima(ENTRADA, SECO).decision;

    assert.notEqual(parcial.motivo, completo.motivo);
    assert.notEqual(parcial.mensaje, completo.mensaje);
    assert.match(parcial.mensaje, /parte del día/);
  });

  test("la ausencia de pronóstico no se confunde con cero lluvia", () => {
    for (const pronostico of [{ estado: "sin_datos", lluviaMm: null } as const, { estado: "fuera_de_cobertura", lluviaMm: null } as const, null]) {
      const { decision } = priorizarPorClima(ENTRADA, pronostico);
      assert.equal(decision.lluviaMm, null);
      assert.notEqual(decision.motivo, "sin_lluvia_pronosticada");
    }
  });
});

describe("priorizarPorClima - casos límite e invariantes", () => {
  test("arreglo vacío y un solo lugar", () => {
    assert.deepEqual(priorizarPorClima([], LLUVIA).lugares, []);
    assert.equal(priorizarPorClima([], LLUVIA).decision.ordenModificado, false);

    const unico = lugar("parque", "outdoor", "alta");
    const resultado = priorizarPorClima([unico], LLUVIA);
    assert.deepEqual(resultado.lugares, [unico]);
    assert.equal(resultado.decision.prioridadAplicada, true);
    assert.equal(resultado.decision.ordenModificado, false);
  });

  test("grupos del mismo entorno solo se ordenan por sensibilidad y posición", () => {
    const exteriores = [lugar("a", "outdoor", "alta"), lugar("b", "outdoor", "media"), lugar("c", "outdoor", "alta")];
    const interiores = [lugar("x", "indoor", "baja"), lugar("y", "indoor", "baja")];

    assert.deepEqual(ids(priorizarPorClima(exteriores, LLUVIA).lugares), ["b", "a", "c"]);
    const resultadoInteriores = priorizarPorClima(interiores, LLUVIA);
    assert.deepEqual(ids(resultadoInteriores.lugares), ["x", "y"]);
    assert.equal(resultadoInteriores.decision.ordenModificado, false);
  });

  test("no muta la entrada, no pierde ni duplica lugares y no cambia sus datos", () => {
    const entrada = Object.freeze([
      lugar("parque", "outdoor", "alta"),
      lugar("museo", "indoor", "baja"),
      lugar("mercado", "outdoor", "media"),
      lugar("cafe", "indoor", "baja"),
    ]);
    const copia = JSON.stringify(entrada);

    const { lugares } = priorizarPorClima(entrada, LLUVIA);

    assert.equal(JSON.stringify(entrada), copia);
    assert.notEqual(lugares, entrada);
    assert.equal(lugares.length, entrada.length);
    assert.equal(new Set(lugares).size, lugares.length);
    assert.deepEqual(new Set(lugares), new Set(entrada));
    for (const resultado of lugares) {
      const original = entrada.find((l) => l.id === resultado.id);
      assert.equal(resultado, original);
    }
  });

  test("produce siempre el mismo resultado para la misma entrada", () => {
    const entrada = [lugar("p", "outdoor", "alta"), lugar("m", "indoor", "media"), lugar("c", "indoor", "baja"), lugar("k", "outdoor", "media")];

    const primero = priorizarPorClima(entrada, LLUVIA);
    const segundo = priorizarPorClima(entrada, LLUVIA);

    assert.deepEqual(ids(primero.lugares), ids(segundo.lugares));
    assert.deepEqual(primero.decision, segundo.decision);
  });

  test("dos días con pronósticos distintos se procesan de forma independiente", () => {
    const dia1 = [lugar("parque", "outdoor", "alta"), lugar("museo", "indoor", "baja")];
    const dia2 = [lugar("mirador", "outdoor", "alta"), lugar("cafe", "indoor", "baja")];

    const conLluvia = priorizarPorClima(dia1, LLUVIA);
    const sinLluvia = priorizarPorClima(dia2, SECO);

    assert.deepEqual(ids(conLluvia.lugares), ["museo", "parque"]);
    assert.deepEqual(ids(sinLluvia.lugares), ["mirador", "cafe"]);
    assert.equal(conLluvia.decision.prioridadAplicada, true);
    assert.equal(sinLluvia.decision.prioridadAplicada, false);
  });
});
