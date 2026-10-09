const OpeningHours = require("opening_hours");

const FUENTE = "geoapify";
const SIN_UBICACION = {};
const MODO_RANGOS_HORARIOS = 0;

function crearHorario(estado, valorOriginal) {
  return { estado, valorOriginal, fuente: FUENTE };
}

function horarioErrorConsulta() {
  return crearHorario("error_consulta", null);
}

function expresionValida(valor) {
  try {
    const horario = new OpeningHours(valor, SIN_UBICACION, { mode: MODO_RANGOS_HORARIOS });
    return horario.getWarnings().length === 0;
  } catch {
    return false;
  }
}

function interpretarHorario(valor) {
  if (valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "")) {
    return crearHorario("no_publicado", null);
  }
  if (typeof valor !== "string") {
    return crearHorario("no_interpretable", null);
  }
  if (!expresionValida(valor)) {
    return crearHorario("no_interpretable", valor);
  }
  return crearHorario("disponible", valor);
}

module.exports = { interpretarHorario, horarioErrorConsulta };
