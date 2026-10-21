import { useEffect, useMemo, useRef, useState } from "react";
import { useViaje } from "../context/ViajeContext";
import Stepper from "../components/Stepper";
import Recomendaciones from "../components/Recomendaciones";
import { MapaSeguro } from "../components/MapaSeguro";
import { PanelTelemetria } from "../components/PanelTelemetria";
import PanelEta from "../components/PanelEta";
import IndicadorClima, { type EstadoPronostico } from "../components/IndicadorClima";
import AlertaHorario from "../components/AlertaHorario";
import PanelPresupuesto from "../components/PanelPresupuesto";
import { generarGastosSimulados } from "../services/gastos";
import CalificacionParada, { ResumenCalificacion } from "../components/CalificacionParada";
import type { RespuestaClima } from "../../../shared/types";
import { consultarClimaActual, consultarPronostico, coordenadasDelViaje, hayLluviaSignificativa, type ClimaAhora } from "../services/clima";
import { modoTransporteRuta, reoptimizarRuta, type TipoEventoRuta } from "../services/reoptimizacion";
import type { RespuestaEta } from "../services/eta";
import PropuestaClima from "../components/PropuestaClima";
import { useMonitoreoClima } from "../hooks/useMonitoreoClima";
import { aplicarParadasPropuestas, construirItinerarioActivo, fechaLocal, firmaItinerario } from "../services/climaReactivoEstado";
import { BarraAbiertosAhora, ResultadosAbiertosAhora, describirReferencia, type FiltroAbiertos } from "../components/AbiertosAhora";
import type { CapaAbiertosAhora } from "../components/Mapa";
import { useAbiertosAhora } from "../hooks/useAbiertosAhora";
import { coordenadasValidas, lugaresParaMapa } from "../services/abiertosAhora";

import {
  generarItinerario,
  guardarPlanViaje,
  exportarPlanViaje,
  PASOS_GENERACION,
} from "../services/itinerario";
import type { ParadaConHorario } from "../services/itinerario";

import { calcularHorarios } from "../utils/horarios";
import { diasDeViaje, fechaCorta } from "../utils/fechas";

import "./pasos.css";

const MONEDA = "Q";

const TIPOS = {
  solo: "Solo",
  pareja: "En pareja",
  familia: "En familia",
  amigos: "Con amigos",
} as const;

type Fase = "generando" | "listo" | "error";
type Voto = "favor" | "contra";

const TRANSPORTE_CONFIG: Record<
  string,
  { etiquetaEstacionamiento: string }
> = {
  pie: { etiquetaEstacionamiento: "Caminata y accesos" },
  bus: { etiquetaEstacionamiento: "Espera de parada / abordaje" },
  auto: { etiquetaEstacionamiento: "Estacionamiento y peatonal" },
  moto: { etiquetaEstacionamiento: "Parqueo y preparación" },
  aereo: { etiquetaEstacionamiento: "Check-in, seguridad y abordaje" },
};

function obtenerTiempoTraslado(
  parada: ParadaConHorario,
  indice: number,
  transporte: string | undefined
): { minutos: number; estimado: boolean } | null {
  const p = parada as ParadaConHorario & {
    tiempoTrasladoMinutos?: number;
    tipoTraslado?: string;
    holgura?: { tiempoBaseMinutos?: number; tipoTraslado?: string };
    desgloseHolgura?: { tiempoBaseMinutos?: number; tipoTraslado?: string };
    traslado?: { holgura?: { tiempoBaseMinutos?: number; tipoTraslado?: string } };
  };
  const h = p.holgura || p.desgloseHolgura || p.traslado?.holgura;
  const registrado = h?.tiempoBaseMinutos ?? p.tiempoTrasladoMinutos;
  if (typeof registrado === "number" && Number.isFinite(registrado) && registrado > 0) {
    return { minutos: registrado, estimado: false };
  }
  const tipo = String(h?.tipoTraslado || p.tipoTraslado || transporte || "").toLowerCase();
  const modo = tipo.includes("pie") || tipo.includes("camin") ? "pie"
    : tipo.includes("bus") || tipo.includes("colectivo") ? "bus"
    : tipo.includes("moto") ? "moto"
    : tipo.includes("aereo") || tipo.includes("avion") || tipo.includes("vuelo") ? "aereo"
    : "auto";
  const tiempos: Record<string, number[]> = {
    pie: [10, 15, 8, 12, 20],
    moto: [12, 18, 15, 22, 10],
    auto: [15, 25, 18, 30, 20],
    bus: [20, 35, 25, 40, 30],
    aereo: [45, 60, 50, 90, 75],
  };
  const semillaId = parada.id
    ? parada.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
    : 0;
  const lista = tiempos[modo];
  return { minutos: lista[(indice + semillaId) % lista.length], estimado: true };
}

function obtenerAlertaHorario(parada: ParadaConHorario) {
  if (
    parada.estadoHorario === "ajustada" ||
    parada.estadoHorario === "descartada"
  ) {
    return {
      estado: parada.estadoHorario,
      mensaje:
        parada.mensajeHorario ??
        "La visita requiere un ajuste de horario.",
    };
  }

  return null;
}

