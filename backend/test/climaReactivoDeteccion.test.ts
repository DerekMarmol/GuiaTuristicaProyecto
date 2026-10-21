import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ReferenciaClima } from "../../shared/types";
import { CONFIGURACION_CLIMA_REACTIVO, leerConfiguracionClimaReactivo } from "../src/config/climaReactivo";
import { crearCacheTemporal, crearObtenedorClima } from "../src/clima/reactivo/climaCache";
import { condicionPorCodigo, decidir, evaluarClima, senalesPronosticadas, type Resultado } from "../src/clima/reactivo/deteccion";
import { ErrorApi } from "../src/errores";
import { interpretarClimaActual, interpretarPronostico, type ClimaActual, type Pronostico, type RegistroPronostico } from "../src/openweather/transformar";

const CONFIG = CONFIGURACION_CLIMA_REACTIVO;
const OFFSET = -21600;
const AHORA = new Date("2026-11-20T16:00:00Z"); // 10:00 en Guatemala
const AHORA_S = AHORA.getTime() / 1000;
const UBICACION = { lat: 14.5586, lng: -90.7295, fuente: "proxima_parada" as const };

function actual(codigo: number, cambios: Partial<ClimaActual> = {}): Resultado<ClimaActual> {
  return {
    ok: true,
    valor: { dt: AHORA_S - 300, desplazamientoUtcSegundos: OFFSET, codigosClima: [codigo], descripcion: "prueba", lluvia1hMm: null, temperaturaC: null, ...cambios },
  };
}

function registro(horasDesdeAhora: number, pop: number | null, codigo = 500, lluviaMm = 0.5): RegistroPronostico {
  return { dt: AHORA_S + horasDesdeAhora * 3600, temperaturaC: 20, lluviaMm, probabilidadPrecipitacion: pop, codigosClima: [codigo], descripcion: "prueba" };
}

function pronostico(...registros: RegistroPronostico[]): Resultado<Pronostico> {
  return { ok: true, valor: { desplazamientoUtcSegundos: OFFSET, registros } };
}

const fallo = (codigo = "PROVEEDOR_ERROR"): Resultado<never> => ({ ok: false, error: new ErrorApi(502, codigo, "falló") });

function evaluar(a: Resultado<ClimaActual>, p: Resultado<Pronostico>, config = CONFIG) {
  return evaluarClima({ actual: a, pronostico: p, ubicacion: UBICACION, ahora: AHORA, consultadoEn: AHORA, config });
}

const DESPEJADO = pronostico(registro(0, 0.1, 800, 0), registro(3, 0.05, 801, 0));

describe("códigos de OpenWeather", () => {
  test("clasifica los grupos oficiales de condición", () => {
    assert.equal(condicionPorCodigo(211), "tormenta");
    assert.equal(condicionPorCodigo(301), "llovizna");
    assert.equal(condicionPorCodigo(500), "lluvia_ligera");
    assert.equal(condicionPorCodigo(501), "lluvia_moderada");
    assert.equal(condicionPorCodigo(502), "lluvia_intensa");
    assert.equal(condicionPorCodigo(531), "lluvia_intensa");
    assert.equal(condicionPorCodigo(800), "despejado_o_nublado");
    assert.equal(condicionPorCodigo(701), "otra");
  });
});

