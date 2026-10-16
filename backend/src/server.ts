import path from "node:path";
import dotenv from "dotenv";
import { crearApp } from "./app";

// Compilado, este archivo queda en dist/backend/src (rootDir ".." en tsconfig.build.json).
const RAIZ_BACKEND = path.resolve(__dirname, path.extname(__filename) === ".ts" ? ".." : "../../..");
dotenv.config({ path: path.join(RAIZ_BACKEND, ".env"), quiet: true });

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
// "::" escucha en todas las interfaces (IPv6 e IPv4), como hacía Express; Fastify por defecto solo usa localhost.
const host = process.env.HOST?.trim() || "::";

crearApp({ apiKey })
  .listen({ port: puerto, host })
  .then(() => {
    console.log(`Backend escuchando en http://localhost:${puerto}`);
  })
  .catch((error: unknown) => {
    console.error("No fue posible iniciar el servidor:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
