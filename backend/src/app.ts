import Fastify, { type FastifyInstance } from "fastify";
import { crearClienteGeoapify, crearConsultaPlaces } from "./geoapify/cliente";
import { crearClienteDetalles } from "./geoapify/detalles";
import { crearConsultaApertura, crearEnriquecedorHorarios, crearResolvedorLugares } from "./geoapify/enriquecer";
import { crearBuscadorAbiertosAhora } from "./lugares/abiertosAhora";
import { crearCacheApertura } from "./lugares/cacheApertura";
import { crearRutaLugares } from "./routes/lugares";
import { crearRutaItinerarios } from "./routes/itinerarios";
import { crearRutaReoptimizacion } from "./routes/reoptimizacion";
import { crearValidadorPropuestas } from "./ai/propuesta";
import { crearClienteGemini, type ClienteLLM } from "./ai/cliente";
import { crearGeocodificador } from "./geoapify/geocodificacion";
import { crearGeneradorItinerario } from "./itinerarios/generacion";
import { crearPriorizadorClima } from "./ai/prioridadClima";
import { crearClienteClimaActual, crearClienteOpenWeather } from "./openweather/cliente";
import { leerConfiguracionClimaReactivo, type ConfiguracionClimaReactivo } from "./config/climaReactivo";
import { crearBuscadorAlternativas } from "./clima/reactivo/alternativas";
import { crearObtenedorClima } from "./clima/reactivo/climaCache";
import { crearFirmador } from "./clima/reactivo/firma";
import { crearReoptimizadorClima } from "./clima/reactivo/optimizador";
import { crearServicioClimaReactivo } from "./clima/reactivo/servicio";
import { crearClienteOptimizador } from "./optimizador/cliente";
import { crearRutaClimaReactivo } from "./routes/climaReactivo";
import { crearServicioClima } from "./clima/servicio";
import { crearRutaPronosticoClima } from "./routes/pronosticoClima";
import { crearRutaClimaActual } from "./routes/climaActual";
import { crearRecomendadorHoteles } from "./hoteles/recomendaciones";
import { crearBuscadorHoteles } from "./hoteles/serpapi";
import { crearObtenedorTipoCambio } from "./hoteles/tipoCambio";
import { crearRutaHoteles } from "./routes/hoteles";
import { crearBuscadorRestaurantes } from "./restaurantes/busqueda";
import { crearRecomendadorRestaurantes } from "./restaurantes/recomendaciones";
import { crearRutaRestaurantes } from "./routes/restaurantes";
import authPlugin from "./plugins/auth.plugin";
import authRoutes from "./routes/auth.routes";
import usuariosRoutes from "./routes/usuarios.routes";
import { manejarErrores } from "./errores";
import type { FuncionFetch } from "./tipos";
import { rutaEta } from "./eta/rutaEta";
import { crearAgenteChat } from "./chat/agente";
import { crearClienteChatGemini, type ClienteChat } from "./chat/clienteChat";
import { crearRutaChat } from "./chat/rutaChat";
import { crearReoptimizadorChat, type ClienteOptimizador } from "./chat/optimizador";

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
  abiertosAhora?: {
    ahora?: () => Date;
    vigenciaCacheMs?: number;
  };
  clima?: {
    apiKey?: string;
    fetch?: FuncionFetch;
    tiempoEsperaMs?: number;
    ahora?: () => Date;
  };
  hoteles?: {
    serpApiKey?: string;
    exchangeRateApiKey?: string;
    fetch?: FuncionFetch;
    tiempoEsperaMs?: number;
    tiempoEsperaTipoCambioMs?: number;
    ahora?: () => Date;
  };
  restaurantes?: {
    concurrencia?: number;
    intervaloMs?: number;
  };
  climaReactivo?: {
    optimizadorUrl?: string;
    fetchOptimizador?: typeof fetch;
    ahora?: () => Date;
    secreto?: string;
    configuracion?: ConfiguracionClimaReactivo;
  };
  chat?: {
    cliente?: ClienteChat;
  };
  optimizador?: {
    cliente?: ClienteOptimizador;
    url?: string;
    fetchImpl?: typeof fetch;
    tiempoEsperaMs?: number;
  };
  generacion?: {
    cliente?: ClienteLLM | null;
  };
}