describe("evaluación meteorológica", () => {
  test("clima estable: nivel favorable sin evento", () => {
    const evaluacion = evaluar(actual(800), DESPEJADO);
    assert.equal(evaluacion.nivel, "favorable");
    assert.equal(evaluacion.eventoId, null);
    assert.equal(evaluacion.observacion.estado, "vigente");
    assert.equal(evaluacion.pronostico.estado, "disponible");
  });

  test("lluvia leve observada no alcanza el umbral de disparo", () => {
    const evaluacion = evaluar(actual(500, { lluvia1hMm: 0.3 }), DESPEJADO);
    assert.equal(evaluacion.nivel, "lluvia_ligera");
    assert.equal(evaluacion.eventoId, null);
  });

  test("lluvia significativa por código o por milímetros en la última hora", () => {
    assert.equal(evaluar(actual(501), DESPEJADO).nivel, "lluvia_significativa");
    const porVolumen = evaluar(actual(500, { lluvia1hMm: 3.1 }), DESPEJADO);
    assert.equal(porVolumen.nivel, "lluvia_significativa");
    assert.equal(porVolumen.senalPrincipal?.periodoLluviaHoras, 1);
    assert.equal(porVolumen.senalPrincipal?.probabilidadPrecipitacion, null);
  });

  test("una tormenta observada se identifica por su código, no por una probabilidad", () => {
    const evaluacion = evaluar(actual(211), DESPEJADO);
    assert.equal(evaluacion.nivel, "tormenta");
    assert.equal(evaluacion.senalPrincipal?.origen, "observado");
    assert.equal(evaluacion.senalPrincipal?.codigoOpenWeather, 211);
    assert.equal(evaluacion.senalPrincipal?.probabilidadPrecipitacion, null);
    assert.match(evaluacion.eventoId ?? "", /^tormenta:observado:tormenta:/);
  });

  test("el pronóstico solo eleva el riesgo con probabilidad igual o superior al umbral en el intervalo relevante", () => {
    assert.equal(evaluar(actual(800), pronostico(registro(1, 0.69))).nivel, "lluvia_ligera");
    const elevado = evaluar(actual(800), pronostico(registro(1, 0.7)));
    assert.equal(elevado.nivel, "riesgo_elevado");
    assert.equal(elevado.senalPrincipal?.origen, "pronosticado");
    assert.equal(elevado.senalPrincipal?.probabilidadPrecipitacion, 0.7);
    assert.equal(evaluar(actual(800), pronostico(registro(1, 0.8, 500, 9))).nivel, "lluvia_significativa");
    assert.equal(evaluar(actual(800), pronostico(registro(1, 0.8, 202))).nivel, "tormenta");
  });

  test("ignora intervalos fuera del horizonte o ya terminados", () => {
    const fuera = evaluar(actual(800), pronostico(registro(-4, 0.95, 202), registro(7, 0.95, 202)));
    assert.equal(fuera.nivel, "favorable");
    assert.equal(fuera.pronostico.estado, "sin_cobertura");
    // El intervalo que empezó hace dos horas sigue vigente durante una hora más.
    assert.equal(evaluar(actual(800), pronostico(registro(-2, 0.9))).nivel, "riesgo_elevado");
  });

  test("con probabilidad ausente solo cuentan el código de tormenta o los milímetros", () => {
    const { senales } = senalesPronosticadas({ desplazamientoUtcSegundos: OFFSET, registros: [registro(1, null, 500, 1)] }, AHORA_S, CONFIG);
    assert.deepEqual(senales, []);
    assert.equal(evaluar(actual(800), pronostico(registro(1, null, 500, 8))).nivel, "lluvia_significativa");
  });

  test("una observación desactualizada no se usa para decidir", () => {
    const evaluacion = evaluar(actual(211, { dt: AHORA_S - 2 * 3600 }), DESPEJADO);
    assert.equal(evaluacion.observacion.estado, "obsoleta");
    assert.equal(evaluacion.nivel, "favorable");
  });

  test("sin ninguna fuente disponible el nivel es desconocido, no favorable", () => {
    const evaluacion = evaluar(fallo(), fallo());
    assert.equal(evaluacion.nivel, null);
    assert.equal(evaluacion.observacion.error?.codigo, "PROVEEDOR_ERROR");
  });

  test("con una sola fuente disponible se evalúa con ella e informa el error de la otra", () => {
    const evaluacion = evaluar(fallo("PROVEEDOR_TIEMPO_AGOTADO"), pronostico(registro(1, 0.9)));
    assert.equal(evaluacion.nivel, "riesgo_elevado");
    assert.equal(evaluacion.observacion.estado, "no_disponible");
    assert.equal(evaluacion.observacion.error?.codigo, "PROVEEDOR_TIEMPO_AGOTADO");
  });

  test("la señal observada prevalece sobre la pronosticada del mismo nivel", () => {
    const evaluacion = evaluar(actual(501), pronostico(registro(1, 0.9, 500, 9)));
    assert.equal(evaluacion.senalPrincipal?.origen, "observado");
  });
});

