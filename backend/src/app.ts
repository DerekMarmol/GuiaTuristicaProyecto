import express, { type Express } from "express";
import { crearClienteGeoapify } from "./geoapify/cliente";
import { crearClienteDetalles } from "./geoapify/detalles";
import { crearEnriquecedorHorarios } from "./geoapify/enriquecer";
import { crearRutaLugares } from "./routes/lugares";
import { crearClienteOpenWeather } from "./openweather/cliente";
import { crearServicioClima } from "./clima/servicio";
import { crearRutaPronosticoClima } from "./routes/pronosticoClima";
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
}

export function crearApp({
  apiKey = process.env.GEOAPIFY_API_KEY,
  fetch,
  tiempoEsperaMs,
  detalles = {},
  clima = {},
}: OpcionesApp = {}): Express {
  const app = express();
  app.disable("x-powered-by");

  const buscarLugares = crearClienteGeoapify({ apiKey, fetch, tiempoEsperaMs });
  const consultarDetalles = crearClienteDetalles({ apiKey, fetch, tiempoEsperaMs: detalles.tiempoEsperaMs });
  const enriquecerHorarios = crearEnriquecedorHorarios({
    consultarDetalles,
    concurrencia: detalles.concurrencia,
    intervaloMs: detalles.intervaloMs,
    presupuestoMs: detalles.presupuestoMs,
  });
  app.use("/api/lugares", crearRutaLugares(buscarLugares, enriquecerHorarios));

  const obtenerPronostico = crearClienteOpenWeather({
    apiKey: clima.apiKey === undefined ? process.env.OPENWEATHER_API_KEY : clima.apiKey,
    fetch: clima.fetch,
    tiempoEsperaMs: clima.tiempoEsperaMs,
  });
  const consultarClima = crearServicioClima({ obtenerPronostico, ahora: clima.ahora });
  app.use("/api/clima/pronostico", crearRutaPronosticoClima(consultarClima));

  app.use((req, res) => {
    res.status(404).json({
      error: { codigo: "RUTA_NO_ENCONTRADA", mensaje: "La ruta solicitada no existe." },
    });
  });

  app.use(manejarErrores);

  return app;
}
