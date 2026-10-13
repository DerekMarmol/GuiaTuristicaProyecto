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

const puerto = Number(process.env.PORT) || 3000;

crearApp({ apiKey }).listen(puerto, () => {
  console.log(`Backend escuchando en http://localhost:${puerto}`);
});
