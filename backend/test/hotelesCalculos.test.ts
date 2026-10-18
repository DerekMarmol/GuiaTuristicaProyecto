import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calcularCentro, distanciaMetros } from "../src/hoteles/geografia";
import { esFechaPasadaEnTodasLasZonas, fechaSalida } from "../src/hoteles/estancia";
import { deduplicarPorId, ordenarPorCercania } from "../src/hoteles/recomendaciones";
import { aCentavos, calcularPresupuestoHospedajeCentavos, convertirCentavos, seleccionarPrecio } from "../src/hoteles/tarifas";

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
  test("convierte importes con hasta dos decimales a centavos exactos", () => {
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
    assert.equal(calcularPresupuestoHospedajeCentavos(49999), 19999);
    assert.equal(calcularPresupuestoHospedajeCentavos(100_000_000), 40_000_000);
  });
});

describe("convertirCentavos (USD a GTQ)", () => {
  test("fixture de prueba: USD 24 con tasa ficticia 7.65 da Q183.60 y cabe en Q200", () => {
    const quetzales = convertirCentavos(2400, 7.65);
    assert.equal(quetzales, 18360);
    assert.ok(quetzales !== null && quetzales <= calcularPresupuestoHospedajeCentavos(50000));
  });

  test("redondea una sola vez al centavo más cercano y las mitades exactas hacia arriba", () => {
    assert.equal(convertirCentavos(1, 0.5), 1);
    assert.equal(convertirCentavos(1, 0.49), 0);
    assert.equal(convertirCentavos(3, 0.5), 2);
    assert.equal(convertirCentavos(2449, 7.7531), 18987);
    assert.equal(convertirCentavos(100, 7.123456789), 712);
    assert.equal(convertirCentavos(1, 7.125), 7);
    assert.equal(convertirCentavos(2, 7.125), 14);
    assert.equal(convertirCentavos(10, 7.125), 71);
    assert.equal(convertirCentavos(20, 7.125), 143);
  });

  test("usa la tasa completa sin redondearla antes a dos decimales", () => {
    assert.equal(convertirCentavos(100_000, 7.6549), 765490);
    assert.notEqual(convertirCentavos(100_000, 7.6549), convertirCentavos(100_000, 7.65));
  });

  test("opera en decimal exacto, sin errores de coma flotante", () => {
    assert.equal(convertirCentavos(1000, 0.1 + 0.2), 300);
    assert.equal(convertirCentavos(3, 1.005), 3);
    assert.equal(convertirCentavos(1, 1e-7), 0);
    assert.equal(convertirCentavos(10_000_000, 1.5e-7), 2);
    assert.equal(convertirCentavos(100, 1e21), null);
  });

  test("límite exacto: igual al límite se admite y un centavo por encima no", () => {
    const limite = calcularPresupuestoHospedajeCentavos(50000);
    assert.equal(convertirCentavos(2500, 8), limite);
    assert.equal(convertirCentavos(2500, 8.0004), limite + 1);
    assert.equal(calcularPresupuestoHospedajeCentavos(49999), limite - 1);
  });

  test("rechaza tasas o importes no válidos en lugar de suponer 1:1", () => {
    for (const tasa of [0, -7.65, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(convertirCentavos(2400, tasa), null, String(tasa));
    }
    assert.equal(convertirCentavos(24.5, 7.65), null);
    assert.equal(convertirCentavos(-1, 7.65), null);
  });
});

describe("fechaSalida", () => {
  test("la salida es el día calendario siguiente", () => {
    assert.equal(fechaSalida("2026-10-14"), "2026-10-15");
  });

  test("calcula fin de mes, fin de año y años bisiestos", () => {
    assert.equal(fechaSalida("2026-04-30"), "2026-05-01");
    assert.equal(fechaSalida("2026-10-31"), "2026-11-01");
    assert.equal(fechaSalida("2026-12-31"), "2027-01-01");
    assert.equal(fechaSalida("2026-02-28"), "2026-03-01");
    assert.equal(fechaSalida("2028-02-28"), "2028-02-29");
    assert.equal(fechaSalida("2028-02-29"), "2028-03-01");
    assert.equal(fechaSalida("2100-02-28"), "2100-03-01");
    assert.equal(fechaSalida("2000-02-28"), "2000-02-29");
  });

  test("devuelve null para fechas irreales o sin día siguiente representable", () => {
    assert.equal(fechaSalida("2026-02-29"), null);
    assert.equal(fechaSalida("2026-13-01"), null);
    assert.equal(fechaSalida("14/10/2026"), null);
    assert.equal(fechaSalida("9999-12-31"), null);
  });

  test("solo rechaza como pasada una fecha anterior al día actual en todas las zonas horarias", () => {
    const ahora = new Date("2026-10-10T02:00:00Z");
    assert.equal(esFechaPasadaEnTodasLasZonas("2026-10-09", ahora), false);
    assert.equal(esFechaPasadaEnTodasLasZonas("2026-10-08", ahora), true);
    assert.equal(esFechaPasadaEnTodasLasZonas("2026-10-10", ahora), false);
    const finDelDiaUtc = new Date("2026-10-10T23:59:59Z");
    assert.equal(esFechaPasadaEnTodasLasZonas("2026-10-09", finDelDiaUtc), false);
  });
});

describe("seleccionarPrecio", () => {
  const bloque = (total: number, antes?: number) => ({
    lowest: `$${total}`,
    extracted_lowest: total,
    ...(antes === undefined ? {} : { before_taxes_fees: `$${antes}`, extracted_before_taxes_fees: antes }),
  });

  test("caso observado: usa el total estructurado de USD 24 con impuestos informados y no el de USD 21 antes de impuestos", () => {
    const precio = seleccionarPrecio(
      {
        rate_per_night: bloque(24, 21),
        total_rate: bloque(24, 21),
        prices: [{ source: "Agencia", link: "https://www.google.com/travel/clk?price_displayed_total=24.49" }],
      },
      2,
    );
    assert.deepEqual(precio, {
      importeUsdCentavos: 2400,
      campo: "total_rate",
      impuestos: { estado: "informado", antesImpuestosUsdCentavos: 2100 },
      fuente: { tipo: "resumen_propiedad" },
    });
  });

  test("prioriza total_rate y solo usa rate_per_night si no existe un total utilizable", () => {
    assert.equal(seleccionarPrecio({ rate_per_night: bloque(20), total_rate: bloque(30) }, 2)?.campo, "total_rate");
    const porNoche = seleccionarPrecio({ rate_per_night: bloque(20) }, 2);
    assert.equal(porNoche?.campo, "rate_per_night");
    assert.equal(porNoche?.importeUsdCentavos, 2000);
    assert.equal(seleccionarPrecio({ rate_per_night: bloque(20), total_rate: { lowest: "$30" } }, 2)?.campo, "rate_per_night");
  });

  test("sin desglose informa impuestos no informados en lugar de suponerlos excluidos", () => {
    assert.deepEqual(seleccionarPrecio({ total_rate: bloque(24) }, 2)?.impuestos, { estado: "no_informado" });
    assert.deepEqual(seleccionarPrecio({ total_rate: { extracted_lowest: 24, extracted_before_taxes_fees: "21" } }, 2)?.impuestos, {
      estado: "no_informado",
    });
  });

  test("nunca usa el precio antes de impuestos como total ni un bloque incoherente", () => {
    assert.equal(seleccionarPrecio({ total_rate: { extracted_before_taxes_fees: 21 } }, 2), null);
    assert.equal(seleccionarPrecio({ total_rate: bloque(21, 24) }, 2), null);
    assert.equal(seleccionarPrecio({ total_rate: bloque(21, 24), rate_per_night: bloque(25) }, 2)?.campo, "rate_per_night");
  });

  test("descarta precios no numéricos, no positivos, no finitos o con fracciones de centavo y no lee importes de textos o enlaces", () => {
    const invalidos: unknown[] = [
      { lowest: "$24", extracted_lowest: "24" },
      { lowest: "$0", extracted_lowest: 0 },
      { extracted_lowest: -24 },
      { extracted_lowest: Number.POSITIVE_INFINITY },
      { extracted_lowest: 24.001 },
      { lowest: "$24.49", price_displayed_total: 24.49 },
      null,
      "24",
    ];
    for (const total_rate of invalidos) {
      assert.equal(seleccionarPrecio({ total_rate, link: "https://ejemplo.invalid/?price_displayed_total=24.49" }, 2), null, JSON.stringify(total_rate));
    }
  });

  test("conserva la fuente de la oferta y no combina su precio con impuestos de otra", () => {
    const precio = seleccionarPrecio(
      {
        rate_per_night: bloque(40, 30),
        prices: [
          { source: "Agencia B", num_guests: 2, rate_per_night: bloque(22) },
          { source: "Agencia A", num_guests: 2, rate_per_night: bloque(23, 19) },
        ],
      },
      2,
    );
    assert.deepEqual(precio, {
      importeUsdCentavos: 2200,
      campo: "rate_per_night",
      impuestos: { estado: "no_informado" },
      fuente: { tipo: "oferta", nombre: "Agencia B", oficial: false },
    });
  });

  test("excluye ofertas con otra ocupación y, si las hay, no usa el resumen de la propiedad", () => {
    const propiedad = {
      total_rate: bloque(20),
      prices: [
        { source: "Para dos", num_guests: 2, rate_per_night: bloque(15) },
        { source: "Para tres", num_guests: 3, rate_per_night: bloque(30) },
      ],
    };
    assert.deepEqual(seleccionarPrecio(propiedad, 3)?.fuente, { tipo: "oferta", nombre: "Para tres", oficial: false });
    assert.equal(seleccionarPrecio({ total_rate: bloque(20), prices: [{ source: "Para dos", num_guests: 2, rate_per_night: bloque(15) }] }, 3), null);
    assert.equal(seleccionarPrecio({ total_rate: bloque(20), prices: [{ source: "Sin ocupación", rate_per_night: bloque(15) }] }, 3)?.importeUsdCentavos, 2000);
  });

  test("elige de forma determinista entre alternativas comparables, sin depender del orden", () => {
    const ofertas = [
      { source: "Zeta", num_guests: 2, total_rate: bloque(25) },
      { source: "Alfa", num_guests: 2, total_rate: bloque(25) },
      { source: "Oficial", official: true, num_guests: 2, total_rate: bloque(25) },
      { source: "Barata por noche", num_guests: 2, rate_per_night: bloque(10) },
    ];
    const esperado = { tipo: "oferta", nombre: "Oficial", oficial: true };
    assert.deepEqual(seleccionarPrecio({ prices: ofertas }, 2)?.fuente, esperado);
    assert.deepEqual(seleccionarPrecio({ prices: [...ofertas].reverse() }, 2)?.fuente, esperado);
    assert.deepEqual(seleccionarPrecio({ total_rate: bloque(25), prices: ofertas }, 2)?.fuente, { tipo: "resumen_propiedad" });
    assert.deepEqual(seleccionarPrecio({ prices: ofertas.filter((o) => !o.official) }, 2)?.fuente, { tipo: "oferta", nombre: "Alfa", oficial: false });
  });

  test("considera también featured_prices de la respuesta de una propiedad individual", () => {
    const precio = seleccionarPrecio({ featured_prices: [{ source: "Destacada", num_guests: 2, total_rate: bloque(18, 15) }] }, 2);
    assert.equal(precio?.importeUsdCentavos, 1800);
    assert.deepEqual(precio?.fuente, { tipo: "oferta", nombre: "Destacada", oficial: false });
  });

  test("ignora ofertas sin fuente identificable", () => {
    assert.equal(seleccionarPrecio({ prices: [{ num_guests: 2, total_rate: bloque(18) }, { source: "  ", total_rate: bloque(17) }] }, 2), null);
  });
});

describe("orden y deduplicación de candidatos", () => {
  test("ordena por distancia sin redondear y desempata por idExterno", () => {
    const candidatos = [
      { distancia: 100.4, idExterno: "c" },
      { distancia: 100.2, idExterno: "z" },
      { distancia: 50, idExterno: "b" },
      { distancia: 50, idExterno: "a" },
    ];
    assert.deepEqual(ordenarPorCercania(candidatos).map((c) => c.idExterno), ["a", "b", "z", "c"]);
    assert.deepEqual(ordenarPorCercania([...candidatos].reverse()).map((c) => c.idExterno), ["a", "b", "z", "c"]);
    assert.equal(candidatos[0].idExterno, "c");
  });

  test("elimina elementos repetidos por idExterno conservando el primero", () => {
    const resultado = deduplicarPorId([
      { idExterno: "h1", lat: 1 },
      { idExterno: "h2", lat: 14.6 },
      { idExterno: "h1", lat: 2 },
    ]);
    assert.deepEqual(resultado.map((l) => [l.idExterno, l.lat]), [["h1", 1], ["h2", 14.6]]);
  });
});