describe("detección de cambios y control de duplicados", () => {
  const referencia = (cambios: Partial<ReferenciaClima> = {}): ReferenciaClima => ({
    nivel: "favorable",
    eventoId: null,
    evaluadoEn: new Date(AHORA.getTime() - 12 * 60_000).toISOString(),
    nivelNotificado: null,
    ultimaPropuestaEn: null,
    ...cambios,
  });

  test("de condiciones favorables a lluvia significativa requiere propuesta", () => {
    const decision = decidir(evaluar(actual(501), DESPEJADO), referencia(), AHORA, CONFIG);
    assert.equal(decision.requierePropuesta, true);
    assert.equal(decision.motivo, "empeoramiento_detectado");
  });

  test("sin evaluación previa se compara contra condiciones favorables", () => {
    assert.equal(decidir(evaluar(actual(211), DESPEJADO), null, AHORA, CONFIG).requierePropuesta, true);
  });

  test("clima estable o lluvia leve no disparan propuesta y avanzan la referencia", () => {
    const estable = decidir(evaluar(actual(800), DESPEJADO), referencia(), AHORA, CONFIG);
    assert.equal(estable.requierePropuesta, false);
    assert.equal(estable.motivo, "sin_riesgo_relevante");
    assert.equal(estable.referencia?.nivel, "favorable");
    const leve = decidir(evaluar(actual(500), DESPEJADO), referencia(), AHORA, CONFIG);
    assert.equal(leve.requierePropuesta, false);
    assert.equal(leve.referencia?.nivel, "lluvia_ligera");
  });

  test("de lluvia ligera a tormenta sí es un empeoramiento", () => {
    assert.equal(decidir(evaluar(actual(211), DESPEJADO), referencia({ nivel: "lluvia_ligera" }), AHORA, CONFIG).requierePropuesta, true);
  });

  test("el mismo evento recibido repetidamente no genera otra propuesta", () => {
    const evaluacion = evaluar(actual(211), DESPEJADO);
    const decision = decidir(evaluacion, referencia({ nivel: "favorable", eventoId: evaluacion.eventoId }), AHORA, CONFIG);
    assert.equal(decision.requierePropuesta, false);
    assert.equal(decision.motivo, "evento_ya_notificado");
  });

  test("un riesgo igual al anterior no se vuelve a proponer", () => {
    const decision = decidir(evaluar(actual(501), DESPEJADO), referencia({ nivel: "lluvia_significativa", eventoId: "otro" }), AHORA, CONFIG);
    assert.equal(decision.motivo, "sin_empeoramiento");
  });

  test("respeta el tiempo mínimo entre propuestas salvo que el riesgo supere lo notificado", () => {
    const reciente = new Date(AHORA.getTime() - 10 * 60_000).toISOString();
    const previa = referencia({ nivel: "favorable", nivelNotificado: "lluvia_significativa", ultimaPropuestaEn: reciente, eventoId: "anterior" });
    const igual = decidir(evaluar(actual(501), DESPEJADO), previa, AHORA, CONFIG);
    assert.equal(igual.requierePropuesta, false);
    assert.equal(igual.motivo, "espera_entre_propuestas");
    assert.equal(igual.referencia, previa);
    assert.equal(decidir(evaluar(actual(211), DESPEJADO), previa, AHORA, CONFIG).requierePropuesta, true);
    const tarde = new Date(AHORA.getTime() + 25 * 60_000);
    assert.equal(decidir(evaluar(actual(501), DESPEJADO), previa, tarde, CONFIG).requierePropuesta, true);
  });

  test("sin datos meteorológicos no decide ni modifica la referencia", () => {
    const previa = referencia({ nivel: "lluvia_ligera" });
    const decision = decidir(evaluar(fallo(), fallo()), previa, AHORA, CONFIG);
    assert.equal(decision.motivo, "datos_insuficientes");
    assert.equal(decision.referencia, previa);
  });
});

describe("configuración del monitoreo", () => {
  test("usa los valores documentados por defecto", () => {
    const config = leerConfiguracionClimaReactivo({});
    assert.equal(config.umbralProbabilidad, 0.7);
    assert.equal(config.intervaloMonitoreoMinutos, 12);
    assert.equal(config.radioInicialMetros, 2000);
    assert.equal(config.radioMaximoMetros, 5000);
  });

  test("permite cambiar umbrales sin tocar la lógica", () => {
    const config = leerConfiguracionClimaReactivo({ CLIMA_REACTIVO_UMBRAL_PROBABILIDAD: "0.6", CLIMA_REACTIVO_INTERVALO_MINUTOS: "15" });
    assert.equal(config.umbralProbabilidad, 0.6);
    assert.equal(config.intervaloMonitoreoMinutos, 15);
    assert.equal(evaluar(actual(800), pronostico(registro(1, 0.65)), config).nivel, "riesgo_elevado");
  });

  test("rechaza valores fuera de rango, incluido un intervalo menor que la actualización de OpenWeather", () => {
    assert.throws(() => leerConfiguracionClimaReactivo({ CLIMA_REACTIVO_INTERVALO_MINUTOS: "5" }), /INTERVALO/);
    assert.throws(() => leerConfiguracionClimaReactivo({ CLIMA_REACTIVO_UMBRAL_PROBABILIDAD: "70" }), /PROBABILIDAD/);
    assert.throws(() => leerConfiguracionClimaReactivo({ CLIMA_REACTIVO_RADIO_MAXIMO_M: "8000" }), /RADIO_MAXIMO/);
    assert.throws(() => leerConfiguracionClimaReactivo({ CLIMA_REACTIVO_RADIO_INICIAL_M: "3000", CLIMA_REACTIVO_RADIO_MAXIMO_M: "2000" }), /no puede ser menor/);
  });
});

