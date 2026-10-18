import express, { type Express } from "express";
import { crearClienteGeoapify } from "./geoapify/cliente";
import { crearClienteDetalles } from "./geoapify/detalles";
import { crearEnriquecedorHorarios, crearResolvedorLugares } from "./geoapify/enriquecer";
import { crearRutaLugares } from "./routes/lugares";
import { crearRutaItinerarios } from "./routes/itinerarios";
import { crearValidadorPropuestas } from "./ai/propuesta";
import { crearPriorizadorClima } from "./ai/prioridadClima";
import { crearClienteOpenWeather } from "./openweather/cliente";
import { crearServicioClima } from "./clima/servicio";
import { crearRutaPronosticoClima } from "./routes/pronosticoClima";
import { crearRecomendadorHoteles } from "./hoteles/recomendaciones";
import { crearBuscadorHoteles } from "./hoteles/serpapi";
import { crearObtenedorTipoCambio } from "./hoteles/tipoCambio";
import { crearRutaHoteles } from "./routes/hoteles";
import { manejarErrores } from "./errores";
import type { FuncionFetch } from "./tipos";

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
  hoteles?: {
    serpApiKey?: string;
    exchangeRateApiKey?: string;
    fetch?: FuncionFetch;
    tiempoEsperaMs?: number;
    tiempoEsperaTipoCambioMs?: number;
    ahora?: () => Date;
  };
}

export function crearApp({
  apiKey = process.env.GEOAPIFY_API_KEY,
  fetch,
  tiempoEsperaMs,
  detalles = {},
  clima = {},
  hoteles = {},
}: OpcionesApp = {}): Express {
  const app = express();
  app.disable("x-powered-by");

  const buscarLugares = crearClienteGeoapify({ apiKey, fetch, tiempoEsperaMs });
  const consultarDetalles = crearClienteDetalles({ apiKey, fetch, tiempoEsperaMs: detalles.tiempoEsperaMs });
  const opcionesDetalles = {
    consultarDetalles,
    concurrencia: detalles.concurrencia,
    intervaloMs: detalles.intervaloMs,
    presupuestoMs: detalles.presupuestoMs,
  };
  const enriquecerHorarios = crearEnriquecedorHorarios(opcionesDetalles);
  app.use("/api/lugares", crearRutaLugares(buscarLugares, enriquecerHorarios));

  const obtenerPronostico = crearClienteOpenWeather({
    apiKey: clima.apiKey === undefined ? process.env.OPENWEATHER_API_KEY : clima.apiKey,
    fetch: clima.fetch,
    tiempoEsperaMs: clima.tiempoEsperaMs,
  });
  const consultarClima = crearServicioClima({ obtenerPronostico, ahora: clima.ahora });

  const resolverLugares = crearResolvedorLugares(opcionesDetalles);
  const validarPropuesta = crearValidadorPropuestas({ resolverLugares });
  const priorizarPorClima = crearPriorizadorClima({ resolverLugares, consultarClima });
  app.use("/api/itinerarios", crearRutaItinerarios(validarPropuesta, priorizarPorClima));

  app.use("/api/clima/pronostico", crearRutaPronosticoClima(consultarClima));

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
  app.use("/api/hoteles", crearRutaHoteles(recomendarHoteles, ahoraHoteles));

  app.use((req, res) => {
    res.status(404).json({
      error: { codigo: "RUTA_NO_ENCONTRADA", mensaje: "La ruta solicitada no existe." },
    });
  });

  app.use(manejarErrores);

  return app;
}
