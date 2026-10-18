import { useEffect, useMemo, useRef, useState } from "react";
import { useViaje } from "../context/ViajeContext";
import Stepper from "../components/Stepper";
import Recomendaciones from "../components/Recomendaciones";
import { MapaSeguro } from "../components/MapaSeguro";
import IndicadorClima, { type EstadoPronostico } from "../components/IndicadorClima";
import AlertaHorario from "../components/AlertaHorario";
import type { RespuestaClima } from "../../../shared/types";
import { consultarPronostico, coordenadasDelViaje, hayLluviaSignificativa } from "../services/clima";
import { reoptimizarRuta, type TipoEventoRuta } from "../services/reoptimizacion";

import {
  generarItinerario,
  PASOS_GENERACION,
} from "../services/itinerario";
import type { ParadaConHorario } from "../services/itinerario";

import { construirRecomendaciones } from "../services/recomendaciones";
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
    irAPaso,
    reiniciar,
  } = useViaje();

  // Estados
  const [fase, setFase] = useState<Fase>(
    itinerarios ? "listo" : "generando"
  );
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState("");
  const [intento, setIntento] = useState(0);
  const [diaActivo, setDiaActivo] = useState(0);
  const [votos, setVotos] = useState<Record<string, Voto>>({});
  const [copiado, setCopiado] = useState("");
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
  const dias = diasDeViaje(viaje.fechaInicio, viaje.fechaFin);
  const enlace = `https://guiaturistica.example/votar/${codigo}`;

  async function solicitarReoptimizacion(tipo: TipoEventoRuta, paradaCanceladaId?: string, probabilidadLluvia?: number) {
    const diaSolicitado = itinerarios?.[diaActivo];
    if (!diaSolicitado || reoptimizando) return;
    const visitadas = new Set(paradasVisitadas[diaSolicitado.id] ?? []);
    const paradasPendientes = diaSolicitado.paradas.filter((p) =>
      !visitadas.has(p.id) && (p as ParadaConHorario).estadoHorario !== "descartada"
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
      });
      const paradas = [
        ...diaSolicitado.paradas.filter((p) => visitadas.has(p.id)),
        ...paradasReoptimizadas,
      ];
      setItinerarios((actuales) => actuales?.map((it) =>
        it.id === diaSolicitado.id ? { ...it, paradas } : it
      ) ?? null);
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

    let cancelado = false;

    setFase("generando");
    setProgreso(0);
    setError("");

    generarItinerario(viaje, (n) => {
      if (!cancelado) {
        setProgreso(n);
      }
    })
      .then((resultado) => {
        if (cancelado) return;

        setItinerarios(resultado);
        setDiaActivo(0);
        setVotos({});
        setFase("listo");
      })
      .catch((err) => {
        if (cancelado) return;

        setError(
          err instanceof Error
            ? err.message
            : "No se pudo generar el itinerario."
        );
        setFase("error");
      });

    return () => {
      cancelado = true;
    };
  }, [intento]);

  // Pronóstico de OpenWeather: una sola consulta para todas las fechas del itinerario
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

  useEffect(() => {
    if (!dia || reoptimizando || estadoPronostico !== "listo") return;
    const climaDia = pronostico?.dias.find((d) => d.fecha === dia.fecha);
    if (!climaDia || !hayLluviaSignificativa(climaDia)) return;
    const clave = `${dia.id}:${dia.fecha}`;
    if (diasClimaAplicados.current.has(clave)) return;
    diasClimaAplicados.current.add(clave);
    void solicitarReoptimizacion("clima", undefined, 100);
  }, [dia, estadoPronostico, pronostico, reoptimizando]);

  const lugares = useMemo(
    () =>
      itinerarios
        ? construirRecomendaciones(viaje, itinerarios)
        : [],
    [itinerarios]
  );

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
                onClick={() => setDiaActivo(i)}
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
            />
          </section>
          <div className="acciones-ruta">
            <button type="button" className="btn-secundario" disabled={reoptimizando || dia.paradas.length === 0}
              onClick={() => void solicitarReoptimizacion("retraso")}>
              {reoptimizando ? "Actualizando ruta…" : "Reportar retraso y recalcular"}
            </button>
          </div>

          {/* Mapa */}
          <div
            className="mapa-dia"
            role="region"
            aria-label={`Mapa de las paradas del día ${dia.numeroDia}`}
          >
            <MapaSeguro paradas={dia.paradas} />
          </div>

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
                  <li className="parada">
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
                      <h3>{p.nombre}</h3>

                      <p>
                        Abre {p.horaApertura} ·
                        Cierra {p.horaCierre} ·
                        Estancia{" "}
                        {p.tiempoEstanciaMinutos} min
                      </p>

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
                      const h =
                        (p as any).holgura ||
                        (p as any).desgloseHolgura ||
                        (p as any).traslado?.holgura;

                      const desglose = h?.desgloseHolgura;

                      const tipoDetectado = String(
                        h?.tipoTraslado ||
                          (p as any).tipoTraslado ||
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

                      const semillaId = p.id
                        ? p.id
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
                        (p as any)
                          .tiempoTrasladoMinutos ??
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
            lugares={lugares}
            presupuestoDiario={viaje.presupuestoDiario}
            mostrarHoteles={mostrarHoteles}
            dia={dia.numeroDia}
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
              Regenerar
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
