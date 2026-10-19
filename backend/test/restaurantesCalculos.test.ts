import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ErrorApi } from "../src/errores";
import type { ConsultaBusqueda } from "../src/geoapify/cliente";
import { aCentavos, calcularPresupuestoHospedajeCentavos, PORCENTAJE_HOSPEDAJE } from "../src/hoteles/tarifas";
import { CATEGORIAS_RESTAURANTES, RESULTADOS_PROVEEDOR_POR_PARADA, crearBuscadorRestaurantes } from "../src/restaurantes/busqueda";
import {
  CATALOGO_TARIFAS_RESTAURANTES,
  crearAsignadorTarifas,
  fuentesDelCatalogo,
  validarCatalogo,
  type CatalogoTarifasRestaurantes,
  type ReferenciaTarifa,
} from "../src/restaurantes/catalogo";
import { ejecutarConLimite } from "../src/restaurantes/planificador";
import { claveBusqueda } from "../src/restaurantes/recomendaciones";
import {
  PORCENTAJE_ALIMENTACION,
  cabeEnPresupuesto,
  calcularCostoGrupoCentavos,
  calcularPresupuestoAlimentacionCentavos,
  calcularPresupuestoPorPersonaCentavos,
} from "../src/restaurantes/tarifas";

const referencia = (id: string): ReferenciaTarifa => {
  const encontrada = CATALOGO_TARIFAS_RESTAURANTES.referencias.find((r) => r.id === id);
  assert.ok(encontrada, `falta la referencia ${id}`);
  return encontrada;
};

function catalogoCon(cambios: Partial<ReferenciaTarifa>, indice = 0): CatalogoTarifasRestaurantes {
  const referencias = CATALOGO_TARIFAS_RESTAURANTES.referencias.map((r, i) => (i === indice ? { ...r, ...cambios } : r));
  return { ...CATALOGO_TARIFAS_RESTAURANTES, referencias };
}

describe("presupuesto de alimentación", () => {
  test("calcula exactamente el 30 % del presupuesto diario en centavos", () => {
    assert.equal(PORCENTAJE_ALIMENTACION, 30);
    assert.equal(calcularPresupuestoAlimentacionCentavos(aCentavos(500) as number), 15000);
    assert.equal(calcularPresupuestoAlimentacionCentavos(aCentavos(1000) as number), 30000);
    assert.equal(calcularPresupuestoAlimentacionCentavos(aCentavos(1_000_000) as number), 30_000_000);
  });

  test("con decimales redondea hacia abajo para no superar el 30 %", () => {
    assert.equal(aCentavos(466.67), 46667);
    assert.equal(calcularPresupuestoAlimentacionCentavos(46667), 14000);
    assert.equal(calcularPresupuestoAlimentacionCentavos(46666), 13999);
    assert.equal(calcularPresupuestoAlimentacionCentavos(aCentavos(0.1 + 0.2) as number), 9);
    assert.equal(calcularPresupuestoAlimentacionCentavos(1), 0);
    assert.equal(calcularPresupuestoAlimentacionCentavos(4), 1);
  });

  test("el presupuesto por persona es informativo y redondea hacia abajo", () => {
    assert.equal(calcularPresupuestoPorPersonaCentavos(15000, 2), 7500);
    assert.equal(calcularPresupuestoPorPersonaCentavos(15000, 1), 15000);
    assert.equal(calcularPresupuestoPorPersonaCentavos(10000, 3), 3333);
  });

  test("conserva el 40 % de hospedaje como asignación independiente sobre el mismo presupuesto", () => {
    assert.equal(PORCENTAJE_HOSPEDAJE, 40);
    const diario = aCentavos(500) as number;
    assert.equal(calcularPresupuestoHospedajeCentavos(diario), 20000);
    assert.equal(calcularPresupuestoAlimentacionCentavos(diario), 15000);
    assert.ok(calcularPresupuestoHospedajeCentavos(diario) + calcularPresupuestoAlimentacionCentavos(diario) <= diario);
  });
});

