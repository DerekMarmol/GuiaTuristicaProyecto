const { listarFechas } = require("./fechas");
const { resumirPorDia, construirAdvertencias } = require("../openweather/transformar");

function crearServicioClima({ obtenerPronostico, ahora = () => new Date() }) {
  return async function consultarClima({ lat, lng, fechaInicio, fechaFin }) {
    const fechas = listarFechas(fechaInicio, fechaFin);
    const { desplazamientoUtcSegundos, registros } = await obtenerPronostico({ lat, lng });
    const { cobertura, dias } = resumirPorDia({ registros, desplazamientoUtcSegundos, fechas });

    return {
      fuente: "openweathermap",
      ubicacion: { lat, lng },
      rango: { fechaInicio, fechaFin, totalDias: fechas.length },
      consultadoEn: ahora().toISOString(),
      desplazamientoUtcSegundos,
      cobertura,
      dias,
      advertencias: construirAdvertencias(dias, cobertura),
    };
  };
}

module.exports = { crearServicioClima };
