import { useState } from "react";
import type { NivelRiesgoClima, PropuestaClima as Propuesta, ResumenRutaClima, SenalClima } from "../../../shared/types";
import type { EstadoMonitoreoClima, EstadoUbicacion } from "../hooks/useMonitoreoClima";

const NIVEL: Record<NivelRiesgoClima, string> = {
  favorable: "Condiciones favorables",
  lluvia_ligera: "Lluvia ligera",
  riesgo_elevado: "Riesgo alto de lluvia",
  lluvia_significativa: "Lluvia significativa",
  tormenta: "Tormenta eléctrica",
};

const DISPONIBILIDAD = {
  confirmada: "Horario confirmado",
  horario_no_confirmado: "Horario no confirmado",
  cerrada_en_el_horario: "Cerrado en el horario disponible",
} as const;

const hora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" }) : "—";

function describirSenal(senal: SenalClima | null) {
  if (!senal) return "Sin señales de riesgo.";
  const origen = senal.origen === "observado" ? "Observado ahora" : `Pronosticado de ${hora(senal.desde)} a ${hora(senal.hasta)}`;
  const probabilidad = senal.probabilidadPrecipitacion === null ? "" : ` · ${Math.round(senal.probabilidadPrecipitacion * 100)} % de probabilidad`;
  const lluvia = senal.lluviaMm === null ? "" : ` · ${senal.lluviaMm} mm en ${senal.periodoLluviaHoras} h`;
  return `${origen}${senal.descripcion ? ` · ${senal.descripcion}` : ""}${probabilidad}${lluvia}`;
}

function Ruta({ titulo, ruta }: { titulo: string; ruta: ResumenRutaClima | null }) {
  if (!ruta) return null;
  return (
    <div className="propuesta-clima-ruta">
      <h4>{titulo}</h4>
      <ol>
        {ruta.visitas.length > 0
          ? ruta.visitas.map((v) => (
              <li key={v.paradaId} className={`visita-${v.tipo}`}>
                {v.inicio}–{v.fin} · {v.nombre}
                {v.tipo === "sustituta" && " (alternativa techada)"}
                {v.tipo === "afectada_sin_alternativa" && " (expuesta al clima)"}
              </li>
            ))
          : ruta.orden.map((id) => <li key={id}>{id}</li>)}
      </ol>
      <p className="nota">
        {ruta.trasladoMinutos === null ? "Traslado no calculado" : `Traslado: ${ruta.trasladoMinutos} min`} ·{" "}
        {ruta.distanciaKm === null ? "distancia no calculada" : `${ruta.distanciaKm} km`}
        {!ruta.viable && " · no respeta todos los horarios"}
      </p>
    </div>
  );
}

