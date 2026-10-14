import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { HorarioLugar } from "../../../shared/types";
import { validarSalida } from "./validator";
import { generarItinerarios } from "./generarItinerario";
import { estimarTraslado, type EstimadorTraslado } from "./validacionApertura";
import type { LugarReal, TrasladoEstimado, ViajeIA, ViajeValidacion } from "./tipos";

const disponible = (valorOriginal: string): HorarioLugar => ({ estado: "disponible", valorOriginal, fuente: "geoapify" });

function lugar(placeId: string, horario: HorarioLugar, lat = 14.6, lng = -90.5): LugarReal {
  return { placeId, nombre: `Lugar ${placeId}`, lat, lng, categoria: "tourism.sights", horario };
}

function viaje(fechaInicio = "2026-10-13", extra: Partial<ViajeValidacion> = {}): ViajeValidacion {
  return { id: "viaje-1", fechaInicio, fechaFin: extra.fechaFin ?? fechaInicio, zonaHoraria: "America/Guatemala", ...extra };
}

function propuesta(...dias: Array<Array<[string, number]>>) {
  return {
    dias: dias.map((paradas, i) => ({
      numeroDia: i + 1,
      paradas: paradas.map(([placeId, tiempoEstanciaMinutos]) => ({ placeId, tiempoEstanciaMinutos })),
    })),
  };
}

function trasladoFijo(minutos: number): TrasladoEstimado {
  return {
    tiempoBaseMinutos: minutos,
    tipoTraslado: "vehiculo",
    desgloseHolgura: { margenEstandar: 0, estacionamientoOAdicional: 0, imprevistos: 0, totalHolgura: 0 },
    tiempoTotalConHolgura: minutos,
    estimado: true,
    metodo: "distancia_lineal",
    distanciaKm: 0,
    velocidadKmh: 40,
  };
}

const traslado = (minutos: number): EstimadorTraslado => () => trasladoFijo(minutos);

function validar(raw: unknown, candidatos: LugarReal[], v: ViajeValidacion = viaje(), minutos = 30) {
  return validarSalida(raw, candidatos, v, { estimarTraslado: traslado(minutos) });
}

const ids = (r: ReturnType<typeof validar>) => r.itinerarios.flatMap((it) => it.paradas.map((p) => p.placeId));

