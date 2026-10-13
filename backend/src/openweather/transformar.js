const { ErrorApi } = require("../errores");
const { fechaLocal } = require("../clima/fechas");

const SEGUNDOS_POR_INTERVALO = 3 * 3600;
const INTERVALOS_POR_DIA = 8;
const DESPLAZAMIENTO_MINIMO_S = -12 * 3600;
const DESPLAZAMIENTO_MAXIMO_S = 14 * 3600;

function respuestaInvalida() {
  return new ErrorApi(502, "PROVEEDOR_RESPUESTA_INVALIDA", "El proveedor de clima devolvió una respuesta con formato inesperado.");
}

function esObjeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function esNumeroFinito(valor) {
  return typeof valor === "number" && Number.isFinite(valor);
}

function leerDesplazamiento(ciudad) {
  const desplazamiento = esObjeto(ciudad) ? ciudad.timezone : undefined;
  if (
    !Number.isSafeInteger(desplazamiento) ||
    desplazamiento < DESPLAZAMIENTO_MINIMO_S ||
    desplazamiento > DESPLAZAMIENTO_MAXIMO_S
  ) {
    throw respuestaInvalida();
  }
  return desplazamiento;
}

function leerLluvia(registro) {
  if (!("rain" in registro)) {
    return 0;
  }
  const volumen = esObjeto(registro.rain) ? registro.rain["3h"] : undefined;
  if (!esNumeroFinito(volumen) || volumen < 0) {
    throw respuestaInvalida();
  }
  return volumen;
}

function leerRegistro(registro) {
  if (!esObjeto(registro) || !Number.isSafeInteger(registro.dt) || !esObjeto(registro.main)) {
    throw respuestaInvalida();
  }
  if (!esNumeroFinito(registro.main.temp)) {
    throw respuestaInvalida();
  }
  return { dt: registro.dt, temperaturaC: registro.main.temp, lluviaMm: leerLluvia(registro) };
}

function interpretarPronostico(datos) {
  if (!esObjeto(datos) || !Array.isArray(datos.list)) {
    throw respuestaInvalida();
  }

  const desplazamientoUtcSegundos = leerDesplazamiento(datos.city);
  const ordenados = datos.list.map(leerRegistro).sort((a, b) => a.dt - b.dt);

  const registros = [];
  for (const registro of ordenados) {
    const anterior = registros[registros.length - 1];
    if (anterior && anterior.dt === registro.dt) {
      continue;
    }
    if (anterior && registro.dt - anterior.dt < SEGUNDOS_POR_INTERVALO) {
      throw respuestaInvalida();
    }
    registros.push(registro);
  }

  return { desplazamientoUtcSegundos, registros };
}

function redondear(valor) {
  const redondeado = Math.round(valor * 100) / 100;
  return redondeado === 0 ? 0 : redondeado;
}

function resumir(fecha, registros) {
  const temperaturas = registros.map((registro) => registro.temperaturaC);
  const suma = temperaturas.reduce((total, temperatura) => total + temperatura, 0);
  const lluvia = registros.reduce((total, registro) => total + registro.lluviaMm, 0);

  return {
    fecha,
    estado: registros.length >= INTERVALOS_POR_DIA ? "disponible" : "parcial",
    temperaturaPromedioC: redondear(suma / temperaturas.length),
    temperaturaMinimaC: Math.min(...temperaturas),
    temperaturaMaximaC: Math.max(...temperaturas),
    lluviaMm: redondear(lluvia),
    intervalosDisponibles: registros.length,
  };
}

function sinResumen(fecha, estado) {
  return {
    fecha,
    estado,
    temperaturaPromedioC: null,
    temperaturaMinimaC: null,
    temperaturaMaximaC: null,
    lluviaMm: null,
    intervalosDisponibles: 0,
  };
}

function calcularCobertura(registros, desplazamientoUtcSegundos) {
  if (registros.length === 0) {
    return null;
  }
  const primero = registros[0].dt;
  const ultimo = registros[registros.length - 1].dt;
  return {
    desde: fechaLocal(primero, desplazamientoUtcSegundos),
    hasta: fechaLocal(ultimo, desplazamientoUtcSegundos),
    primerIntervalo: new Date(primero * 1000).toISOString(),
    ultimoIntervalo: new Date(ultimo * 1000).toISOString(),
  };
}

function resumirPorDia({ registros, desplazamientoUtcSegundos, fechas }) {
  const porFecha = new Map();
  for (const registro of registros) {
    const fecha = fechaLocal(registro.dt, desplazamientoUtcSegundos);
    if (!porFecha.has(fecha)) {
      porFecha.set(fecha, []);
    }
    porFecha.get(fecha).push(registro);
  }

  const cobertura = calcularCobertura(registros, desplazamientoUtcSegundos);

  const dias = fechas.map((fecha) => {
    if (!cobertura) {
      return sinResumen(fecha, "sin_datos");
    }
    if (fecha < cobertura.desde || fecha > cobertura.hasta) {
      return sinResumen(fecha, "fuera_de_cobertura");
    }
    const delDia = porFecha.get(fecha);
    return delDia ? resumir(fecha, delDia) : sinResumen(fecha, "sin_datos");
  });

  return { cobertura, dias };
}

function fechasConEstado(dias, estado) {
  return dias.filter((dia) => dia.estado === estado).map((dia) => dia.fecha);
}

function construirAdvertencias(dias, cobertura) {
  if (!cobertura) {
    return [
      {
        codigo: "SERIE_VACIA",
        mensaje: "El proveedor no devolvió intervalos de pronóstico; ninguna fecha tiene datos.",
        fechas: dias.map((dia) => dia.fecha),
      },
    ];
  }

  const advertencias = [];
  const fuera = fechasConEstado(dias, "fuera_de_cobertura");
  if (fuera.length > 0) {
    advertencias.push({
      codigo: "FUERA_DE_COBERTURA",
      mensaje: `Estas fechas están fuera del pronóstico disponible (${cobertura.desde} a ${cobertura.hasta}).`,
      fechas: fuera,
    });
  }
  const parciales = fechasConEstado(dias, "parcial");
  if (parciales.length > 0) {
    advertencias.push({
      codigo: "COBERTURA_PARCIAL",
      mensaje: `Estas fechas tienen menos de ${INTERVALOS_POR_DIA} intervalos de tres horas; su resumen es incompleto.`,
      fechas: parciales,
    });
  }
  const sinDatos = fechasConEstado(dias, "sin_datos");
  if (sinDatos.length > 0) {
    advertencias.push({
      codigo: "SIN_DATOS",
      mensaje: "El proveedor no devolvió intervalos para estas fechas dentro de la cobertura.",
      fechas: sinDatos,
    });
  }
  return advertencias;
}

module.exports = { interpretarPronostico, resumirPorDia, construirAdvertencias, INTERVALOS_POR_DIA };
