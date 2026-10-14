import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluarApertura, type Horario, type MomentoLocal } from "../src/geoapify/horario";

function disponible(valorOriginal: string): Horario {
  return { estado: "disponible", valorOriginal, fuente: "geoapify" };
}

function momento(fecha: string, hora: string): MomentoLocal {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const [h, m] = hora.split(":").map(Number);
  return { anio, mes, dia, hora: h, minuto: m };
}

describe("evaluarApertura", () => {
  test("abierto en el instante de apertura, con el cierre del intervalo", () => {
    assert.deepEqual(evaluarApertura(disponible("Mo-Fr 09:00-17:00"), momento("2026-10-13", "09:00")), {
      estado: "abierto",
      cierre: momento("2026-10-13", "17:00"),
    });
  });

  test("cerrado en el instante de cierre y antes de abrir", () => {
    assert.deepEqual(evaluarApertura(disponible("Mo-Fr 09:00-17:00"), momento("2026-10-13", "17:00")), { estado: "cerrado" });
    assert.deepEqual(evaluarApertura(disponible("Mo-Fr 09:00-17:00"), momento("2026-10-13", "08:59")), { estado: "cerrado" });
  });

  test("distingue días de la semana y días cerrados", () => {
    const horario = disponible("Mo-Sa 09:00-18:00; Su off");
    assert.equal(evaluarApertura(horario, momento("2026-10-17", "10:00")).estado, "abierto");
    assert.equal(evaluarApertura(horario, momento("2026-10-18", "10:00")).estado, "cerrado");
  });

  test("respeta varios intervalos y recesos", () => {
    const horario = disponible("Mo-Fr 08:00-12:00,14:00-18:00");
    assert.deepEqual(evaluarApertura(horario, momento("2026-10-13", "11:00")), { estado: "abierto", cierre: momento("2026-10-13", "12:00") });
    assert.deepEqual(evaluarApertura(horario, momento("2026-10-13", "12:00")), { estado: "cerrado" });
    assert.deepEqual(evaluarApertura(horario, momento("2026-10-13", "14:00")), { estado: "abierto", cierre: momento("2026-10-13", "18:00") });
  });

  test("sigue abierto después de medianoche en un turno nocturno", () => {
    const horario = disponible("Fr 22:00-03:00");
    assert.deepEqual(evaluarApertura(horario, momento("2026-10-17", "01:00")), { estado: "abierto", cierre: momento("2026-10-17", "03:00") });
    assert.deepEqual(evaluarApertura(horario, momento("2026-10-17", "03:00")), { estado: "cerrado" });
  });

  test("24/7 está abierto sin un cierre próximo", () => {
    assert.deepEqual(evaluarApertura(disponible("24/7"), momento("2026-10-18", "03:30")), { estado: "abierto", cierre: null });
  });

  test("no confirma la apertura cuando la biblioteca indica estado desconocido", () => {
    for (const valor of ["Mo-Fr 09:00-17:00 unknown", 'Mo-Fr 09:00-17:00 "solo con cita"', "Mo-Fr 10:00+"]) {
      assert.deepEqual(evaluarApertura(disponible(valor), momento("2026-10-13", "11:00")), { estado: "desconocido", motivo: "estado_desconocido" });
    }
  });

  test("no usa horas solares supuestas sin ubicación ni zona", () => {
    assert.deepEqual(evaluarApertura(disponible("Mo-Su sunrise-sunset"), momento("2026-10-13", "10:00")), {
      estado: "desconocido",
      motivo: "estado_desconocido",
    });
  });

  test("conserva los estados sin horario verificable de la integración", () => {
    const instante = momento("2026-10-13", "10:00");
    assert.deepEqual(evaluarApertura({ estado: "no_publicado", valorOriginal: null, fuente: "geoapify" }, instante), { estado: "desconocido", motivo: "no_publicado" });
    assert.deepEqual(evaluarApertura({ estado: "error_consulta", valorOriginal: null, fuente: "geoapify" }, instante), { estado: "desconocido", motivo: "error_consulta" });
    assert.deepEqual(
      evaluarApertura({ estado: "no_interpretable", valorOriginal: "Mo-Fr 09:00-17:00; PH off", fuente: "geoapify" }, instante),
      { estado: "desconocido", motivo: "no_interpretable" },
    );
    assert.deepEqual(evaluarApertura(undefined, instante), { estado: "desconocido", motivo: "error_consulta" });
  });

  test("no evalúa un texto marcado como disponible si la biblioteca lo rechaza", () => {
    assert.deepEqual(evaluarApertura(disponible("Mo-Fr 9am-5pm"), momento("2026-10-13", "10:00")), { estado: "desconocido", motivo: "no_interpretable" });
  });
});