export default function PropuestaClima({
  estado,
  nivel,
  senal,
  consultadoEn,
  mensajeEvaluacion,
  error,
  proximaRevision,
  estadoUbicacion,
  propuesta,
  obsoleta,
  aplicando,
  onVerificar,
  onCompartirUbicacion,
  onDejarDeCompartir,
  onAceptar,
  onRechazar,
}: {
  estado: EstadoMonitoreoClima;
  nivel: NivelRiesgoClima | null;
  senal: SenalClima | null;
  consultadoEn: string | null;
  mensajeEvaluacion: string | null;
  error: string | null;
  proximaRevision: Date | null;
  estadoUbicacion: EstadoUbicacion;
  propuesta: Propuesta | null;
  obsoleta: boolean;
  aplicando: boolean;
  onVerificar: () => void;
  onCompartirUbicacion: () => void;
  onDejarDeCompartir: () => void;
  onAceptar: () => void;
  onRechazar: () => void;
}) {
  const [verAlternativas, setVerAlternativas] = useState(false);
  const aplicable = propuesta?.estado === "pendiente" && propuesta.token !== null && !obsoleta;

  return (
    <section className="propuesta-clima" aria-label="Monitoreo del clima durante el recorrido">
      <p className="nota" role="status" aria-live="polite">
        Monitoreo del clima (OpenWeather):{" "}
        {estado === "evaluando" ? "revisando…" : nivel ? NIVEL[nivel] : "sin datos"}
        {consultadoEn && ` · consultado a las ${hora(consultadoEn)}`}
        {proximaRevision && estado !== "evaluando" && ` · próxima revisión ${hora(proximaRevision.toISOString())}`}
      </p>
      {mensajeEvaluacion && !propuesta && <p className="nota">{mensajeEvaluacion}</p>}
      {error && <p className="aviso-error" role="alert">{error}</p>}
      <div className="propuesta-clima-acciones">
        <button type="button" className="accion-parada" disabled={estado === "evaluando"} onClick={onVerificar}>
          Revisar el clima ahora
        </button>
        {estadoUbicacion === "compartida" ? (
          <button type="button" className="accion-parada" onClick={onDejarDeCompartir}>Dejar de usar mi ubicación</button>
        ) : (
          <button type="button" className="accion-parada" disabled={estadoUbicacion === "solicitando"} onClick={onCompartirUbicacion}>
            Usar mi ubicación actual
          </button>
        )}
      </div>
      {estadoUbicacion === "no_disponible" && <p className="nota">No se obtuvo la ubicación; se usará la última parada confirmada.</p>}

      {propuesta && (
        <div className={`propuesta-clima-detalle${propuesta.estado === "pendiente" ? " propuesta-clima-alerta" : ""}`} role="region" aria-label="Propuesta por cambio de clima">
          <h3>{propuesta.evento.nivel ? NIVEL[propuesta.evento.nivel] : "Cambio de clima"} en la zona del recorrido</h3>
          <p>{describirSenal(propuesta.evento.senalPrincipal)}</p>
          <p className="nota">
            Fuente: OpenWeather · consultado a las {hora(propuesta.evento.consultadoEn)}
            {propuesta.evento.observacion.observadaEn && ` · observación de las ${hora(propuesta.evento.observacion.observadaEn)}`}
          </p>
          <p>{propuesta.mensaje}</p>
          {obsoleta && <p className="aviso-error">El itinerario cambió después de generar esta propuesta. Revisa el clima de nuevo para obtener una actualizada.</p>}

          {propuesta.paradasAfectadas.length > 0 && (
            <>
              <h4>Paradas afectadas</h4>
              <ul>{propuesta.paradasAfectadas.map((a) => <li key={a.paradaId}><b>{a.nombre}</b>: {a.motivo}</li>)}</ul>
            </>
          )}

          {propuesta.sustituciones.length > 0 && (
            <>
              <h4>Cambios propuestos</h4>
              <ul>
                {propuesta.sustituciones.map((s) => (
                  <li key={s.paradaOriginalId}>
                    <b>{s.paradaOriginalNombre}</b> → <b>{s.alternativaNombre}</b>
                    <br />
                    <small>{s.razon}</small>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="propuesta-clima-comparacion">
            <Ruta titulo="Recorrido actual" ruta={propuesta.rutaAnterior} />
            <Ruta titulo="Recorrido propuesto" ruta={propuesta.rutaPropuesta} />
          </div>

          {propuesta.alternativas.length > 0 && (
            <>
              <button type="button" className="enlace" aria-expanded={verAlternativas} onClick={() => setVerAlternativas((v) => !v)}>
                {verAlternativas ? "Ocultar alternativas" : `Ver alternativas (${propuesta.alternativas.length})`}
              </button>
              {verAlternativas && (
                <ul className="propuesta-clima-alternativas">
                  {propuesta.alternativas.map((a) => (
                    <li key={`${a.paraParadaId}-${a.idExterno}`}>
                      <b>{a.nombre}</b>{a.seleccionada && " · elegida"} — {DISPONIBILIDAD[a.disponibilidad]}
                      {a.ventanaVisita && ` (${a.ventanaVisita.apertura}–${a.ventanaVisita.cierre})`} · {a.distanciaLineaRectaMetros} m en línea recta
                      {a.direccion && <><br /><small>{a.direccion}</small></>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {propuesta.advertencias.length > 0 && (
            <ul className="propuesta-clima-advertencias">
              {propuesta.advertencias.map((a, i) => <li key={`${a.codigo}-${i}`}>{a.mensaje}</li>)}
            </ul>
          )}

          <div className="acciones">
            {aplicable ? (
              <>
                <button type="button" className="btn-secundario" disabled={aplicando} onClick={onRechazar}>Mantener mi itinerario</button>
                <button type="button" className="btn-primario" disabled={aplicando} onClick={onAceptar}>
                  {aplicando ? "Aplicando…" : "Aceptar cambios"}
                </button>
              </>
            ) : (
              <button type="button" className="btn-secundario" onClick={onRechazar}>Entendido</button>
            )}
          </div>
          <p className="nota">Vence a las {hora(propuesta.venceEn)}. Nada cambia hasta que aceptes.</p>
        </div>
      )}
    </section>
  );
}