describe("costo referencial del grupo", () => {
  test("una persona usa el máximo del rango por persona", () => {
    assert.equal(calcularCostoGrupoCentavos(7000, 1), 7000);
  });

  test("multiplica el máximo por persona por la cantidad de comensales", () => {
    assert.equal(calcularCostoGrupoCentavos(7000, 2), 14000);
    assert.equal(calcularCostoGrupoCentavos(30000, 10), 300000);
  });

  test("admite costos inferiores o iguales al presupuesto y excluye los superiores", () => {
    assert.equal(cabeEnPresupuesto(14000, 15000), true);
    assert.equal(cabeEnPresupuesto(14000, 14000), true);
    assert.equal(cabeEnPresupuesto(14001, 14000), false);
    assert.equal(cabeEnPresupuesto(7000, 0), false);
  });

  test("rechaza importes no seguros o inválidos en lugar de compararlos", () => {
    assert.equal(calcularCostoGrupoCentavos(0, 2), null);
    assert.equal(calcularCostoGrupoCentavos(-7000, 2), null);
    assert.equal(calcularCostoGrupoCentavos(70.5, 2), null);
    assert.equal(calcularCostoGrupoCentavos(7000, 0), null);
    assert.equal(calcularCostoGrupoCentavos(7000, 1.5), null);
    assert.equal(calcularCostoGrupoCentavos(Number.MAX_SAFE_INTEGER, 2), null);
    assert.equal(cabeEnPresupuesto(null, 15000), false);
  });
});

describe("catálogo de tarifas referenciales", () => {
  test("el catálogo publicado es íntegro", () => {
    assert.deepEqual(validarCatalogo(CATALOGO_TARIFAS_RESTAURANTES), []);
  });

  test("usa los rangos documentados en GTQ por persona y comida", () => {
    assert.deepEqual([referencia("gt-comida-rapida").minimoCentavos, referencia("gt-comida-rapida").maximoCentavos], [5000, 7000]);
    assert.deepEqual([referencia("gt-patio-comidas").minimoCentavos, referencia("gt-patio-comidas").maximoCentavos], [3000, 10000]);
    assert.deepEqual([referencia("gt-restaurante-general").minimoCentavos, referencia("gt-restaurante-general").maximoCentavos], [3000, 30000]);
    for (const r of CATALOGO_TARIFAS_RESTAURANTES.referencias) {
      assert.equal(r.moneda, "GTQ");
      assert.equal(r.unidad, "persona_comida");
      assert.deepEqual(r.codigosPais, ["gt"]);
      assert.ok(r.fuentes.length > 0);
    }
  });

  test("solo clasifica como correspondiente la comida rápida; el resto es escenario general", () => {
    assert.equal(referencia("gt-comida-rapida").aplicabilidad, "perfil_correspondiente");
    assert.equal(referencia("gt-patio-comidas").aplicabilidad, "escenario_general");
    assert.equal(referencia("gt-restaurante-general").aplicabilidad, "escenario_general");
    assert.equal(referencia("gt-restaurante-general").confianza, "baja");
  });

  test("las fuentes son Numbeo y Preciosmundi con fecha de consulta", () => {
    assert.deepEqual(
      fuentesDelCatalogo(CATALOGO_TARIFAS_RESTAURANTES).map((f) => f.url),
      [
        "https://www.numbeo.com/cost-of-living/in/Guatemala-City",
        "https://www.numbeo.com/cost-of-living/country_result.jsp?country=Guatemala",
        "https://preciosmundi.com/guatemala/precio-restaurantes",
      ],
    );
    for (const r of CATALOGO_TARIFAS_RESTAURANTES.referencias) {
      for (const fuente of r.fuentes) {
        assert.equal(fuente.consultadoEn, "2026-10-18");
      }
    }
  });

  const invalidos: [string, CatalogoTarifasRestaurantes, RegExp][] = [
    ["mínimo mayor que el máximo", catalogoCon({ minimoCentavos: 8000, maximoCentavos: 7000 }), /mínimo supera/],
    ["mínimo cero", catalogoCon({ minimoCentavos: 0 }), /centavos enteros positivos/],
    ["fracciones de centavo", catalogoCon({ maximoCentavos: 7000.5 }), /centavos enteros positivos/],
    ["máximo no seguro", catalogoCon({ maximoCentavos: Number.MAX_SAFE_INTEGER + 2 }), /centavos enteros positivos/],
    ["otra moneda", catalogoCon({ moneda: "USD" as "GTQ" }), /GTQ/],
    ["sin fuentes", catalogoCon({ fuentes: [] }), /al menos una fuente/],
    ["fuente sin https", catalogoCon({ fuentes: [{ ...referencia("gt-comida-rapida").fuentes[0], url: "http://ejemplo.invalid" }] }), /URL https/],
    ["fecha de consulta inválida", catalogoCon({ fuentes: [{ ...referencia("gt-comida-rapida").fuentes[0], consultadoEn: "18/10/2026" }] }), /fecha de consulta/],
    ["sin región", catalogoCon({ codigosPais: [] }), /región/],
    ["identificador repetido", catalogoCon({ id: "gt-patio-comidas" }), /repetida/],
    [
      "regla hacia una referencia inexistente",
      { ...CATALOGO_TARIFAS_RESTAURANTES, reglas: [{ categoria: "catering.fast_food", referenciaId: "no-existe", justificacion: "x" }] },
      /inexistente/,
    ],
    [
      "categoría repetida",
      { ...CATALOGO_TARIFAS_RESTAURANTES, reglas: [...CATALOGO_TARIFAS_RESTAURANTES.reglas, CATALOGO_TARIFAS_RESTAURANTES.reglas[0]] },
      /más de una regla/,
    ],
  ];

  for (const [nombre, catalogo, problema] of invalidos) {
    test(`detecta un catálogo inválido y no lo usa: ${nombre}`, () => {
      const problemas = validarCatalogo(catalogo);
      assert.ok(problemas.some((p) => problema.test(p)), problemas.join(" | "));
      assert.throws(() => crearAsignadorTarifas(catalogo), /catálogo de tarifas de restaurantes no es válido/);
    });
  }
});

