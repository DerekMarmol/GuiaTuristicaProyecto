import Fastify, { type FastifyInstance } from "fastify";
import { crearClienteGeoapify } from "./geoapify/cliente";
import { crearClienteDetalles } from "./geoapify/detalles";
import { crearEnriquecedorHorarios, crearResolvedorLugares } from "./geoapify/enriquecer";
import { crearRutaLugares } from "./routes/lugares";
import { crearRutaItinerarios } from "./routes/itinerarios";
import { crearRutaReoptimizacion } from "./routes/reoptimizacion";
import { crearValidadorPropuestas } from "./ai/propuesta";
import { crearPriorizadorClima } from "./ai/prioridadClima";
import { crearClienteOpenWeather } from "./openweather/cliente";
import { crearServicioClima } from "./clima/servicio";
import { crearRutaPronosticoClima } from "./routes/pronosticoClima";
import authPlugin from "./plugins/auth.plugin";
import authRoutes from "./routes/auth.routes";
import { manejarErrores } from "./errores";
import type { FuncionFetch } from "./tipos";
import { rutaEta } from "./eta/rutaEta";
import { crearAgenteChat } from "./chat/agente";
import { crearClienteChatGemini, type ClienteChat } from "./chat/clienteChat";
import { crearRutaChat } from "./chat/rutaChat";

export interface OpcionesApp {
  apiKey?: string;
  fetch?: FuncionFetch;
  tiempoEsperaMs?: number;
  detalles?: {
    tiempoEsperaMs?: number;
    concurrencia?: number;
    intervaloMs?: number;
    presupuestoMs?: number;
  };
  clima?: {
    apiKey?: string;
    fetch?: FuncionFetch;
    tiempoEsperaMs?: number;
    ahora?: () => Date;
  };
  chat?: {
    cliente?: ClienteChat;
  };
}

export function crearApp({
  apiKey = process.env.GEOAPIFY_API_KEY,
  fetch,
  tiempoEsperaMs,
  detalles = {},
  clima = {},
  chat = {},
}: OpcionesApp = {}): FastifyInstance {
  // Igual que con Express: rutas sin distinguir mayúsculas y con o sin barra final.
  // frameworkErrors da el mismo formato de error a fallos previos al enrutamiento, como una URL mal formada.
  const app = Fastify({
    routerOptions: { ignoreTrailingSlash: true, caseSensitive: false },
    frameworkErrors: manejarErrores,
  });
  app.setErrorHandler(manejarErrores);
  app.register(authPlugin);
  app.register(authRoutes, { prefix: "/api/auth" });
  
  const buscarLugares = crearClienteGeoapify({ apiKey, fetch, tiempoEsperaMs });
  const consultarDetalles = crearClienteDetalles({ apiKey, fetch, tiempoEsperaMs: detalles.tiempoEsperaMs });
  const opcionesDetalles = {
    consultarDetalles,
    concurrencia: detalles.concurrencia,
    intervaloMs: detalles.intervaloMs,
    presupuestoMs: detalles.presupuestoMs,
  };
  const enriquecerHorarios = crearEnriquecedorHorarios(opcionesDetalles);
  app.register(crearRutaLugares(buscarLugares, enriquecerHorarios), { prefix: "/api/lugares" });
  const clienteChat = chat.cliente ?? (process.env.GEMINI_API_KEY ? crearClienteChatGemini() : undefined);
  app.register(crearRutaChat(crearAgenteChat({ cliente: clienteChat })), { prefix: "/api/chat" });

  const obtenerPronostico = crearClienteOpenWeather({
    apiKey: clima.apiKey === undefined ? process.env.OPENWEATHER_API_KEY : clima.apiKey,
    fetch: clima.fetch,
    tiempoEsperaMs: clima.tiempoEsperaMs,
  });
  const consultarClima = crearServicioClima({ obtenerPronostico, ahora: clima.ahora });

  const resolverLugares = crearResolvedorLugares(opcionesDetalles);
  const validarPropuesta = crearValidadorPropuestas({ resolverLugares });
  const priorizarPorClima = crearPriorizadorClima({ resolverLugares, consultarClima });
  app.register(crearRutaItinerarios(validarPropuesta, priorizarPorClima), { prefix: "/api/itinerarios" });
  app.register(crearRutaReoptimizacion(), { prefix: "/api/itinerarios" });
  app.register(rutaEta, { prefix: "/api/itinerarios" });

  app.register(crearRutaPronosticoClima(consultarClima), { prefix: "/api/clima/pronostico" });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: { codigo: "RUTA_NO_ENCONTRADA", mensaje: "La ruta solicitada no existe." },
    });
  });

  return app;
}
