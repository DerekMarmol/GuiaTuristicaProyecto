import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ErrorApi } from "../src/errores";
import { RUTA_CATALOGO_TARIFAS, crearLectorCatalogo, validarCatalogo, type TarifaHotel } from "../src/hoteles/catalogo";
import { calcularCentro, distanciaMetros } from "../src/hoteles/geografia";
import { deduplicarLugares, ordenarPorCercania } from "../src/hoteles/recomendaciones";
import { aCentavos, calcularPresupuestoHospedajeCentavos, seleccionarTarifas, tarifaAplica } from "../src/hoteles/tarifas";
import type { Lugar } from "../src/geoapify/transformar";

function tarifa(cambios: Partial<TarifaHotel> = {}): TarifaHotel {
  return {
    id: "tarifa-ficticia-1",
    idExterno: "hotel-ficticio-1",
    importeCentavos: 20000,
    moneda: "GTQ",
    unidad: "habitacion_noche",
    ocupacion: 2,
    importeTotal: true,
    impuestosIncluidos: true,
    vigenciaDesde: "2026-10-01",
    vigenciaHasta: "2026-10-31",
    verificadoEn: "2026-09-30",
    fuente: { tipo: "cotizacion", referencia: "Cotización ficticia de prueba" },
    ...cambios,
  };
}

function lugar(idExterno: string, lat = 14.6, lng = -90.5): Lugar {
  return {
    idExterno,
    proveedor: "geoapify",
    nombre: `Hotel ${idExterno}`,
    direccion: null,
    lat,
    lng,
    categorias: ["accommodation", "accommodation.hotel"],
    tipo_entorno: "indoor",
    sensibilidad_clima: "baja",
    regla_clima: "accommodation",
  };
}

const CONDICIONES = { fecha: "2026-10-14", moneda: "GTQ", ocupacion: 2, presupuestoHospedajeCentavos: 20000 };

describe("calcularCentro", () => {
  test("devuelve null sin paradas en lugar de inventar (0, 0)", () => {
    assert.equal(calcularCentro([]), null);
  });

  test("con una sola parada devuelve la misma coordenada, incluida (0, 0)", () => {
    const centro = calcularCentro([{ lat: 0, lng: 0 }]);
    assert.ok(centro);
    assert.ok(Math.abs(centro.lat) < 1e-12 && Math.abs(centro.lng) < 1e-12);
    const otro = calcularCentro([{ lat: 14.6349, lng: -90.5069 }]);
    assert.ok(otro);
    assert.ok(Math.abs(otro.lat - 14.6349) < 1e-9 && Math.abs(otro.lng + 90.5069) < 1e-9);
  });

  test("calcula el punto medio de paradas cercanas", () => {
    const centro = calcularCentro([
      { lat: 14.6, lng: -90.5 },
      { lat: 14.62, lng: -90.52 },
    ]);
    assert.ok(centro);
    assert.ok(Math.abs(centro.lat - 14.61) < 1e-4);
    assert.ok(Math.abs(centro.lng + 90.51) < 1e-4);
  });

  test("contempla el antimeridiano: el centro de 179.9 y -179.9 está en 180, no en 0", () => {
    const centro = calcularCentro([
      { lat: 0, lng: 179.9 },
      { lat: 0, lng: -179.9 },
    ]);
    assert.ok(centro);
    assert.ok(Math.abs(centro.lat) < 1e-9);
    assert.ok(Math.abs(Math.abs(centro.lng) - 180) < 1e-9);
    assert.ok(centro.lng >= -180 && centro.lng <= 180);
  });

  test("no depende del orden de las paradas", () => {
    const paradas = [
      { lat: 14.6, lng: -90.5 },
      { lat: 14.65, lng: -90.55 },
      { lat: 14.58, lng: -90.49 },
    ];
    const a = calcularCentro(paradas);
    const b = calcularCentro([paradas[2], paradas[0], paradas[1]]);
    assert.ok(a && b);
    assert.ok(Math.abs(a.lat - b.lat) < 1e-12 && Math.abs(a.lng - b.lng) < 1e-12);
  });

  test("devuelve null cuando las paradas son antípodas y el centro queda indeterminado", () => {
    assert.equal(calcularCentro([{ lat: 0, lng: 0 }, { lat: 0, lng: 180 }]), null);
  });
});