describe("Validación de horarios de apertura en el plan", () => {
  it("conserva un lugar abierto a la llegada con su identificador y horario real", () => {
    const horario = disponible("Mo-Fr 08:00-18:00");
    const r = validar(propuesta([["geo-abierto", 60]]), [lugar("geo-abierto", horario)]);

    assert.equal(r.viable, true);
    const parada = r.itinerarios[0].paradas[0];
    assert.equal(parada.placeId, "geo-abierto");
    assert.equal(parada.id, "p1-1");
    assert.deepEqual(parada.horario, horario);
    assert.equal(parada.llegada, "2026-10-13T09:00-06:00");
    assert.equal(parada.salida, "2026-10-13T10:00-06:00");
    assert.equal(parada.horaApertura, undefined);
    assert.equal(parada.horaCierre, undefined);
    assert.deepEqual(r.descartes, []);
  });

  it("excluye un lugar cerrado a la hora estimada de llegada", () => {
    const r = validar(propuesta([["a", 60], ["b", 60]]), [
      lugar("a", disponible("Mo-Fr 08:00-18:00")),
      lugar("b", disponible("Mo-Fr 08:00-10:00")),
    ]);

    assert.deepEqual(ids(r), ["a"]);
    assert.equal(r.descartes.length, 1);
    assert.equal(r.descartes[0].placeId, "b");
    assert.equal(r.descartes[0].motivo, "cerrado");
    assert.equal(r.descartes[0].llegada, "2026-10-13T10:30-06:00");
    assert.equal(r.descartes[0].horario?.valorOriginal, "Mo-Fr 08:00-10:00");
  });

  it("regresión: tras 09:00 + 360 min y 30 min de traslado, la llegada de las 15:30 a un lugar que cerró a las 10:00 no aparece", () => {
    const r = validar(propuesta([["primero", 360], ["segundo", 60]]), [
      lugar("primero", disponible("Mo-Su 08:00-20:00")),
      lugar("segundo", disponible("Mo-Su 08:00-10:00")),
    ]);

    assert.deepEqual(ids(r), ["primero"]);
    assert.equal(r.itinerarios[0].paradas[0].salida, "2026-10-13T15:00-06:00");
    assert.equal(r.descartes[0].placeId, "segundo");
    assert.equal(r.descartes[0].motivo, "cerrado");
    assert.equal(r.descartes[0].llegada, "2026-10-13T15:30-06:00");
  });

  it("no espera hasta la apertura cuando se llega antes", () => {
    const r = validar(propuesta([["tarde", 60]]), [lugar("tarde", disponible("Mo-Fr 10:00-18:00"))]);

    assert.deepEqual(ids(r), []);
    assert.equal(r.descartes[0].motivo, "cerrado");
    assert.equal(r.descartes[0].llegada, "2026-10-13T09:00-06:00");
  });

  it("incluye el instante de apertura y excluye el instante de cierre", () => {
    const horario = disponible("Mo-Fr 08:00-18:00");
    const enApertura = validar(propuesta([["x", 60]]), [lugar("x", horario)], viaje("2026-10-13", { horaInicio: "08:00" }));
    const enCierre = validar(propuesta([["x", 60]]), [lugar("x", horario)], viaje("2026-10-13", { horaInicio: "18:00" }));
    const antesDelCierre = validar(propuesta([["x", 60]]), [lugar("x", horario)], viaje("2026-10-13", { horaInicio: "17:59" }));

    assert.deepEqual(ids(enApertura), ["x"]);
    assert.deepEqual(ids(enCierre), []);
    assert.equal(enCierre.descartes[0].motivo, "cerrado");
    assert.equal(enCierre.descartes[0].llegada, "2026-10-13T18:00-06:00");
    assert.deepEqual(ids(antesDelCierre), []);
    assert.equal(antesDelCierre.descartes[0].motivo, "tiempo_insuficiente");
  });

  it("excluye un día marcado como cerrado", () => {
    const r = validar(propuesta([["museo", 60]]), [lugar("museo", disponible("Mo-Sa 09:00-18:00; Su off"))], viaje("2026-10-18"));

    assert.deepEqual(ids(r), []);
    assert.equal(r.descartes[0].motivo, "cerrado");
  });

  it("excluye una llegada durante un receso y conserva la del segundo intervalo", () => {
    const horario = disponible("Mo-Fr 08:00-12:00,14:00-18:00");
    const enReceso = validar(propuesta([["a", 180], ["b", 60]]), [lugar("a", disponible("24/7")), lugar("b", horario)]);
    const segundoIntervalo = validar(propuesta([["a", 300], ["b", 60]]), [lugar("a", disponible("24/7")), lugar("b", horario)]);

    assert.deepEqual(ids(enReceso), ["a"]);
    assert.equal(enReceso.descartes[0].llegada, "2026-10-13T12:30-06:00");
    assert.equal(enReceso.descartes[0].motivo, "cerrado");
    assert.deepEqual(ids(segundoIntervalo), ["a", "b"]);
    assert.equal(segundoIntervalo.itinerarios[0].paradas[1].llegada, "2026-10-13T14:30-06:00");
  });

  it("evalúa horarios que cruzan la medianoche y conserva la validación de estancia", () => {
    const horario = disponible("Fr-Sa 22:00-03:00");
    const sabadoMadrugada = validar(propuesta([["bar", 180]]), [lugar("bar", horario)], viaje("2026-10-17", { horaInicio: "01:00" }));
    const juevesMadrugada = validar(propuesta([["bar", 60]]), [lugar("bar", horario)], viaje("2026-10-15", { horaInicio: "01:00" }));

    assert.deepEqual(ids(sabadoMadrugada), ["bar"]);
    const parada = sabadoMadrugada.itinerarios[0].paradas[0];
    assert.equal(parada.estadoEstancia, "ajustada");
    assert.equal(parada.tiempoEstanciaMinutos, 120);
    assert.equal(parada.salida, "2026-10-17T03:00-06:00");
    assert.deepEqual(ids(juevesMadrugada), []);
    assert.equal(juevesMadrugada.descartes[0].motivo, "cerrado");
  });

  it("acepta cualquier hora con 24/7", () => {
    const r = validar(propuesta([["siempre", 360]]), [lugar("siempre", disponible("24/7"))], viaje("2026-10-18", { horaInicio: "03:00" }));

    assert.deepEqual(ids(r), ["siempre"]);
    assert.equal(r.itinerarios[0].paradas[0].estadoEstancia, "completa");
  });

  it("excluye lugares sin apertura verificable con un motivo distinto del cierre", () => {
    const candidatos = [
      lugar("sin-horario", { estado: "no_publicado", valorOriginal: null, fuente: "geoapify" }),
      lugar("festivos", { estado: "no_interpretable", valorOriginal: "Mo-Fr 09:00-17:00; PH off", fuente: "geoapify" }),
      lugar("fallo", { estado: "error_consulta", valorOriginal: null, fuente: "geoapify" }),
      lugar("desconocido", disponible("Mo-Fr 08:00-18:00 unknown")),
      lugar("comentario", disponible('Mo-Fr 08:00-18:00 "con cita previa"')),
      lugar("solar", disponible("Mo-Su sunrise-sunset")),
    ];
    const r = validar(propuesta(candidatos.map((c) => [c.placeId, 30] as [string, number])), candidatos);

    assert.deepEqual(ids(r), []);
    assert.deepEqual(
      r.descartes.map((d) => [d.placeId, d.motivo]),
      [
        ["sin-horario", "horario_no_publicado"],
        ["festivos", "horario_no_interpretable"],
        ["fallo", "error_consulta"],
        ["desconocido", "apertura_desconocida"],
        ["comentario", "apertura_desconocida"],
        ["solar", "apertura_desconocida"],
      ]
    );
    assert.ok(r.descartes.every((d) => d.llegada === "2026-10-13T09:00-06:00"));
  });

  it("recalcula las llegadas desde la última parada conservada", () => {
    const tiempos: Record<string, number> = { "a>b": 100, "a>c": 30, "b>c": 50 };
    const consultas: string[] = [];
    const estimar: EstimadorTraslado = (origen, destino) => {
      const clave = `${origen.placeId}>${destino.placeId}`;
      consultas.push(clave);
      return trasladoFijo(tiempos[clave]);
    };
    const r = validarSalida(
      propuesta([["a", 60], ["b", 240], ["c", 60]]),
      [lugar("a", disponible("Mo-Fr 08:00-18:00")), lugar("b", disponible("Mo-Fr 18:00-22:00")), lugar("c", disponible("Mo-Fr 10:00-18:00"))],
      viaje(),
      { estimarTraslado: estimar }
    );

    assert.deepEqual(ids(r), ["a", "c"]);
    assert.deepEqual(consultas, ["a>b", "a>c"]);
    const c = r.itinerarios[0].paradas[1];
    assert.equal(c.llegada, "2026-10-13T10:30-06:00");
    assert.equal(c.traslado?.tiempoTotalConHolgura, 30);
    assert.equal(c.id, "p1-2");
  });

  it("devuelve un día sin paradas de forma explícita y sin rellenarlo", () => {
    const r = validar(
      propuesta([["abierto", 60]], [["cerrado", 60]]),
      [lugar("abierto", disponible("Mo-Fr 08:00-18:00")), lugar("cerrado", disponible("Mo-Fr 18:00-20:00"))],
      viaje("2026-10-13", { fechaFin: "2026-10-14" })
    );

    assert.equal(r.viable, false);
    assert.deepEqual(r.itinerarios.map((it) => it.numeroDia), [1]);
    assert.deepEqual(r.diasSinParadas, [{ numeroDia: 2, fecha: "2026-10-14" }]);
    assert.equal(r.descartes[0].fecha, "2026-10-14");
  });

  it("aplica la holgura del traslado estimado antes de evaluar la llegada", () => {
    const a = lugar("a", disponible("Mo-Fr 08:00-18:00"), 14.6, -90.5);
    const b = lugar("b", disponible("Mo-Fr 08:00-18:00"), 14.656, -90.5);
    const r = validarSalida(propuesta([["a", 60], ["b", 60]]), [a, b], viaje());
    const estimado = estimarTraslado(a, b);

    assert.equal(estimado.tiempoBaseMinutos, 9);
    assert.ok(estimado.desgloseHolgura.totalHolgura > 0);
    assert.equal(estimado.tiempoTotalConHolgura, 30);
    const parada = r.itinerarios[0].paradas[1];
    assert.deepEqual(parada.traslado, estimado);
    assert.equal(parada.llegada, "2026-10-13T10:30-06:00");
    assert.equal(r.itinerarios[0].paradas[0].traslado, null);
  });

  it("exige una zona horaria IANA válida cuando hay horarios reales", () => {
    const candidatos = [lugar("a", disponible("24/7"))];
    const sinZona = validarSalida(propuesta([["a", 60]]), candidatos, { id: "v", fechaInicio: "2026-10-13", fechaFin: "2026-10-13" });
    const zonaInvalida = validarSalida(propuesta([["a", 60]]), candidatos, viaje("2026-10-13", { zonaHoraria: "GMT-6:00" }));

    assert.equal(sinZona.viable, false);
    assert.match(sinZona.errores[0], /zona horaria/);
    assert.equal(zonaInvalida.viable, false);
    assert.deepEqual(zonaInvalida.itinerarios, []);
  });

  it("usa la zona del destino para el día de la semana y la hora", () => {
    const horario = disponible("Tu 08:00-10:00");
    const tokio = validar(propuesta([["a", 60]]), [lugar("a", horario)], viaje("2026-10-13", { zonaHoraria: "Asia/Tokyo" }));
    const guatemalaMiercoles = validar(propuesta([["a", 60]]), [lugar("a", horario)], viaje("2026-10-14"));

    assert.equal(tokio.itinerarios[0].paradas[0].llegada, "2026-10-13T09:00+09:00");
    assert.deepEqual(ids(guatemalaMiercoles), []);
  });
});

