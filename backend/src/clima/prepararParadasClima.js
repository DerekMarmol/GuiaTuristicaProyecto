
const obtenerClima = require("./climaService");

async function prepararParadasClima(paradas, fechaHora) {
  if (!Array.isArray(paradas)) {
    throw new Error("Las paradas deben ser un arreglo");
  }

  return Promise.all(
    paradas.map(async (parada) => {
      const resultado = { ...parada };

      const lat = Number(parada.lat);
      const lng = Number(parada.lng);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        !fechaHora
      ) {
        return resultado;
      }

      try {
        const clima = await obtenerClima(
          lat,
          lng,
          fechaHora
        );

        if (
          clima &&
          Number.isFinite(Number(clima.probabilidadLluvia))
        ) {
          resultado.probabilidad_lluvia =
            Number(clima.probabilidadLluvia);
        }
      } catch (error) {
        console.warn(
          "Clima no disponible para:",
          parada.id
        );
      }

      return resultado;
    })
  );
}

module.exports = prepararParadasClima;
