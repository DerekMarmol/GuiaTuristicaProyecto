import { redis, cacheService } from "../src/lib/redis";
import { crearConsultaPlaces } from "../src/geoapify/cliente";
import { crearClienteClimaActual } from "../src/openweather/cliente";

async function probarCacheApisExternas() {
  console.log("--- Probando Cache-Aside en APIs Externas (OpenWeather y Geoapify) ---\n");

  if (redis.status === "wait") {
    await redis.connect();
  }

  let llamadasRealesClima = 0;
  const mockFetchClima = async () => {
    llamadasRealesClima++;
    return new Response(
      JSON.stringify({
        coord: { lon: -90.7295, lat: 14.5586 },
        weather: [
          {
            id: 800,
            main: "Clear",
            description: "cielo claro",
            icon: "01d",
          },
        ],
        base: "stations",
        main: {
          temp: 21.5,
          feels_like: 21.0,
          temp_min: 19.0,
          temp_max: 23.0,
          pressure: 1015,
          humidity: 60,
        },
        visibility: 10000,
        wind: {
          speed: 3.0,
          deg: 120,
        },
        clouds: {
          all: 0,
        },
        dt: Math.floor(Date.now() / 1000),
        sys: {
          type: 1,
          id: 1234,
          country: "GT",
          sunrise: 1729425600,
          sunset: 1729468800,
        },
        timezone: -21600,
        id: 3598132,
        name: "Antigua Guatemala",
        cod: 200,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const obtenerClima = crearClienteClimaActual({
    apiKey: "dummy-key",
    fetch: mockFetchClima as any,
  });

  const ubicacionClima = { lat: 14.5586, lng: -90.7295 };
  const claveClima = `cache:openweather:actual:${ubicacionClima.lat.toFixed(2)}:${ubicacionClima.lng.toFixed(2)}`;
  await cacheService.del(claveClima);

  console.log("1. Ejecutando primera consulta de clima...");
  await obtenerClima(ubicacionClima);

  console.log("2. Ejecutando segunda consulta idéntica de clima...");
  await obtenerClima(ubicacionClima);

  console.log(`-> Llamadas reales a la API de clima: ${llamadasRealesClima} (esperado: 1)`);

  let llamadasRealesPlaces = 0;
  const mockFetchPlaces = async () => {
    llamadasRealesPlaces++;
    return new Response(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              name: "Parque Central",
              formatted: "Parque Central, Antigua Guatemala",
              categories: ["tourism.sights"],
              lon: -90.733,
              lat: 14.558,
              place_id: "geoapify_parque_central_123",
            },
            geometry: {
              type: "Point",
              coordinates: [-90.733, 14.558],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const consultarPlaces = crearConsultaPlaces({
    apiKey: "dummy-key",
    fetch: mockFetchPlaces as any,
  });

  const consultaLugares = {
    lat: 14.558,
    lng: -90.733,
    radio: 1000,
    limite: 5,
    categorias: ["tourism.sights"],
  };

  const clavePlaces = `cache:geoapify:places:${consultaLugares.lat.toFixed(3)}:${consultaLugares.lng.toFixed(3)}:${consultaLugares.radio}:${consultaLugares.limite}:tourism.sights`;
  await cacheService.del(clavePlaces);

  console.log("\n3. Ejecutando primera consulta a Geoapify...");
  await consultarPlaces(consultaLugares);

  console.log("4. Ejecutando segunda consulta idéntica a Geoapify...");
  await consultarPlaces(consultaLugares);

  console.log(`-> Llamadas reales a la API de Geoapify: ${llamadasRealesPlaces} (esperado: 1)`);

  const exito = llamadasRealesClima === 1 && llamadasRealesPlaces === 1;

  if (exito) {
    console.log("\n✅ Cache-Aside verificado con éxito: las consultas repetidas no generan llamadas externas.");
  } else {
    console.error("\n❌ Falló la retención en caché de las APIs externas.");
  }

  await cacheService.del(claveClima);
  await cacheService.del(clavePlaces);
  await redis.quit();
}

probarCacheApisExternas().catch((err) => {
  console.error("Error al ejecutar la prueba:", err);
  process.exit(1);
});