describe("Independencia de la zona horaria del servidor", () => {
  const zonaOriginal = process.env.TZ;
  after(() => {
    if (zonaOriginal === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = zonaOriginal;
    }
  });

  it("produce el mismo plan con distintas zonas en el servidor", () => {
    const candidatos = [
      lugar("a", disponible("Tu 08:00-10:00")),
      lugar("b", disponible("Tu 09:00-10:00")),
      lugar("c", disponible("Mo,Tu 22:00-02:00")),
    ];
    const escenarios = () => [
      validar(propuesta([["a", 60], ["b", 30]]), candidatos),
      validar(propuesta([["c", 60]]), candidatos, viaje("2026-10-14", { horaInicio: "01:00" })),
      validar(propuesta([["a", 60]]), candidatos, viaje("2026-10-13", { zonaHoraria: "Pacific/Auckland" })),
    ];

    const resultados = ["UTC", "Asia/Tokyo", "America/New_York", "Pacific/Kiritimati", "America/Guatemala"].map((zona) => {
      process.env.TZ = zona;
      return JSON.stringify(escenarios());
    });

    for (const resultado of resultados) {
      assert.equal(resultado, resultados[0]);
    }
    const [plan, medianoche, auckland] = JSON.parse(resultados[0]);
    assert.deepEqual(plan.itinerarios[0].paradas.map((p: { placeId: string }) => p.placeId), ["a"]);
    assert.equal(plan.descartes[0].llegada, "2026-10-13T10:30-06:00");
    assert.equal(medianoche.itinerarios[0].paradas[0].llegada, "2026-10-14T01:00-06:00");
    assert.equal(auckland.itinerarios[0].paradas[0].llegada, "2026-10-13T09:00+13:00");
  });
});

