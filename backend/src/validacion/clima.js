const { ErrorApi } = require("../errores");
const { interpretarFecha } = require("../clima/fechas");

const MAX_DIAS_RANGO = 366;
const DECIMAL = /^-?\d+(\.\d+)?$/;

function leerTexto(query, nombre, errores) {
  const valor = query[nombre];

  if (valor === undefined) {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} es obligatorio.` });
    return null;
  }

  if (typeof valor !== "string") {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} debe enviarse una sola vez como valor simple.` });
    return null;
  }

  if (valor === "") {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} no puede estar vacío.` });
    return null;
  }

  return valor;
}

function validarDecimal(query, nombre, minimo, maximo, errores) {
  const texto = leerTexto(query, nombre, errores);
  if (texto === null) {
    return null;
  }

  const numero = Number(texto);
  if (!DECIMAL.test(texto) || !Number.isFinite(numero)) {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} debe ser un número decimal válido.` });
    return null;
  }

  if (numero < minimo || numero > maximo) {
    errores.push({ parametro: nombre, mensaje: `El parámetro ${nombre} debe estar entre ${minimo} y ${maximo}.` });
    return null;
  }

  return numero;
}

function validarFecha(query, nombre, errores) {
  const texto = leerTexto(query, nombre, errores);
  if (texto === null) {
    return null;
  }

  const numero = interpretarFecha(texto);
  if (numero === null) {
    errores.push({
      parametro: nombre,
      mensaje: `El parámetro ${nombre} debe ser una fecha real del calendario con el formato AAAA-MM-DD.`,
    });
    return null;
  }

  return { texto, numero };
}

function validarConsultaClima(query) {
  const errores = [];

  const lat = validarDecimal(query, "lat", -90, 90, errores);
  const lng = validarDecimal(query, "lng", -180, 180, errores);
  const inicio = validarFecha(query, "fechaInicio", errores);
  const fin = validarFecha(query, "fechaFin", errores);

  if (inicio && fin) {
    const totalDias = fin.numero - inicio.numero + 1;
    if (totalDias < 1) {
      errores.push({ parametro: "fechaFin", mensaje: "El parámetro fechaFin debe ser igual o posterior a fechaInicio." });
    } else if (totalDias > MAX_DIAS_RANGO) {
      errores.push({
        parametro: "fechaFin",
        mensaje: `El rango de fechas no puede superar ${MAX_DIAS_RANGO} días, contando ambas fechas.`,
      });
    }
  }

  if (errores.length > 0) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "Los parámetros de la consulta no son válidos.", errores);
  }

  return { lat, lng, fechaInicio: inicio.texto, fechaFin: fin.texto };
}

module.exports = { validarConsultaClima, MAX_DIAS_RANGO };