export default function Paso4Generacion() {
  const {
    viaje,
    itinerarios,
    setItinerarios,
    fijarUbicacionDestino,
    irAPaso,
    reiniciar,
    calificaciones,
    guardarCalificacion,
    gastos,
    setGastos,
    agregarGasto,
    eliminarGasto,
  } = useViaje();

  // Estados
  const [fase, setFase] = useState<Fase>(
    itinerarios ? "listo" : "generando"
  );
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState("");
  const [advertencias, setAdvertencias] = useState<string[]>([]);
  const [intento, setIntento] = useState(0);
  const [diaActivo, setDiaActivo] = useState(0);
  const [votos, setVotos] = useState<Record<string, Voto>>({});
  const [copiado, setCopiado] = useState("");
  const [calificando, setCalificando] = useState<string | null>(null);
  const [visitadas, setVisitadas] = useState<Record<string, boolean>>({});
  // El seguimiento comienza únicamente cuando el usuario inicia el traslado.
  const [inicioSeguimiento, setInicioSeguimiento] = useState<number | null>(null);
  const [tiempoActual, setTiempoActual] = useState(() => Date.now());
  const [etaMapa, setEtaMapa] = useState<RespuestaEta | null>(null);
  // Estados para el guardado del plan
  const [guardando, setGuardando] = useState(false);
  const [idGuardado, setIdGuardado] = useState<string | null>(null);
  const [notificacionGuardado, setNotificacionGuardado] = useState<{
    tipo: "exito" | "local" | "error";
    texto: string;
  } | null>(null);

  async function manejarGuardarPlan() {
    if (!itinerarios || guardando) return;
    setGuardando(true);
    setNotificacionGuardado(null);

    try {
      const resultado = await guardarPlanViaje(viaje, itinerarios);
      if (resultado.guardadoEn === "servidor") {
        setIdGuardado(resultado.id || null);
        setNotificacionGuardado({
          tipo: "exito",
          texto: `${resultado.mensaje} (ID: ${resultado.id})`,
        });
      } else {
        setNotificacionGuardado({
          tipo: "local",
          texto: resultado.mensaje,
        });
      }
    } catch (err) {
      setNotificacionGuardado({
        tipo: "error",
        texto: err instanceof Error ? err.message : "Error al guardar el plan",
      });
    } finally {
      setGuardando(false);
    }
  }
  const [exportando, setExportando] = useState(false);

async function manejarExportarPlan() {
  // Si ya fue guardado en el servidor usamos su id, si no usamos el último id persistido
  const idParaExportar = idGuardado || localStorage.getItem("ultimo_viaje_id");

  if (!idParaExportar) {
    setNotificacionGuardado({
      tipo: "local",
      texto: "Debes guardar el plan en tu cuenta antes de poder exportarlo.",
    });
    return;
  }

  setExportando(true);
  try {
    await exportarPlanViaje(idParaExportar);
  } catch (err) {
    setNotificacionGuardado({
      tipo: "error",
      texto: err instanceof Error ? err.message : "No se pudo exportar el archivo.",
    });
  } finally {
    setExportando(false);
  }
}

  useEffect(() => {
    const intervalo = window.setInterval(() => setTiempoActual(Date.now()), 60_000);
    return () => window.clearInterval(intervalo);
  }, []);

  const [pronostico, setPronostico] = useState<RespuestaClima | null>(null);
  const [estadoPronostico, setEstadoPronostico] = useState<EstadoPronostico>("cargando");
  const [reoptimizando, setReoptimizando] = useState(false);
  const [avisoReoptimizacion, setAvisoReoptimizacion] = useState("");
  const [paradasVisitadas, setParadasVisitadas] = useState<Record<string, string[]>>({});
  const diasClimaAplicados = useRef(new Set<string>());

  const [codigo] = useState(() =>
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );

  const enlaceRef = useRef<HTMLInputElement>(null);

  const esGrupo = viaje.tipoViaje === "amigos";
  const presupuestoDiario =
    viaje.presupuestoDiario ??
    (viaje.presupuesto !== undefined
      ? Math.round(viaje.presupuesto / Math.max(1, diasDeViaje(viaje.fechaInicio, viaje.fechaFin)))
      : 500);
  const dias = diasDeViaje(viaje.fechaInicio, viaje.fechaFin);
  const enlace = `https://guiaturistica.example/votar/${codigo}`;

  async function solicitarReoptimizacion(tipo: TipoEventoRuta, paradaCanceladaId?: string, probabilidadLluvia?: number) {
    const diaSolicitado = itinerarios?.[diaActivo];
    if (!diaSolicitado || reoptimizando) return;
    const completadas = new Set([
      ...(paradasVisitadas[diaSolicitado.id] ?? []),
      ...diaSolicitado.paradas
        .filter((parada) => visitadas[parada.id] || Boolean(calificaciones[parada.id]))
        .map((parada) => parada.id),
    ]);
    const paradasPendientes = diaSolicitado.paradas.filter((p) =>
      !completadas.has(p.id) && (p as ParadaConHorario).estadoHorario !== "descartada"
    );
    if (paradasPendientes.length === 0) {
      setAvisoReoptimizacion("No hay paradas pendientes para recalcular.");
      return;
    }
    setReoptimizando(true);
    setAvisoReoptimizacion("Recalculando el orden de las paradas…");
    try {
      const paradasReoptimizadas = await reoptimizarRuta({
        tipo,
        paradas: paradasPendientes,
        paradaCanceladaId,
        probabilidadLluvia,
        modoTransporte: modoTransporteRuta(viaje.transporte),
      });
      const paradas = [
        ...diaSolicitado.paradas.filter((p) => completadas.has(p.id)),
        ...paradasReoptimizadas,
      ];
      setItinerarios((actuales) => actuales?.map((it) =>
        it.id === diaSolicitado.id ? { ...it, paradas } : it
      ) ?? null);
      setEtaMapa(null);
      setAvisoReoptimizacion("El plan se actualizó con el nuevo orden de paradas.");
    } catch (err) {
      setAvisoReoptimizacion(err instanceof Error ? err.message : "No se pudo actualizar la ruta.");
    } finally {
      setReoptimizando(false);
    }
  }

  // Generar itinerario
  useEffect(() => {
    if (itinerarios) {
      setFase("listo");
      return;
    }

    // Abortar la solicitud si el paso se desmonta o se regenera evita pagar dos veces la generación.
    const controlador = new AbortController();
    const cancelado = () => controlador.signal.aborted;

    setFase("generando");
    setProgreso(0);
    setError("");
    setAdvertencias([]);

    generarItinerario(viaje, (n) => {
      if (!cancelado()) {
        setProgreso(n);
      }
    }, controlador.signal)
      .then((resultado) => {
        if (cancelado()) return;

        setItinerarios(resultado.itinerarios);
        fijarUbicacionDestino(resultado.destino.lat, resultado.destino.lng);
        setAdvertencias(resultado.advertencias);
        // TODO(backend): cargar los gastos reales (Lucía) en lugar de simularlos.
        setGastos(generarGastosSimulados(resultado.itinerarios, presupuestoDiario));
        setDiaActivo(0);
        setVotos({});
        setFase("listo");
      })
      .catch((err) => {
        if (cancelado()) return;

        setError(
          err instanceof Error
            ? err.message
            : "No se pudo generar el itinerario."
        );
        setFase("error");
      });

    return () => controlador.abort();
  }, [intento]);

  // Pronóstico del clima: una sola consulta para todas las fechas del itinerario
  useEffect(() => {
    if (!itinerarios || itinerarios.length === 0) {
      return;
    }

    const coordenadas = coordenadasDelViaje(viaje, itinerarios);
    if (!coordenadas) {
      setPronostico(null);
      setEstadoPronostico("sin_datos");
      return;
    }

    const controller = new AbortController();
    setPronostico(null);
    setEstadoPronostico("cargando");

    consultarPronostico(
      {
        ...coordenadas,
        fechaInicio: itinerarios[0].fecha,
        fechaFin: itinerarios[itinerarios.length - 1].fecha,
      },
      controller.signal
    ).then((resultado) => {
      if (controller.signal.aborted) return;

      setPronostico(resultado);
      setEstadoPronostico(resultado ? "listo" : "sin_datos");
    });

    return () => controller.abort();
  }, [itinerarios]);

  function regenerar() {
    setInicioSeguimiento(null);
    setItinerarios(null);
    setIntento((n) => n + 1);
  }

  // Votación
  function votar(id: string, voto: Voto) {
    setVotos((prev) => {
      const siguiente = { ...prev };

      if (prev[id] === voto) {
        delete siguiente[id];
      } else {
        siguiente[id] = voto;
      }

      return siguiente;
    });
  }

  function marcarVisitada(diaId: string, paradaId: string) {
    setParadasVisitadas((actuales) => ({
      ...actuales,
      [diaId]: [...new Set([...(actuales[diaId] ?? []), paradaId])],
    }));
  }

  // Copiar enlace
  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado("Enlace copiado.");
    } catch {
      enlaceRef.current?.select();
      setCopiado("Presiona Ctrl+C para copiar el enlace.");
    }

    setTimeout(() => setCopiado(""), 2500);
  }

  // Datos del día activo
  const dia = itinerarios?.[diaActivo];

  // Clima de este momento, solo si el día que se está viendo es hoy. Se refresca cada 15 minutos.
  const [climaAhora, setClimaAhora] = useState<ClimaAhora | null>(null);
  const esHoy = dia?.fecha === fechaLocal(new Date(tiempoActual));
  const tramoDe15Minutos = Math.floor(tiempoActual / (15 * 60_000));
  useEffect(() => {
    const coordenadas = esHoy && itinerarios ? coordenadasDelViaje(viaje, itinerarios) : null;
    if (!coordenadas) {
      setClimaAhora(null);
      return;
    }
    const controlador = new AbortController();
    consultarClimaActual(coordenadas, controlador.signal).then((resultado) => {
      if (!controlador.signal.aborted) setClimaAhora(resultado);
    });
    return () => controlador.abort();
  }, [esHoy, itinerarios, viaje.lat, viaje.lng, tramoDe15Minutos]);

  useEffect(() => {
    if (!dia || reoptimizando || estadoPronostico !== "listo") return;
    const climaDia = pronostico?.dias.find((d) => d.fecha === dia.fecha);
    if (!climaDia || !hayLluviaSignificativa(climaDia)) return;
    const clave = `${dia.id}:${dia.fecha}`;
    if (diasClimaAplicados.current.has(clave)) return;
    diasClimaAplicados.current.add(clave);
    void solicitarReoptimizacion("clima", undefined, 100);
  }, [dia, estadoPronostico, pronostico, reoptimizando]);

  // GUI-89: tomar el tiempo real del itinerario cuando existe.
  // Si no viene informado, reutilizar la misma estimación visual de GUI-34.
  // Cada parada guarda el traslado desde la anterior: el primer tramo es el de la segunda parada.
  const tiempoTrasladoActual = dia?.paradas.length && dia.paradas.length > 1
    ? obtenerTiempoTraslado(dia.paradas[1], 1, viaje.transporte)
    : null;
  const trasladoDisponible = tiempoTrasladoActual !== null;
  const trasladoEstimado = tiempoTrasladoActual?.estimado ?? false;

  const idsParadasCompletadas = useMemo(
    () => dia
      ? dia.paradas
        .filter((parada) => visitadas[parada.id] || Boolean(calificaciones[parada.id]) || paradasVisitadas[dia.id]?.includes(parada.id))
        .map((parada) => parada.id)
      : [],
    [dia?.id, dia?.paradas, visitadas, calificaciones, paradasVisitadas]
  );

  // GUI-72: estado del día que se envía al monitoreo del clima.
  const itinerarioActivo = useMemo(
    () => (dia ? construirItinerarioActivo(dia, { completadas: new Set(idsParadasCompletadas), descartadas: new Set() }) : null),
    [dia, idsParadasCompletadas]
  );
  const itinerarioActivoRef = useRef(itinerarioActivo);
  itinerarioActivoRef.current = itinerarioActivo;
  const monitoreo = useMonitoreoClima({
    itinerario: itinerarioActivo,
    modoTransporte: modoTransporteRuta(viaje.transporte),
    intereses: viaje.intereses ?? [],
  });
  const [aplicandoClima, setAplicandoClima] = useState(false);

  async function aceptarPropuestaDeClima() {
    if (aplicandoClima) return;
    setAplicandoClima(true);
    try {
      const { respuesta, firmaEnviada } = await monitoreo.aceptarPropuesta();
      const actual = itinerarioActivoRef.current;
      // Si el usuario marcó o canceló paradas mientras se aplicaba, no se sobrescribe su itinerario.
      if (!actual || actual.id !== respuesta.itinerarioId || firmaItinerario(actual) !== firmaEnviada) {
        setAvisoReoptimizacion("El itinerario cambió mientras se aplicaba la propuesta y no se modificó. Revisa el clima de nuevo.");
        return;
      }
      const estado = {
        completadas: new Set(actual.paradas.filter((p) => p.estado === "completada").map((p) => p.id)),
        descartadas: new Set(actual.paradas.filter((p) => p.estado === "cancelada").map((p) => p.id)),
      };
      setItinerarios((actuales) => actuales?.map((it) =>
        it.id === respuesta.itinerarioId
          ? { ...it, paradas: aplicarParadasPropuestas(it.paradas, estado, respuesta.paradasPendientes) }
          : it
      ) ?? null);
      setEtaMapa(null);
      monitoreo.descartarPropuesta();
      setAvisoReoptimizacion(respuesta.yaAplicada
        ? "El plan ya incluía esta propuesta."
        : "El plan se actualizó con las alternativas techadas propuestas por el clima.");
    } catch (err) {
      setAvisoReoptimizacion(err instanceof Error ? err.message : "No se pudo aplicar la propuesta.");
    } finally {
      setAplicandoClima(false);
    }
  }

  // GUI-73: modo «Abierto ahora». Su estado está separado del itinerario y nunca lo modifica.
  const [filtroAbiertos, setFiltroAbiertos] = useState<FiltroAbiertos>("turisticos");
  const interesesViaje = viaje.intereses ?? [];
  const abiertos = useAbiertosAhora(filtroAbiertos === "intereses" ? interesesViaje : []);
  const [abiertoSeleccionado, setAbiertoSeleccionado] = useState<string | null>(null);
  const estadoAbiertos = abiertos.estado;
  const lugaresAbiertosMapa = useMemo(
    () => (estadoAbiertos.fase === "listo" ? lugaresParaMapa(estadoAbiertos.respuesta.lugares) : []),
    [estadoAbiertos]
  );
  const referenciaAbiertos = useMemo(
    () => estadoAbiertos.fase === "listo"
      ? { lat: estadoAbiertos.referencia.lat, lng: estadoAbiertos.referencia.lng, etiqueta: describirReferencia(estadoAbiertos.referencia) }
      : null,
    [estadoAbiertos]
  );
  useEffect(() => {
    setAbiertoSeleccionado((actual) => (actual && lugaresAbiertosMapa.some((l) => l.idExterno === actual) ? actual : null));
  }, [lugaresAbiertosMapa]);
  const capaAbiertos: CapaAbiertosAhora | null = estadoAbiertos.fase === "listo"
    ? { lugares: lugaresAbiertosMapa, referencia: referenciaAbiertos, seleccionadoId: abiertoSeleccionado, onSeleccionar: setAbiertoSeleccionado }
    : null;
  const puntosReferencia = (dia?.paradas ?? [])
    .filter((p) => coordenadasValidas(p.lat, p.lng))
    .map((p) => ({ id: p.id, nombre: p.nombre, lat: p.lat, lng: p.lng }));

  const mostrarHoteles =
    viaje.hospedaje === false && !viaje.sinHotel;

  // GUI-33: horarios calculados
  // Si el generador proporciona horarios programados,
  // se utilizan esos valores.
  const horariosCalculados = dia
    ? calcularHorarios(dia.paradas)
    : [];

  const horarios = dia
    ? dia.paradas.map((parada, i) => {
        const p = parada as ParadaConHorario;

        return {
          inicio:
            p.horaInicioProgramada ??
            horariosCalculados[i]?.inicio ??
            p.horaApertura,
          fin:
            p.horaFinProgramada ??
            horariosCalculados[i]?.fin ??
            p.horaApertura,
        };
      })
    : [];

  // GUI-38: alertas reales de ajuste o descarte
  const alertasHorario = dia
    ? dia.paradas.map((parada) =>
        obtenerAlertaHorario(parada as ParadaConHorario)
      )
    : [];
  return (
    <div className="card">
      <Stepper actual={4} />

      {/* GENERANDO */}
      {fase === "generando" && (
        <>
          <h2>Generando tu itinerario</h2>

          <p>
            Estamos armando el plan para{" "}
            <b>{viaje.destino}</b>. Esto toma unos segundos.
          </p>

          <ol className="proceso" aria-live="polite">
            {PASOS_GENERACION.map((texto, i) => (
              <li
                key={texto}
                className={
                  i < progreso
                    ? "hecho"
                    : i === progreso
                    ? "activo"
                    : ""
                }
              >
                {texto}
              </li>
            ))}
          </ol>

          <div
            className="stepper-bar"
            role="progressbar"
            aria-label="Progreso de la generación"
            aria-valuemin={0}
            aria-valuemax={PASOS_GENERACION.length}
            aria-valuenow={progreso}
          >
            <div
              className="stepper-fill"
              style={{
                width: `${
                  (progreso / PASOS_GENERACION.length) * 100
                }%`,
              }}
            />
          </div>
        </>
      )}

      {/* ERROR */}
      {fase === "error" && (
        <>
          <h2>No pudimos generar el itinerario</h2>

          <p className="aviso-error" role="alert">
            {error}
          </p>

          <div className="acciones">
            <button
              type="button"
              className="btn-secundario"
              onClick={() => irAPaso(3)}
            >
              Atrás
            </button>

            <button
              type="button"
              className="btn-primario"
              onClick={regenerar}
            >
              Reintentar
            </button>
          </div>
        </>
      )}

      {/* ITINERARIO GENERADO */}
      {fase === "listo" && itinerarios && dia && (
        <>
          <h2>Tu itinerario para {viaje.destino}</h2>

          {advertencias.map((texto) => (
            <p key={texto} className="nota">{texto}</p>
          ))}

          {avisoReoptimizacion && (
            <p className={reoptimizando || avisoReoptimizacion.startsWith("El plan") ? "aviso-plan-actualizado" : "aviso-error"} role="status" aria-live="polite">
              {reoptimizando ? "Actualizando el plan…" : avisoReoptimizacion}
            </p>
          )}

          <ul className="datos">
            <li className="dato">
              {dias} {dias === 1 ? "día" : "días"}
            </li>

            {viaje.tipoViaje && (
              <li className="dato">
                {TIPOS[viaje.tipoViaje]}
              </li>
            )}

            {viaje.presupuesto !== undefined && (
              <li className="dato">
                {MONEDA}{" "}
                {viaje.presupuesto.toLocaleString("es-GT")}{" "}
                en total
              </li>
            )}

            {viaje.transporte && (
              <li className="dato">
                {viaje.transporte}
              </li>
            )}
          </ul>

          {/* Hospedaje */}
          {!viaje.sinHotel && (
            <p className="nota">
              {viaje.hospedaje
                ? `Cada día sale desde: ${viaje.nombreHotel}.`
                : "Hospedaje: te sugeriremos opciones cerca de este itinerario."}
            </p>
          )}

          {/* Selector de días */}
          <div
            className="dias"
            role="tablist"
            aria-label="Días del viaje"
          >
            {itinerarios.map((it, i) => (
              <button
                key={it.id}
                type="button"
                role="tab"
                id={`tab-${it.id}`}
                aria-selected={i === diaActivo}
                aria-controls="panel-dia"
                className="dia"
                onClick={() => { setDiaActivo(i); setInicioSeguimiento(null); setEtaMapa(null); }}
              >
                Día {it.numeroDia} · {fechaCorta(it.fecha)}
              </button>
            ))}
          </div>

          {/* Clima del día */}
          <section aria-label={`Clima del día ${dia.numeroDia}`}>
            <IndicadorClima
              estado={estadoPronostico}
              dia={pronostico?.dias.find((d) => d.fecha === dia.fecha)}
              ahora={esHoy ? climaAhora : null}
            />
          </section>
          {monitoreo.activo || monitoreo.propuesta ? (
            <PropuestaClima
              estado={monitoreo.estado}
              nivel={monitoreo.evaluacion?.evaluacion?.nivel ?? null}
              senal={monitoreo.evaluacion?.evaluacion?.senalPrincipal ?? null}
              consultadoEn={monitoreo.evaluacion?.evaluacion?.consultadoEn ?? null}
              mensajeEvaluacion={monitoreo.evaluacion?.mensaje ?? null}
              error={monitoreo.error}
              proximaRevision={monitoreo.proximaRevision}
              estadoUbicacion={monitoreo.estadoUbicacion}
              propuesta={monitoreo.propuesta}
              obsoleta={monitoreo.propuestaObsoleta}
              aplicando={aplicandoClima}
              onVerificar={() => void monitoreo.verificar()}
              onCompartirUbicacion={monitoreo.compartirUbicacion}
              onDejarDeCompartir={monitoreo.dejarDeCompartir}
              onAceptar={() => void aceptarPropuestaDeClima()}
              onRechazar={monitoreo.descartarPropuesta}
            />
          ) : (
            <p className="nota">El monitoreo del clima durante el recorrido se activa el día del itinerario mientras queden paradas pendientes.</p>
          )}
          <div className="acciones-ruta">
            <button type="button" className="btn-secundario" disabled={reoptimizando || dia.paradas.length === 0}
              onClick={() => void solicitarReoptimizacion("retraso")}>
              {reoptimizando ? "Actualizando ruta…" : "Reportar retraso y recalcular"}
            </button>
          </div>

          {/* Presupuesto del día */}
          <PanelPresupuesto
            numeroDia={dia.numeroDia}
            presupuestoDiario={presupuestoDiario}
            gastosDelDia={gastos.filter((g) => g.numeroDia === dia.numeroDia)}
            totalGastadoViaje={gastos.reduce((s, g) => s + g.monto, 0)}
            presupuestoTotal={viaje.presupuesto}
            onAgregar={agregarGasto}
            onEliminar={eliminarGasto}
          />

          {/* GUI-73: botón «Abierto ahora» */}
          <BarraAbiertosAhora
            estado={estadoAbiertos}
            filtro={filtroAbiertos}
            interesesViaje={interesesViaje}
            puntos={puntosReferencia}
            onAlternar={abiertos.alternar}
            onCambiarFiltro={setFiltroAbiertos}
            onActualizarUbicacion={abiertos.actualizarUbicacion}
            onUsarPunto={(p) => abiertos.usarPuntoManual({ lat: p.lat, lng: p.lng, etiqueta: `la parada ${p.nombre}` })}
            onReintentar={abiertos.reintentar}
          />

          {/* Mapa */}
          <div
            className="mapa-dia"
            role="region"
            aria-label={`Mapa de las paradas del día ${dia.numeroDia}`}
          >
            <MapaSeguro
              paradas={dia.paradas}
              paradasCompletadas={idsParadasCompletadas}
              pronostico={pronostico?.dias.find((d) => d.fecha === dia.fecha)}
              eta={etaMapa}
              abiertos={capaAbiertos}
            />
          </div>
          <div className="leyenda-ruta" aria-label="Leyenda del progreso de la ruta">
            <span><i className="leyenda-ruta-completada" /> Recorrido completado</span>
            <span><i className="leyenda-ruta-pendiente" /> Recorrido pendiente</span>
            {capaAbiertos && capaAbiertos.lugares.length > 0 && <span><i className="leyenda-abierto" /> Abierto ahora</span>}
          </div>

          <ResultadosAbiertosAhora
            estado={estadoAbiertos}
            seleccionadoId={abiertoSeleccionado}
            onSeleccionar={setAbiertoSeleccionado}
          />

          {/* Telemetría GPS del recorrido */}
          <PanelTelemetria />

          {/* GUI-89: seguimiento manual del traslado y recálculo de ETA */}
          {dia.paradas.length > 1 && (
            <section aria-label="Seguimiento del traslado">
              <button
                type="button"
                className="btn-secundario"
                onClick={() => {
                  setInicioSeguimiento(Date.now());
                  setTiempoActual(Date.now());
                }}
              >
                {inicioSeguimiento === null ? "Iniciar traslado" : "Reiniciar traslado"}
              </button>

              {inicioSeguimiento === null ? (
                <p className="nota">Inicia el traslado para calcular el tiempo transcurrido.</p>
              ) : !trasladoDisponible ? (
                <p className="nota">
                  No hay un tiempo de traslado previsto válido para calcular la ETA.
                </p>
              ) : (
                <>
                {trasladoEstimado && (
                  <p className="nota">
                    ETA aproximada: el itinerario no proporcionó un tiempo de traslado real.
                    Se utiliza la estimación que aparece en «Traslado y margen de seguridad».
                  </p>
                )}
                <PanelEta
                  key={dia.id}
                  onResultado={setEtaMapa}
                  solicitud={{
                    horaActual: new Date(tiempoActual).toISOString(),
                    tiempoTranscurridoMinutos: Math.max(
                      0,
                      Math.floor((tiempoActual - inicioSeguimiento) / 60_000)
                    ),
                    tiempoTrasladoPrevistoMinutos: tiempoTrasladoActual!.minutos,
                    // La primera ETA corresponde a la segunda parada.
                    // Los siguientes tramos incluyen traslado desde la parada anterior.
                    tramos: dia.paradas.slice(1).map((parada, indice) => {
                      const traslado = indice > 0
                        ? obtenerTiempoTraslado(parada, indice + 1, viaje.transporte)
                        : null;
                      return {
                        paradaId: parada.id,
                        tiempoTrasladoMinutos: indice === 0 ? 0 : traslado?.minutos ?? 0,
                        tiempoEstanciaMinutos: parada.tiempoEstanciaMinutos,
                      };
                    }),
                  }}
                />
                </>
              )}
            </section>
          )}


          {/* Paradas */}
          <ol
            className="paradas"
            id="panel-dia"
            role="tabpanel"
            aria-labelledby={`tab-${dia.id}`}
          >
            {dia.paradas.map((p, i) => {
              const voto = votos[p.id];
              const paradaHorario = p as ParadaConHorario;
              const alerta = alertasHorario[i];
              const descartada =
                paradaHorario.estadoHorario === "descartada";
              const visitada = paradasVisitadas[dia.id]?.includes(p.id) ?? false;

              return (
                <div key={p.id || i}>
                  <li className={`parada${visitadas[p.id] || calificaciones[p.id] ? " visitada" : ""}`}>
                    {/* Hora */}
                    <div className="hora">
                      {descartada
                        ? "Sin visita"
                        : horarios[i]?.inicio}

                      <small>
                        {descartada
                          ? "Descartada"
                          : `a ${horarios[i]?.fin}`}
                      </small>
                    </div>

                    {/* Información del lugar */}
                    <div>
                      <h3>
                        {p.nombre}
                        {(visitadas[p.id] || calificaciones[p.id]) && (
                          <span className="sello-visitada">Visitada</span>
                        )}
                      </h3>

                      <p>
                        Abre {p.horaApertura} ·
                        Cierra {p.horaCierre}
                        {paradaHorario.horarioEstimado && " (horario estimado)"} ·
                        Estancia{" "}
                        {p.tiempoEstanciaMinutos} min
                      </p>

                      {paradaHorario.motivo && <p className="nota">{paradaHorario.motivo}</p>}

                      {!descartada && !visitada && (
                        <button type="button" className="accion-parada" onClick={() => marcarVisitada(dia.id, p.id)}>
                          Marcar como visitada
                        </button>
                      )}

                      {!descartada && !visitada && (
                        <button type="button" className="accion-parada" disabled={reoptimizando}
                          onClick={() => void solicitarReoptimizacion("parada_cancelada", p.id)}>
                          Cancelar parada y recalcular
                        </button>
                      )}
                      {visitada && <p className="estado-parada-visitada">Visita completada</p>}

                      {/* GUI-38: alerta de horario */}
                      {alerta && (
                        <AlertaHorario
                          nombreLugar={p.nombre}
                          estado={alerta.estado}
                          mensaje={alerta.mensaje}
                        />
                      )}

                      {/* Calificación post-actividad */}
                      {!descartada && (
                        <div className="visita-acciones">
                          {calificando === p.id ? (
                            <CalificacionParada
                              paradaId={p.id}
                              nombre={p.nombre}
                              inicial={calificaciones[p.id]}
                              onCancelar={() => setCalificando(null)}
                              onGuardar={(c) => {
                                guardarCalificacion(c);
                                setVisitadas((v) => ({ ...v, [p.id]: true }));
                                setCalificando(null);
                              }}
                            />
                          ) : calificaciones[p.id] ? (
                            <ResumenCalificacion
                              c={calificaciones[p.id]}
                              onEditar={() => setCalificando(p.id)}
                            />
                          ) : (
                            <button
                              type="button"
                              className="btn-visita"
                              onClick={() => setCalificando(p.id)}
                            >
                              Ya visité este lugar · Calificar
                            </button>
                          )}
                        </div>
                      )}

                      {/* Votaciones */}
                      {esGrupo && !descartada && (
                        <div className="votos">
                          <button
                            type="button"
                            className="voto favor"
                            aria-pressed={voto === "favor"}
                            onClick={() =>
                              votar(p.id, "favor")
                            }
                          >
                            A favor (
                            {voto === "favor" ? 1 : 0})
                          </button>

                          <button
                            type="button"
                            className="voto contra"
                            aria-pressed={voto === "contra"}
                            onClick={() =>
                              votar(p.id, "contra")
                            }
                          >
                            En contra (
                            {voto === "contra" ? 1 : 0})
                          </button>
                        </div>
                      )}
                    </div>
                  </li>

                  {/* GUI-34: Traslado y margen de seguridad */}
                  {i < dia.paradas.length - 1 &&
                    !descartada &&
                    (() => {
                      // El tramo hacia la siguiente parada está guardado en esa parada.
                      const siguiente = dia.paradas[i + 1];
                      const h =
                        (siguiente as any).holgura ||
                        (siguiente as any).desgloseHolgura ||
                        (siguiente as any).traslado?.holgura;

                      const desglose = h?.desgloseHolgura;

                      const tipoDetectado = String(
                        h?.tipoTraslado ||
                          (siguiente as any).tipoTraslado ||
                          viaje.transporte ||
                          ""
                      ).toLowerCase();

                      let modoKey = "auto";

                      if (
                        tipoDetectado.includes("pie") ||
                        tipoDetectado.includes("camin")
                      ) {
                        modoKey = "pie";
                      } else if (
                        tipoDetectado.includes("bus") ||
                        tipoDetectado.includes("colectivo")
                      ) {
                        modoKey = "bus";
                      } else if (
                        tipoDetectado.includes("moto")
                      ) {
                        modoKey = "moto";
                      } else if (
                        tipoDetectado.includes("aereo") ||
                        tipoDetectado.includes("avion") ||
                        tipoDetectado.includes("vuelo")
                      ) {
                        modoKey = "aereo";
                      }

                      const configTransporte =
                        TRANSPORTE_CONFIG[modoKey] ||
                        TRANSPORTE_CONFIG.auto;

                      const semillaId = siguiente.id
                        ? siguiente.id
                            .split("")
                            .reduce(
                              (
                                acc: number,
                                char: string
                              ) =>
                                acc + char.charCodeAt(0),
                              0
                            )
                        : 0;

                      const tiemposPorTipo: Record<
                        string,
                        number[]
                      > = {
                        pie: [10, 15, 8, 12, 20],
                        moto: [12, 18, 15, 22, 10],
                        auto: [15, 25, 18, 30, 20],
                        bus: [20, 35, 25, 40, 30],
                        aereo: [45, 60, 50, 90, 75],
                      };

                      const listaTiempos =
                        tiemposPorTipo[modoKey] ||
                        tiemposPorTipo.auto;

                      const baseSugerida =
                        listaTiempos[
                          (i + semillaId) %
                            listaTiempos.length
                        ];

                      const tiempoBase =
                        h?.tiempoBaseMinutos ??
                        (siguiente as any).tiempoTrasladoMinutos ??
                        obtenerTiempoTraslado(siguiente, i + 1, viaje.transporte)?.minutos ??
                        baseSugerida;

                      const tiempoAdicionalDefault =
                        modoKey === "aereo"
                          ? 60
                          : modoKey === "bus"
                          ? 15
                          : modoKey === "pie"
                          ? 5
                          : modoKey === "moto"
                          ? 8
                          : 10;

                      const margenEstandar =
                        desglose?.margenEstandar ?? 10;

                      const estacionamiento =
                        desglose
                          ?.estacionamientoOAdicional ??
                        tiempoAdicionalDefault;

                      const imprevistos =
                        desglose?.imprevistos ??
                        Math.round(tiempoBase * 0.1);

                      const totalRecomendado =
                        h?.tiempoTotalConHolgura ??
                        tiempoBase +
                          margenEstandar +
                          estacionamiento +
                          imprevistos;

                      return (
                        <div className="bloque-traslado-holgura">
                          <div className="tarjeta-holgura">
                            <div className="encabezado-holgura">
                              TRASLADO Y MARGEN DE SEGURIDAD
                            </div>

                            <ul className="desglose-lista">
                              <li>
                                <span>
                                  Tiempo base de traslado
                                </span>
                                <strong>
                                  {tiempoBase} min
                                </strong>
                              </li>

                              <li>
                                <span>
                                  Margen estándar
                                </span>
                                <strong>
                                  +{margenEstandar} min
                                </strong>
                              </li>

                              <li>
                                <span>
                                  {
                                    configTransporte.etiquetaEstacionamiento
                                  }
                                </span>
                                <strong>
                                  +{estacionamiento} min
                                </strong>
                              </li>

                              <li>
                                <span>
                                  Imprevistos / Tráfico
                                </span>
                                <strong>
                                  +{imprevistos} min
                                </strong>
                              </li>

                              <li>
                                <span>
                                  <strong>
                                    Tiempo total recomendado
                                  </strong>
                                </span>
                                <strong>
                                  {totalRecomendado} min
                                </strong>
                              </li>
                            </ul>
                          </div>
                        </div>
                      );
                    })()}
                </div>
              );
            })}
          </ol>

          {/* Recomendaciones */}
          <Recomendaciones
            viaje={viaje}
            itinerarios={itinerarios}
            dia={dia}
            mostrarHoteles={mostrarHoteles}
          />

          {/* Votación grupal */}
          {esGrupo && (
            <section
              className="votacion"
              aria-labelledby="t-votacion"
            >
              <h3
                id="t-votacion"
                style={{
                  margin: 0,
                  font: "700 1rem var(--font-ui)",
                  textTransform: "uppercase",
                  letterSpacing: ".1em",
                }}
              >
                Votación del grupo
              </h3>

              <p className="nota">
                Comparte este enlace para que tu grupo
                vote las paradas.
              </p>

              <div className="enlace-grupo">
                <input
                  ref={enlaceRef}
                  type="text"
                  readOnly
                  value={enlace}
                  aria-label="Enlace para invitar al grupo"
                  onFocus={(e) =>
                    e.currentTarget.select()
                  }
                />

                <button
                  type="button"
                  className="btn-secundario"
                  onClick={copiar}
                >
                  Copiar
                </button>
              </div>

              <p className="nota" role="status">
                {copiado ||
                  "Vista previa: por ahora solo cuenta tu voto en este dispositivo."}
              </p>
            </section>
          )}

          {/* Acciones finales */}
   {/* Notificación de guardado */}
          {notificacionGuardado && (
            <p
              className={
                notificacionGuardado.tipo === "exito"
                  ? "aviso-plan-actualizado"
                  : notificacionGuardado.tipo === "local"
                  ? "nota"
                  : "aviso-error"
              }
              role="status"
              aria-live="polite"
            >
              {notificacionGuardado.texto}
            </p>
          )}

          {/* Acciones finales */}
          <div className="acciones">
            <button
              type="button"
              className="btn-secundario"
              onClick={() => irAPaso(3)}
            >
              Atrás
            </button>

            <button
              type="button"
              className="btn-secundario"
              onClick={regenerar}
            >
              Regenerar
            </button>

            <button
           type="button"
           className="btn-secundario"
           disabled={exportando}
           onClick={manejarExportarPlan}
         >
           {exportando ? "Exportando..." : "⬇ Exportar"}
         </button>

            <button
              type="button"
              className="btn-primario"
              disabled={guardando}
              onClick={manejarGuardarPlan}
            >
              {guardando
                ? "Guardando..."
                : idGuardado
                ? "✓ Plan guardado"
                : "Guardar plan"}
            </button>
          </div>

          <button
            type="button"
            className="enlace"
            onClick={reiniciar}
          >
            Empezar un viaje nuevo
          </button>
        </>
      )}
    </div>
  );
}