describe("asignación de tarifas por categoría", () => {
  const asignar = crearAsignadorTarifas();
  const idDe = (categorias: string[], pais: string | null = "gt") => {
    const asignacion = asignar(categorias, pais);
    return asignacion.estado === "estimado" ? asignacion.referencia.id : asignacion.motivo;
  };

  test("asigna cada categoría de Geoapify a su perfil, incluidas las subcategorías", () => {
    assert.equal(idDe(["catering", "catering.fast_food"]), "gt-comida-rapida");
    assert.equal(idDe(["catering", "catering.fast_food", "catering.fast_food.burger"]), "gt-comida-rapida");
    assert.equal(idDe(["catering", "catering.food_court"]), "gt-patio-comidas");
    assert.equal(idDe(["catering", "catering.restaurant"]), "gt-restaurante-general");
    assert.equal(idDe(["catering", "catering.restaurant", "catering.restaurant.pizza"]), "gt-restaurante-general");
  });

  test("no clasifica como económico un restaurante por su subcategoría", () => {
    assert.equal(idDe(["catering.restaurant.tacos"]), "gt-restaurante-general");
    assert.equal(idDe(["catering.restaurant.burger"]), "gt-restaurante-general");
  });

  test("si coinciden varios perfiles usa el de máximo más alto", () => {
    assert.equal(idDe(["catering.fast_food", "catering.restaurant"]), "gt-restaurante-general");
    assert.equal(idDe(["catering.restaurant", "catering.fast_food"]), "gt-restaurante-general");
    assert.equal(idDe(["catering.fast_food", "catering.food_court"]), "gt-patio-comidas");
  });

  test("sin categoría con referencia devuelve sin_estimacion", () => {
    assert.equal(idDe(["catering", "catering.cafe"]), "categoria_sin_referencia");
    assert.equal(idDe(["catering.bar"]), "categoria_sin_referencia");
    assert.equal(idDe(["catering.restaurantes"]), "categoria_sin_referencia");
    assert.equal(idDe([]), "categoria_sin_referencia");
  });

  test("fuera de Guatemala o sin país identificado devuelve sin_estimacion", () => {
    assert.equal(idDe(["catering.fast_food"], "mx"), "region_no_cubierta");
    assert.equal(idDe(["catering.fast_food"], null), "region_no_identificada");
  });
});

