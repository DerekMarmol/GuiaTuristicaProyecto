import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validarEstancia } from "./validacionEstancia";

describe("GUI-36 - Validación de tiempos de estancia", () => {
  it("permite una visita completa antes del cierre", () => {
    const resultado = validarEstancia({
      llegada: "15:00",
      duracionSolicitada: 90,
      intervalos: [{ inicio: "09:00", fin: "17:00" }],
    });

    assert.equal(resultado.estado, "completa");
    assert.equal(resultado.inicio, "15:00");
    assert.equal(resultado.fin, "16:30");
    assert.equal(resultado.duracionMinutos, 90);
  });

  it("reduce la visita cuando se acerca el cierre", () => {
    const resultado = validarEstancia({
      llegada: "16:00",
      duracionSolicitada: 90,
      intervalos: [{ inicio: "09:00", fin: "17:00" }],
    });

    assert.equal(resultado.estado, "ajustada");
    assert.equal(resultado.fin, "17:00");
    assert.equal(resultado.duracionMinutos, 60);
  });

  it("descarta una visita cuando quedan menos de 15 minutos", () => {
    const resultado = validarEstancia({
      llegada: "16:50",
      duracionSolicitada: 90,
      intervalos: [{ inicio: "09:00", fin: "17:00" }],
    });

    assert.equal(resultado.estado, "descartada");
    assert.equal(resultado.duracionMinutos, 0);
  });

  it("espera hasta después del receso de almuerzo", () => {
    const resultado = validarEstancia({
      llegada: "12:30",
      duracionSolicitada: 60,
      intervalos: [
        { inicio: "08:00", fin: "12:00" },
        { inicio: "13:00", fin: "17:00" },
      ],
    });

    assert.equal(resultado.estado, "completa");
    assert.equal(resultado.inicio, "13:00");
    assert.equal(resultado.fin, "14:00");
  });

  it("no permite atravesar un receso", () => {
    const resultado = validarEstancia({
      llegada: "11:30",
      duracionSolicitada: 90,
      intervalos: [
        { inicio: "08:00", fin: "12:00" },
        { inicio: "13:00", fin: "17:00" },
      ],
    });

    assert.equal(resultado.estado, "ajustada");
    assert.equal(resultado.duracionMinutos, 30);
    assert.equal(resultado.fin, "12:00");
  });

  it("descarta cuando el establecimiento está cerrado", () => {
    const resultado = validarEstancia({
      llegada: "10:00",
      duracionSolicitada: 60,
      intervalos: [],
    });

    assert.equal(resultado.estado, "descartada");
  });

  it("rechaza intervalos que se superponen", () => {
    assert.throws(() =>
      validarEstancia({
        llegada: "09:00",
        duracionSolicitada: 60,
        intervalos: [
          { inicio: "08:00", fin: "12:00" },
          { inicio: "11:00", fin: "17:00" },
        ],
      })
    );
  });
});