describe("distanciaMetros", () => {
  test("es cero para el mismo punto y simétrica", () => {
    assert.equal(distanciaMetros({ lat: 14.6, lng: -90.5 }, { lat: 14.6, lng: -90.5 }), 0);
    const ida = distanciaMetros({ lat: 14.6, lng: -90.5 }, { lat: 14.61, lng: -90.51 });
    const vuelta = distanciaMetros({ lat: 14.61, lng: -90.51 }, { lat: 14.6, lng: -90.5 });
    assert.equal(ida, vuelta);
  });

  test("un grado de latitud mide unos 111.2 km", () => {
    const metros = distanciaMetros({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(Math.abs(metros - 111195) < 5);
  });

  test("cruza el antimeridiano por el camino corto", () => {
    const metros = distanciaMetros({ lat: 0, lng: 179.99 }, { lat: 0, lng: -179.99 });
    assert.ok(metros < 2300 && metros > 2200);
  });
});

describe("presupuesto de hospedaje", () => {
  test("convierte quetzales con hasta dos decimales a centavos exactos", () => {
    assert.equal(aCentavos(500), 50000);
    assert.equal(aCentavos(0.29), 29);
    assert.equal(aCentavos(0.1 + 0.2), 30);
    assert.equal(aCentavos(1234.56), 123456);
    assert.equal(aCentavos(1_000_000), 100_000_000);
  });

  test("rechaza fracciones de centavo", () => {
    assert.equal(aCentavos(500.001), null);
    assert.equal(aCentavos(0.005), null);
  });

  test("calcula el 40 % del presupuesto diario y redondea hacia abajo", () => {
    assert.equal(calcularPresupuestoHospedajeCentavos(50000), 20000);
    assert.equal(calcularPresupuestoHospedajeCentavos(1), 0);
    assert.equal(calcularPresupuestoHospedajeCentavos(3), 1);
    assert.equal(calcularPresupuestoHospedajeCentavos(4), 1);
    assert.equal(calcularPresupuestoHospedajeCentavos(12346), 4938);
    assert.equal(calcularPresupuestoHospedajeCentavos(12347), 4938);
    assert.equal(calcularPresupuestoHospedajeCentavos(50002), 20000);
    assert.equal(calcularPresupuestoHospedajeCentavos(100_000_000), 40_000_000);
  });
});

describe("seleccionarTarifas", () => {
  test("admite una tarifa exactamente igual al presupuesto y excluye un centavo por encima", () => {
    const igual = seleccionarTarifas([tarifa({ importeCentavos: 20000 })], CONDICIONES);
    assert.equal(igual.get("hotel-ficticio-1")?.importeCentavos, 20000);
    const encima = seleccionarTarifas([tarifa({ importeCentavos: 20001 })], CONDICIONES);
    assert.equal(encima.size, 0);
  });

  test("excluye tarifas no vigentes, de otra moneda, de otra ocupación, sin impuestos confirmados o no totales", () => {
    const casos: [string, Partial<TarifaHotel>][] = [
      ["vigencia termina antes", { vigenciaHasta: "2026-10-13" }],
      ["vigencia empieza después", { vigenciaDesde: "2026-10-15" }],
      ["otra moneda", { moneda: "USD" }],
      ["ocupación menor", { ocupacion: 1 }],
      ["ocupación mayor", { ocupacion: 3 }],
      ["impuestos desconocidos", { impuestosIncluidos: null }],
      ["impuestos no incluidos", { impuestosIncluidos: false }],
      ["importe no total", { importeTotal: false }],
    ];
    for (const [nombre, cambios] of casos) {
      assert.equal(tarifaAplica(tarifa(cambios), CONDICIONES), false, nombre);
      assert.equal(seleccionarTarifas([tarifa(cambios)], CONDICIONES).size, 0, nombre);
    }
  });

  test("la vigencia incluye sus fechas inicial y final", () => {
    assert.equal(tarifaAplica(tarifa({ vigenciaDesde: "2026-10-14", vigenciaHasta: "2026-10-14" }), CONDICIONES), true);
  });

  test("elige la tarifa aplicable más económica y desempata por id sin depender del orden", () => {
    const tarifas = [
      tarifa({ id: "t-cara", importeCentavos: 18000 }),
      tarifa({ id: "t-c", importeCentavos: 15000 }),
      tarifa({ id: "t-a", importeCentavos: 15000 }),
      tarifa({ id: "t-0-otra-ocupacion", importeCentavos: 100, ocupacion: 1 }),
    ];
    assert.equal(seleccionarTarifas(tarifas, CONDICIONES).get("hotel-ficticio-1")?.id, "t-a");
    assert.equal(seleccionarTarifas([...tarifas].reverse(), CONDICIONES).get("hotel-ficticio-1")?.id, "t-a");
  });

  test("agrupa por idExterno exacto", () => {
    const seleccion = seleccionarTarifas(
      [tarifa({ id: "a", idExterno: "hotel-1" }), tarifa({ id: "b", idExterno: "HOTEL-1" })],
      CONDICIONES,
    );
    assert.deepEqual([...seleccion.keys()].sort(), ["HOTEL-1", "hotel-1"]);
  });
});

describe("orden y deduplicación de candidatos", () => {
  test("ordena por distancia sin redondear y desempata por idExterno", () => {
    const candidatos = [
      { distancia: 100.4, lugar: { idExterno: "c" } },
      { distancia: 100.2, lugar: { idExterno: "z" } },
      { distancia: 50, lugar: { idExterno: "b" } },
      { distancia: 50, lugar: { idExterno: "a" } },
    ];
    assert.deepEqual(ordenarPorCercania(candidatos).map((c) => c.lugar.idExterno), ["a", "b", "z", "c"]);
    assert.deepEqual(ordenarPorCercania([...candidatos].reverse()).map((c) => c.lugar.idExterno), ["a", "b", "z", "c"]);
    assert.equal(candidatos[0].lugar.idExterno, "c");
  });

  test("elimina hoteles repetidos por idExterno conservando el primero", () => {
    const resultado = deduplicarLugares([lugar("h1", 1, 1), lugar("h2"), lugar("h1", 2, 2)]);
    assert.deepEqual(resultado.map((l) => [l.idExterno, l.lat]), [["h1", 1], ["h2", 14.6]]);
  });
});

describe("validarCatalogo", () => {
  beforeEach(() => {
    mock.method(console, "error", () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  function esInvalido(datos: unknown): void {
    assert.throws(
      () => validarCatalogo(datos),
      (error: unknown) => error instanceof ErrorApi && error.estado === 500 && error.codigo === "CATALOGO_TARIFAS_INVALIDO",
    );
  }

  test("acepta un catálogo vacío", () => {
    assert.deepEqual(validarCatalogo({ tarifas: [] }), []);
  });

  test("acepta tarifas completas con fuente URL o cotización y otra moneda", () => {
    const tarifas = validarCatalogo({
      tarifas: [
        tarifa(),
        tarifa({ id: "t2", fuente: { tipo: "url", referencia: "https://ejemplo.invalid/tarifas" } }),
        tarifa({ id: "t3", moneda: "USD", impuestosIncluidos: null, nombreReferencia: "Solo para mantenimiento" }),
      ],
    });
    assert.equal(tarifas.length, 3);
  });

  test("rechaza estructuras e incoherencias", () => {
    const { fuente: _fuente, ...sinFuente } = tarifa();
    const casos: unknown[] = [
      null,
      [],
      {},
      { tarifas: {} },
      { tarifas: [], extra: true },
      { tarifas: [sinFuente] },
      { tarifas: [tarifa(), tarifa()] },
      { tarifas: [tarifa({ vigenciaDesde: "2026-11-01", vigenciaHasta: "2026-10-01" })] },
      { tarifas: [tarifa({ vigenciaDesde: "2026-02-30" })] },
      { tarifas: [tarifa({ verificadoEn: "30/09/2026" })] },
      { tarifas: [tarifa({ importeCentavos: 0 })] },
      { tarifas: [tarifa({ importeCentavos: -100 })] },
      { tarifas: [tarifa({ importeCentavos: 199.5 })] },
      { tarifas: [tarifa({ moneda: "gtq" })] },
      { tarifas: [tarifa({ unidad: "persona_noche" as "habitacion_noche" })] },
      { tarifas: [tarifa({ ocupacion: 0 })] },
      { tarifas: [tarifa({ ocupacion: 1.5 })] },
      { tarifas: [tarifa({ idExterno: " " })] },
      { tarifas: [tarifa({ fuente: { tipo: "url", referencia: "ftp://ejemplo.invalid/tarifa" } })] },
      { tarifas: [tarifa({ fuente: { tipo: "url", referencia: "no es una url" } })] },
      { tarifas: [tarifa({ fuente: { tipo: "cotizacion", referencia: "" } })] },
      { tarifas: [{ ...tarifa(), precioDesde: true }] },
      { tarifas: [{ ...tarifa(), importeTotal: undefined }] },
    ];
    for (const caso of casos) {
      esInvalido(caso);
    }
  });

  test("no incluye el contenido del catálogo en el error", () => {
    try {
      validarCatalogo({ tarifas: [tarifa({ fuente: { tipo: "cotizacion", referencia: "SECRETO-INTERNO" }, importeCentavos: 0 })] });
      assert.fail("debía lanzar un error");
    } catch (error) {
      assert.ok(error instanceof ErrorApi);
      assert.ok(!error.message.includes("SECRETO-INTERNO"));
      assert.equal(error.detalles, undefined);
    }
  });
});

describe("crearLectorCatalogo", () => {
  beforeEach(() => {
    mock.method(console, "error", () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("el catálogo de producción existe, es válido y está vacío", async () => {
    assert.ok(existsSync(RUTA_CATALOGO_TARIFAS));
    assert.equal(path.basename(path.dirname(RUTA_CATALOGO_TARIFAS)), "data");
    assert.deepEqual(validarCatalogo(await crearLectorCatalogo()()), []);
  });

  test("lee un archivo con BOM y distingue JSON inválido de archivo ausente", async () => {
    const carpeta = await mkdtemp(path.join(os.tmpdir(), "catalogo-hoteles-"));
    try {
      const valido = path.join(carpeta, "valido.json");
      await writeFile(valido, `\uFEFF${JSON.stringify({ tarifas: [tarifa()] })}`, "utf8");
      assert.equal(validarCatalogo(await crearLectorCatalogo(valido)()).length, 1);

      const roto = path.join(carpeta, "roto.json");
      await writeFile(roto, "{ tarifas: [", "utf8");
      await assert.rejects(crearLectorCatalogo(roto)(), (error: unknown) => error instanceof ErrorApi && error.codigo === "CATALOGO_TARIFAS_INVALIDO");

      await assert.rejects(
        crearLectorCatalogo(path.join(carpeta, "no-existe.json"))(),
        (error: unknown) => error instanceof ErrorApi && error.estado === 500 && error.codigo === "CATALOGO_TARIFAS_NO_DISPONIBLE",
      );
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });
});
