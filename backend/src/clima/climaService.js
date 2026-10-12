const URL_CLIMA = "https://api.open-meteo.com/v1/forecast";

const cache = new Map();

const DURACION_CACHE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 5000;

async function consultarClima(latitud, longitud, fechaHora) {
  const lat = Number(latitud);
  const lon = Number(longitud);
  const fecha = new Date(fechaHora);

  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lon) || lon < -180 || lon > 180 ||
    Number.isNaN(fecha.getTime())
  ) {
    throw new Error("Coordenadas o fecha inválidas");
  }

  const fechaConsulta = fecha.toISOString().slice(0, 10);
  const horaConsulta = fecha.toISOString().slice(0, 13);

  const claveCache = `${lat},${lon},${fechaConsulta}`;

  const guardado = cache.get(claveCache);

  if (guardado && Date.now() < guardado.expira) {
  console.log("CLIMA: Datos obtenidos desde caché");
  return obtenerHora(guardado.datos, horaConsulta);
}

  const parametros = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "temperature_2m,precipitation_probability,weather_code",
    timezone: "GMT",
    start_date: fechaConsulta,
    end_date: fechaConsulta
  });

  try {
    const respuesta = await fetch(
      `${URL_CLIMA}?${parametros}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );

    if (!respuesta.ok) {
      throw new Error(`Error meteorológico: ${respuesta.status}`);
    }

    const datos = await respuesta.json();

    if (!datos.hourly?.time) {
      throw new Error("Pronóstico no disponible");
    }

    cache.set(claveCache, {
      datos,
      expira: Date.now() + DURACION_CACHE_MS
    });

    console.log("CLIMA: Datos obtenidos desde Open-Meteo");

    return obtenerHora(datos, horaConsulta);

  } catch (error) {
    console.error("No se pudo consultar el clima:", error.message);
    return null;
  }
}

function obtenerHora(datos, horaConsulta) {
  const indice = datos.hourly.time.indexOf(horaConsulta + ":00");

  if (indice === -1) {
    return null;
  }

  const probabilidadLluvia =
    datos.hourly.precipitation_probability[indice];

  const temperatura =
    datos.hourly.temperature_2m[indice];

  const codigoClima =
    datos.hourly.weather_code[indice];

  if (
    !Number.isFinite(probabilidadLluvia) ||
    !Number.isFinite(temperatura) ||
    !Number.isFinite(codigoClima)
  ) {
    return null;
  }

  return {
    fechaHora: datos.hourly.time[indice] + "Z",
    temperatura,
    probabilidadLluvia,
    codigoClima,
    malClima: probabilidadLluvia >= 60 ||
      [65, 67, 75, 77, 82, 86, 95, 96, 99].includes(codigoClima)
  };
}

module.exports = { consultarClima };