describe("Compatibilidad con horarios simplificados", () => {
  it("no acepta una llegada posterior al cierre en la rama de apertura y cierre", () => {
    const candidatos: LugarReal[] = [
      { placeId: "primero", nombre: "Primero", lat: 14.6, lng: -90.5, categoria: "Historia", horaApertura: "08:00", horaCierre: "16:00" },
      { placeId: "segundo", nombre: "Segundo", lat: 14.6, lng: -90.5, categoria: "Historia", horaApertura: "08:00", horaCierre: "10:00" },
    ];
    const r = validarSalida(propuesta([["primero", 360], ["segundo", 60]]), candidatos, { id: "v", fechaInicio: "2026-10-13", fechaFin: "2026-10-13" }, { estimarTraslado: traslado(30) });

    assert.deepEqual(ids(r), ["primero"]);
    assert.equal(r.descartes[0].motivo, "cerrado");
  });

  it("no espera hasta la siguiente apertura en la rama de intervalos", () => {
    const candidatos: LugarReal[] = [
      { placeId: "a", nombre: "A", lat: 14.6, lng: -90.5, categoria: "Historia", intervalosHorario: [{ inicio: "08:00", fin: "18:00" }] },
      { placeId: "b", nombre: "B", lat: 14.6, lng: -90.5, categoria: "Historia", intervalosHorario: [{ inicio: "08:00", fin: "12:00" }, { inicio: "13:00", fin: "17:00" }] },
    ];
    const r = validarSalida(propuesta([["a", 180], ["b", 60]]), candidatos, { id: "v", fechaInicio: "2026-10-13", fechaFin: "2026-10-13" }, { estimarTraslado: traslado(30) });

    assert.deepEqual(ids(r), ["a"]);
    assert.equal(r.descartes[0].motivo, "cerrado");
  });
});