describe("control de frecuencia de consultas", () => {
  test("reutiliza la respuesta vigente y comparte las consultas simultáneas", async () => {
    let instante = AHORA.getTime();
    let llamadas = 0;
    const cache = crearCacheTemporal<number>({ vigenciaMs: 600_000, ahora: () => new Date(instante) });
    const cargar = async () => ++llamadas;
    const [a, b] = await Promise.all([cache("x", cargar), cache("x", cargar)]);
    assert.equal(a.valor, 1);
    assert.equal(b.valor, 1);
    instante += 599_000;
    assert.equal((await cache("x", cargar)).valor, 1);
    instante += 2000;
    assert.equal((await cache("x", cargar)).valor, 2);
  });

  test("no guarda errores: la siguiente consulta vuelve a intentar", async () => {
    let llamadas = 0;
    const cache = crearCacheTemporal<number>({ vigenciaMs: 600_000, ahora: () => AHORA });
    await assert.rejects(cache("x", async () => { llamadas++; throw new ErrorApi(504, "PROVEEDOR_TIEMPO_AGOTADO", "lento"); }));
    assert.equal((await cache("x", async () => ++llamadas)).valor, 2);
  });

  test("las ubicaciones cercanas comparten consulta y cada fuente falla por separado", async () => {
    let consultasActual = 0;
    let consultasPronostico = 0;
    const obtener = crearObtenedorClima({
      obtenerClimaActual: async () => { consultasActual++; throw new ErrorApi(503, "PROVEEDOR_LIMITE_SOLICITUDES", "límite"); },
      obtenerPronostico: async () => { consultasPronostico++; return { desplazamientoUtcSegundos: OFFSET, registros: [] }; },
      vigenciaMs: 600_000,
      ahora: () => AHORA,
    });
    const primera = await obtener({ lat: 14.5581, lng: -90.7291 });
    await obtener({ lat: 14.5582, lng: -90.7292 });
    assert.equal(primera.actual.ok, false);
    assert.equal(primera.pronostico.ok, true);
    assert.equal(consultasPronostico, 1);
    assert.equal(consultasActual, 2);
  });
});

describe("respuestas de OpenWeather", () => {
  test("interpreta el clima actual con código, zona horaria y lluvia de una hora", () => {
    const clima = interpretarClimaActual({ dt: 1792387817, timezone: -21600, weather: [{ id: 500, description: "lluvia ligera" }], rain: { "1h": 0.24 }, main: { temp: 28.6 } });
    assert.deepEqual(clima, { dt: 1792387817, desplazamientoUtcSegundos: -21600, codigosClima: [500], descripcion: "lluvia ligera", lluvia1hMm: 0.24, temperaturaC: 28.6 });
    assert.equal(interpretarClimaActual({ dt: 1, timezone: 0, weather: [] }).temperaturaC, null);
    assert.equal(interpretarClimaActual({ dt: 1, timezone: 0, weather: [] }).lluvia1hMm, null);
  });

  test("rechaza respuestas de clima actual con formato inesperado", () => {
    for (const datos of [null, { dt: 1, weather: [] }, { dt: 1, timezone: 99999, weather: [] }, { dt: 1, timezone: 0 }, { dt: 1, timezone: 0, weather: [], rain: { "1h": -1 } }]) {
      assert.throws(() => interpretarClimaActual(datos), (e) => e instanceof ErrorApi && e.codigo === "PROVEEDOR_RESPUESTA_INVALIDA");
    }
  });

  test("el pronóstico conserva pop y códigos sin invalidar respuestas que no los traen", () => {
    const { registros } = interpretarPronostico({
      city: { timezone: -21600 },
      list: [
        { dt: 1000, main: { temp: 20 }, pop: 0.58, weather: [{ id: 500, description: "lluvia ligera" }] },
        { dt: 1000 + 10800, main: { temp: 21 }, pop: "alto" },
      ],
    });
    assert.deepEqual(registros.map((r) => [r.probabilidadPrecipitacion, r.codigosClima]), [[0.58, [500]], [null, []]]);
  });
});