export function crearApp({
  apiKey = process.env.GEOAPIFY_API_KEY,
  fetch,
  tiempoEsperaMs,
  detalles = {},
  abiertosAhora = {},
  clima = {},
  hoteles = {},
  restaurantes = {},
  climaReactivo = {},
  chat = {},
  optimizador = {},
  generacion = {},
}: OpcionesApp = {}): FastifyInstance {
  const app = Fastify({
    routerOptions: { ignoreTrailingSlash: true, caseSensitive: false },
    frameworkErrors: manejarErrores,
  });
  app.setErrorHandler(manejarErrores);
  app.register(authPlugin);
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(usuariosRoutes, { prefix: "/api/usuarios" });
  
  const buscarLugares = crearClienteGeoapify({ apiKey, fetch, tiempoEsperaMs });
  const consultarDetalles = crearClienteDetalles({ apiKey, fetch, tiempoEsperaMs: detalles.tiempoEsperaMs });
  const opcionesDetalles = {
    consultarDetalles,
    concurrencia: detalles.concurrencia,
    intervaloMs: detalles.intervaloMs,
    presupuestoMs: detalles.presupuestoMs,
  };
  const enriquecerHorarios = crearEnriquecedorHorarios(opcionesDetalles);
  const ahoraAbiertos = abiertosAhora.ahora ?? (() => new Date());
  const buscarAbiertosAhora = crearBuscadorAbiertosAhora({
    buscarLugares,
    consultarApertura: crearCacheApertura({
      consultar: crearConsultaApertura(opcionesDetalles),
      vigenciaMs: abiertosAhora.vigenciaCacheMs,
      ahora: ahoraAbiertos,
    }),
    ahora: ahoraAbiertos,
  });
  app.register(crearRutaLugares(buscarLugares, enriquecerHorarios, buscarAbiertosAhora), { prefix: "/api/lugares" });
  const clienteChat = chat.cliente ?? (process.env.GEMINI_API_KEY ? crearClienteChatGemini() : undefined);
  const reoptimizadorChat =
    optimizador.cliente ??
    crearReoptimizadorChat(
      crearClienteOptimizador({ url: optimizador.url, fetchImpl: optimizador.fetchImpl, tiempoEsperaMs: optimizador.tiempoEsperaMs }),
    );
  app.register(crearRutaChat(crearAgenteChat({ cliente: clienteChat, optimizador: reoptimizadorChat })), { prefix: "/api/chat" });
  const obtenerPronostico = crearClienteOpenWeather({
    apiKey: clima.apiKey === undefined ? process.env.OPENWEATHER_API_KEY : clima.apiKey,
    fetch: clima.fetch,
    tiempoEsperaMs: clima.tiempoEsperaMs,
  });
  const consultarClima = crearServicioClima({ obtenerPronostico, ahora: clima.ahora });

  const resolverLugares = crearResolvedorLugares(opcionesDetalles);
  const validarPropuesta = crearValidadorPropuestas({ resolverLugares });
  const priorizarPorClima = crearPriorizadorClima({ resolverLugares, consultarClima });
  const generarItinerario = crearGeneradorItinerario({
    geocodificar: crearGeocodificador({ apiKey, fetch, tiempoEsperaMs }),
    buscarLugares,
    enriquecerHorarios,
    cliente:
      generacion.cliente === undefined
        ? process.env.GEMINI_API_KEY ? crearClienteGemini() : undefined
        : generacion.cliente ?? undefined,
  });
  app.register(crearRutaItinerarios(validarPropuesta, priorizarPorClima, generarItinerario), { prefix: "/api/itinerarios" });
  app.register(crearRutaReoptimizacion(), { prefix: "/api/itinerarios" });
  app.register(rutaEta, { prefix: "/api/itinerarios" });

  app.register(crearRutaPronosticoClima(consultarClima), { prefix: "/api/clima/pronostico" });

  const obtenerClimaActual = crearClienteClimaActual({
    apiKey: clima.apiKey === undefined ? process.env.OPENWEATHER_API_KEY : clima.apiKey,
    fetch: clima.fetch,
    tiempoEsperaMs: clima.tiempoEsperaMs,
  });
  app.register(crearRutaClimaActual(obtenerClimaActual), { prefix: "/api/clima/actual" });

  const configClimaReactivo = climaReactivo.configuracion ?? leerConfiguracionClimaReactivo();
  const ahoraClimaReactivo = climaReactivo.ahora ?? clima.ahora ?? (() => new Date());
  const servicioClimaReactivo = crearServicioClimaReactivo({
    obtenerClima: crearObtenedorClima({
      obtenerClimaActual,
      obtenerPronostico,
      vigenciaMs: configClimaReactivo.vigenciaCacheClimaMs,
      ahora: ahoraClimaReactivo,
    }),
    buscarAlternativas: crearBuscadorAlternativas({ buscarLugares, enriquecerHorarios, config: configClimaReactivo }),
    reoptimizarClima: crearReoptimizadorClima(
      crearClienteOptimizador({
        url: climaReactivo.optimizadorUrl,
        fetchImpl: climaReactivo.fetchOptimizador,
        tiempoEsperaMs: configClimaReactivo.tiempoEsperaOptimizadorMs,
      }),
    ),
    firmador: crearFirmador(climaReactivo.secreto ?? process.env.CLIMA_REACTIVO_SECRETO),
    config: configClimaReactivo,
    ahora: ahoraClimaReactivo,
  });
  app.register(crearRutaClimaReactivo(servicioClimaReactivo), { prefix: "/api/itinerarios/clima-reactivo" });

  const ahoraHoteles = hoteles.ahora ?? (() => new Date());
  const recomendarHoteles = crearRecomendadorHoteles({
    buscador: crearBuscadorHoteles({
      apiKey: hoteles.serpApiKey === undefined ? process.env.SERPAPI_API_KEY : hoteles.serpApiKey,
      fetch: hoteles.fetch ?? fetch,
      tiempoEsperaMs: hoteles.tiempoEsperaMs,
      ahora: ahoraHoteles,
    }),
    tipoCambio: crearObtenedorTipoCambio({
      apiKey: hoteles.exchangeRateApiKey === undefined ? process.env.EXCHANGERATE_API_KEY : hoteles.exchangeRateApiKey,
      fetch: hoteles.fetch ?? fetch,
      tiempoEsperaMs: hoteles.tiempoEsperaTipoCambioMs ?? hoteles.tiempoEsperaMs,
      ahora: ahoraHoteles,
    }),
  });
  app.register(crearRutaHoteles(recomendarHoteles, ahoraHoteles), { prefix: "/api/hoteles" });

  const recomendarRestaurantes = crearRecomendadorRestaurantes({
    buscar: crearBuscadorRestaurantes(crearConsultaPlaces({ apiKey, fetch, tiempoEsperaMs })),
    concurrencia: restaurantes.concurrencia,
    intervaloMs: restaurantes.intervaloMs,
  });
  app.register(crearRutaRestaurantes(recomendarRestaurantes), { prefix: "/api/restaurantes" });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: { codigo: "RUTA_NO_ENCONTRADA", mensaje: "La ruta solicitada no existe." },
    });
  });

  return app;
}
