import type { FastifyPluginAsync } from "fastify";
import type { ModoTransporteRuta } from "../../../shared/types";
import { ErrorApi } from "../errores";

type TipoEvento = "clima" | "retraso" | "parada_cancelada";
const MODOS_TRANSPORTE: readonly ModoTransporteRuta[] = ["auto", "pedestrian"];
interface ParadaEvento {
  id: string;
  lat: number;
  lng: number;
  horaApertura: string;
  horaCierre: string;
  tiempoEstanciaMinutos: number;
  tipoEntorno?: string;
  tipo_entorno?: string;
  sensibilidadClima?: number | string;
  sensibilidad_clima?: number | string;
  probabilidadLluvia?: number;
  pronosticoHorario?: { hora: string; probabilidadLluvia: number }[];
}
interface EventoReoptimizacion {
  tipo: TipoEvento;
  paradas: ParadaEvento[];
  horaActualMinutos: number;
  paradaCanceladaId?: string;
  probabilidadLluvia?: number;
  modoTransporte?: ModoTransporteRuta;
}

function validarEvento(cuerpo: unknown): EventoReoptimizacion {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "El evento de ruta no es válido.");
  }
  const evento = cuerpo as Partial<EventoReoptimizacion>;
  if (!["clima", "retraso", "parada_cancelada"].includes(evento.tipo ?? "")) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "El tipo de evento debe ser clima, retraso o parada_cancelada.");
  }
  if (!Array.isArray(evento.paradas) || evento.paradas.length === 0 || evento.paradas.length > 100) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "Envía entre 1 y 100 paradas pendientes.");
  }
  if (!Number.isInteger(evento.horaActualMinutos) || evento.horaActualMinutos! < 0 || evento.horaActualMinutos! > 1440) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La hora actual debe expresarse en minutos entre 0 y 1440.");
  }
  const ids = new Set<string>();
  for (const p of evento.paradas) {
    if (!p || typeof p.id !== "string" || !p.id.trim() || ids.has(p.id) ||
      !Number.isFinite(p.lat) || p.lat < -90 || p.lat > 90 ||
      !Number.isFinite(p.lng) || p.lng < -180 || p.lng > 180 ||
      typeof p.horaApertura !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.horaApertura) ||
      typeof p.horaCierre !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.horaCierre) ||
      !Number.isInteger(p.tiempoEstanciaMinutos) || p.tiempoEstanciaMinutos < 0) {
      throw new ErrorApi(400, "PARAMETRO_INVALIDO", "Una o más paradas tienen datos inválidos o identificadores repetidos.");
    }
    ids.add(p.id);
  }
  if (evento.tipo === "parada_cancelada" && (!evento.paradaCanceladaId || !ids.has(evento.paradaCanceladaId))) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La parada cancelada debe pertenecer a la lista enviada.");
  }
  if (evento.tipo === "clima" && evento.probabilidadLluvia !== undefined &&
    (!Number.isFinite(evento.probabilidadLluvia) || evento.probabilidadLluvia < 0 || evento.probabilidadLluvia > 100)) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "La probabilidad de lluvia debe estar entre 0 y 100.");
  }
  if (evento.modoTransporte !== undefined && !MODOS_TRANSPORTE.includes(evento.modoTransporte)) {
    throw new ErrorApi(400, "PARAMETRO_INVALIDO", "El medio de transporte debe ser auto o pedestrian.");
  }
  return evento as EventoReoptimizacion;
}

export function crearRutaReoptimizacion({
  url = process.env.OPTIMIZER_URL ?? "http://localhost:8000",
  fetchImpl = fetch,
}: { url?: string; fetchImpl?: typeof fetch } = {}): FastifyPluginAsync {
  return async (app) => {
    app.post("/reoptimizar", { bodyLimit: 100 * 1024 }, async (req) => {
      const evento = validarEvento(req.body);
      const paradasPendientes = evento.paradas.filter((p) => p.id !== evento.paradaCanceladaId);
      if (paradasPendientes.length === 0) {
        return { tipoEvento: evento.tipo, ordenOptimo: [], distanciaTotalKm: 0, paradas: [] };
      }
      const paradas = paradasPendientes.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        hora_apertura: p.horaApertura,
        hora_cierre: p.horaCierre,
        tiempo_estancia_minutos: p.tiempoEstanciaMinutos,
        tipo_entorno: ({ indoor: "interior", outdoor: "exterior" } as Record<string, string>)[p.tipo_entorno ?? p.tipoEntorno ?? ""] ?? "desconocido",
        sensibilidad_clima: (() => {
          const sensibilidad = p.sensibilidad_clima ?? p.sensibilidadClima;
          if (typeof sensibilidad === "number") return sensibilidad;
          if (sensibilidad === "baja") return 0.25;
          if (sensibilidad === "media") return 0.6;
          if (sensibilidad === "alta") return 1;
          return evento.tipo === "clima" ? 1 : 0;
        })(),
        probabilidad_lluvia: p.probabilidadLluvia ?? (evento.tipo === "clima" ? evento.probabilidadLluvia : undefined),
        pronostico_horario: p.pronosticoHorario?.map((x) => ({ hora: x.hora, probabilidad_lluvia: x.probabilidadLluvia })) ?? [],
      }));
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(new URL("/reoptimize", url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            paradas,
            hora_actual_minutos: evento.horaActualMinutos,
            modo_transporte: evento.modoTransporte ?? "auto",
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new ErrorApi(502, "OPTIMIZADOR_NO_DISPONIBLE", "No fue posible conectar con el optimizador de rutas.");
      }
      if (respuesta.status === 503) {
        throw new ErrorApi(503, "SERVICIO_RUTAS_NO_DISPONIBLE", "El servicio de cálculo de rutas no está disponible en este momento.");
      }
      if (!respuesta.ok) {
        throw new ErrorApi(respuesta.status === 422 ? 409 : 502, "REOPTIMIZACION_NO_DISPONIBLE", "El optimizador no pudo encontrar una ruta válida para las paradas pendientes.");
      }
      let resultado: { orden_optimo?: unknown; distancia_total_km?: unknown };
      try { resultado = await respuesta.json() as typeof resultado; }
      catch { throw new ErrorApi(502, "RESPUESTA_OPTIMIZADOR_INVALIDA", "El optimizador devolvió una respuesta inválida."); }
      if (!Array.isArray(resultado.orden_optimo) || !resultado.orden_optimo.every((id) => typeof id === "string") ||
        resultado.orden_optimo.length !== paradasPendientes.length ||
        new Set(resultado.orden_optimo).size !== paradasPendientes.length ||
        resultado.orden_optimo.some((id) => !paradasPendientes.some((p) => p.id === id)) ||
        typeof resultado.distancia_total_km !== "number") {
        throw new ErrorApi(502, "RESPUESTA_OPTIMIZADOR_INVALIDA", "El optimizador devolvió un orden de paradas inválido.");
      }
      const porId = new Map(paradasPendientes.map((p) => [p.id, p]));
      return {
        tipoEvento: evento.tipo,
        ordenOptimo: resultado.orden_optimo as string[],
        distanciaTotalKm: resultado.distancia_total_km,
        paradas: (resultado.orden_optimo as string[]).map((id) => porId.get(id)),
      };
    });
  };
}
