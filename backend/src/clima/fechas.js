const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEGUNDOS_POR_DIA = 86400;
const MS_POR_DIA = SEGUNDOS_POR_DIA * 1000;

function esBisiesto(anio) {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

function diasDelMes(anio, mes) {
  if (mes === 2) {
    return esBisiesto(anio) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

function numeroDeDia(anio, mes, dia) {
  const fecha = new Date(0);
  fecha.setUTCFullYear(anio, mes - 1, dia);
  return Math.round(fecha.getTime() / MS_POR_DIA);
}

function interpretarFecha(texto) {
  const coincidencia = typeof texto === "string" ? PATRON_FECHA.exec(texto) : null;
  if (!coincidencia) {
    return null;
  }

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) {
    return null;
  }

  return numeroDeDia(anio, mes, dia);
}

function formatearFecha(numero) {
  const fecha = new Date(numero * MS_POR_DIA);
  const anio = String(fecha.getUTCFullYear()).padStart(4, "0");
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getUTCDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

function listarFechas(fechaInicio, fechaFin) {
  const inicio = interpretarFecha(fechaInicio);
  const fin = interpretarFecha(fechaFin);
  const fechas = [];
  for (let numero = inicio; numero <= fin; numero++) {
    fechas.push(formatearFecha(numero));
  }
  return fechas;
}

function fechaLocal(timestampSegundos, desplazamientoSegundos) {
  return formatearFecha(Math.floor((timestampSegundos + desplazamientoSegundos) / SEGUNDOS_POR_DIA));
}

module.exports = { interpretarFecha, formatearFecha, listarFechas, fechaLocal };
