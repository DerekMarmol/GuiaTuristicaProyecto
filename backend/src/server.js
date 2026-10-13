const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { crearApp } = require("./app");

const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
if (!apiKey) {
  console.error(
    "Falta la variable de entorno GEOAPIFY_API_KEY. Defínela en backend/.env (usa backend/.env.example como referencia).",
  );
  process.exit(1);
}

if (!process.env.OPENWEATHER_API_KEY?.trim()) {
  console.warn("Falta la variable de entorno OPENWEATHER_API_KEY. GET /api/clima/pronostico responderá 503 hasta que se defina en backend/.env.");
}

const puerto = Number(process.env.PORT) || 3000;

crearApp({ apiKey }).listen(puerto, () => {
  console.log(`Backend escuchando en http://localhost:${puerto}`);
});