describe("búsqueda de restaurantes en Geoapify", () => {
  function buscadorCon(datos: unknown) {
    const consultas: ConsultaBusqueda[] = [];
    const buscar = crearBuscadorRestaurantes(async (consulta) => {
      consultas.push(consulta);
      return datos;
    });
    return { buscar, consultas };
  }

  test("consulta las categorías de comida principal alrededor del centro indicado", async () => {
    const { buscar, consultas } = buscadorCon({ features: [] });
    await buscar({ lat: 14.5586, lng: -90.7295 }, 2000);
    assert.deepEqual(consultas, [
      { lat: 14.5586, lng: -90.7295, categorias: ["catering.restaurant", "catering.fast_food", "catering.food_court"], radio: 2000, limite: RESULTADOS_PROVEEDOR_POR_PARADA },
    ]);
    assert.ok(!CATEGORIAS_RESTAURANTES.some((c) => c.includes("bar") || c.includes("cafe")));
  });

  test("normaliza resultados, conserva el país y cuenta los recibidos", async () => {
    const { buscar } = buscadorCon({
      features: [
        { properties: { place_id: "a", name: "A", lat: 14.6, lon: -90.5, categories: ["catering.fast_food"], country_code: "GT" } },
        { properties: { place_id: "b", name: "B", lat: 14.6, lon: -90.5, categories: ["catering.restaurant"] } },
        { properties: { place_id: "a", name: "A repetido", lat: 14.6, lon: -90.5, categories: ["catering.fast_food"], country_code: "gt" } },
        { properties: { place_id: "c", name: "C", lat: 214.6, lon: -90.5, categories: ["catering.restaurant"], country_code: "gt" } },
        { properties: { place_id: "d", lat: 14.6, lon: -90.5, categories: ["catering.restaurant"], country_code: "gt" } },
        null,
      ],
    });
    const resultado = await buscar({ lat: 14.6, lng: -90.5 }, 2000);
    assert.equal(resultado.resultadosRecibidos, 6);
    assert.deepEqual(
      resultado.restaurantes.map((r) => [r.idExterno, r.nombre, r.codigoPais]),
      [
        ["a", "A", "gt"],
        ["b", "B", null],
      ],
    );
  });

  test("una respuesta sin features es un error del proveedor, no una búsqueda vacía", async () => {
    const { buscar } = buscadorCon({ resultados: [] });
    await assert.rejects(buscar({ lat: 14.6, lng: -90.5 }, 2000), (error) => error instanceof ErrorApi && error.codigo === "PROVEEDOR_RESPUESTA_INVALIDA");
  });
});

describe("planificador de búsquedas", () => {
  const opciones = { concurrencia: 2, intervaloMs: 0, detenerTras: () => false };

  test("devuelve los resultados en el orden de entrada aunque terminen en otro orden", async () => {
    const resultados = await ejecutarConLimite([30, 5, 15], (ms) => new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms)), opciones);
    assert.deepEqual(resultados, [30, 5, 15].map((valor) => ({ estado: "completada", valor })));
  });

  test("no supera la concurrencia indicada", async () => {
    let activas = 0;
    let maximo = 0;
    await ejecutarConLimite(
      [1, 2, 3, 4, 5],
      async () => {
        activas++;
        maximo = Math.max(maximo, activas);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activas--;
      },
      opciones,
    );
    assert.equal(maximo, 2);
  });

  test("ninguna búsqueda empieza antes de su turno según el intervalo", async () => {
    const inicios: number[] = [];
    await ejecutarConLimite([1, 2, 3], async () => void inicios.push(Date.now()), { ...opciones, intervaloMs: 40 });
    for (let i = 1; i < inicios.length; i++) {
      assert.ok(inicios[i] - inicios[0] >= i * 40 - 2, `inicio ${i}: ${inicios[i] - inicios[0]} ms`);
    }
  });

  test("tras un error que detiene, no inicia las búsquedas pendientes", async () => {
    const fatal = new Error("fatal");
    const llamadas: number[] = [];
    const resultados = await ejecutarConLimite(
      [1, 2, 3],
      async (n) => {
        llamadas.push(n);
        if (n === 1) {
          throw fatal;
        }
        return n;
      },
      { concurrencia: 1, intervaloMs: 0, detenerTras: (error) => error === fatal },
    );
    assert.deepEqual(llamadas, [1]);
    assert.deepEqual(resultados, [
      { estado: "fallida", error: fatal },
      { estado: "omitida", causa: fatal },
      { estado: "omitida", causa: fatal },
    ]);
  });

  test("identifica búsquedas equivalentes por coordenadas con 7 decimales", () => {
    assert.equal(claveBusqueda({ lat: 14.5586, lng: -90.7295 }), claveBusqueda({ lat: 14.55860000001, lng: -90.7295 }));
    assert.notEqual(claveBusqueda({ lat: 14.5586, lng: -90.7295 }), claveBusqueda({ lat: 14.5587, lng: -90.7295 }));
  });
});