describe("Salida del orquestador", () => {
  it("publica solo las paradas conservadas con el mismo traslado usado para validar", async () => {
    const viajeIA: ViajeIA = {
      id: "viaje-ia",
      destino: "Ciudad de Guatemala",
      tipoViaje: "pareja",
      presupuesto: 1000,
      transporte: "Automovil",
      intereses: ["Historia"],
      fechaInicio: "2026-10-13",
      fechaFin: "2026-10-13",
      zonaHoraria: "America/Guatemala",
    };
    const candidatos = [
      lugar("a", disponible("Mo-Su 08:00-20:00"), 14.6, -90.5),
      lugar("b", disponible("Mo-Su 08:00-10:00"), 14.656, -90.5),
      lugar("c", disponible("Mo-Su 08:00-20:00"), 14.656, -90.5),
    ];
    const cliente = { async generarPlan() { return propuesta([["a", 360], ["b", 60], ["c", 60]]); } };

    const r = await generarItinerarios({ viaje: viajeIA, candidatos, cliente });

    assert.deepEqual(r.itinerarios[0].paradas.map((p) => p.placeId), ["a", "c"]);
    assert.deepEqual(r.descartes.map((d) => [d.placeId, d.motivo, d.llegada]), [["b", "cerrado", "2026-10-13T15:30-06:00"]]);
    const c = r.itinerarios[0].paradas[1];
    assert.equal(c.llegada, "2026-10-13T15:30-06:00");
    assert.equal(c.traslado?.tiempoTotalConHolgura, 30);
    assert.equal("holgura" in r.itinerarios[0].paradas[0], false);
  });

  it("no llama al modelo si faltan los datos para verificar horarios reales", async () => {
    let llamado = false;
    const cliente = { async generarPlan() { llamado = true; return propuesta([["a", 60]]); } };
    const viajeSinZona: ViajeIA = {
      id: "v",
      destino: "X",
      tipoViaje: "solo",
      presupuesto: 1,
      transporte: "A pie",
      intereses: [],
      fechaInicio: "2026-10-13",
      fechaFin: "2026-10-13",
    };

    await assert.rejects(generarItinerarios({ viaje: viajeSinZona, candidatos: [lugar("a", disponible("24/7"))], cliente }), /horarios/);
    assert.equal(llamado, false);
  });
});
