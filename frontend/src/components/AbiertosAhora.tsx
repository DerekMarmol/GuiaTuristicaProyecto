import { useEffect, useState } from "react";
import type { EstadoAbiertosAhora, ReferenciaBusqueda } from "../services/abiertosAhoraEstado";
import { etiquetaCategoria, formatearDistancia, horaDelLugar } from "../services/abiertosAhora";

export type FiltroAbiertos = "turisticos" | "intereses";

export interface PuntoReferencia {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
}

export const ID_RESULTADOS_ABIERTOS = "resultados-abiertos-ahora";

function IconoReloj() {
  return (
    <svg className="abierto-icono" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function describirReferencia(referencia: ReferenciaBusqueda): string {
  if (referencia.tipo === "manual") return `${referencia.etiqueta} (punto elegido, no es tu ubicación actual)`;
  return referencia.precisionMetros === null ? "tu ubicación actual" : `tu ubicación actual (±${referencia.precisionMetros} m)`;
}

const horaDe = (iso: string) => new Date(iso).toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" });

function mensajeEstado(estado: EstadoAbiertosAhora): string {
  switch (estado.fase) {
    case "inactivo":
      return "";
    case "ubicando":
      return "Obteniendo tu ubicación…";
    case "cargando":
      return `Buscando lugares abiertos cerca de ${describirReferencia(estado.referencia)}…`;
    case "listo": {
      const total = estado.respuesta.lugares.length;
      return total === 0
        ? "No se encontraron lugares con apertura confirmada cerca de esta ubicación."
        : `${total} ${total === 1 ? "lugar abierto" : "lugares abiertos"} cerca de ${describirReferencia(estado.referencia)}.`;
    }
    case "sin_ubicacion":
      return "No se pudo usar tu ubicación actual.";
    case "error":
      return "No se pudieron consultar los lugares abiertos.";
  }
}

function SelectorPunto({ puntos, onUsar }: { puntos: PuntoReferencia[]; onUsar: (punto: PuntoReferencia) => void }) {
  const [elegido, setElegido] = useState(puntos[0]?.id ?? "");
  const punto = puntos.find((p) => p.id === elegido) ?? puntos[0];
  if (!punto) {
    return <p className="nota">No hay paradas con coordenadas en este día para usarlas como punto de referencia.</p>;
  }
  return (
    <div className="abierto-punto">
      <label htmlFor="abierto-punto-select">Buscar cerca de una parada del itinerario</label>
      <div className="abierto-punto-fila">
        <select id="abierto-punto-select" value={punto.id} onChange={(e) => setElegido(e.target.value)}>
          {puntos.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
        <button type="button" className="accion-parada" onClick={() => onUsar(punto)}>
          Buscar aquí
        </button>
      </div>
    </div>
  );
}

export function BarraAbiertosAhora({
  estado,
  filtro,
  interesesViaje,
  puntos,
  onAlternar,
  onCambiarFiltro,
  onActualizarUbicacion,
  onUsarPunto,
  onReintentar,
}: {
  estado: EstadoAbiertosAhora;
  filtro: FiltroAbiertos;
  interesesViaje: readonly string[];
  puntos: PuntoReferencia[];
  onAlternar: () => void;
  onCambiarFiltro: (filtro: FiltroAbiertos) => void;
  onActualizarUbicacion: () => void;
  onUsarPunto: (punto: PuntoReferencia) => void;
  onReintentar: () => void;
}) {
  const activo = estado.fase !== "inactivo";
  const ocupado = estado.fase === "ubicando" || estado.fase === "cargando";
  const referencia = "referencia" in estado ? estado.referencia : null;
  const mensaje = mensajeEstado(estado);

  return (
    <section className="abierto-ahora" aria-label="Modo Abierto ahora">
      <div className="abierto-ahora-barra">
        <button
          type="button"
          className="btn-abierto-ahora"
          aria-pressed={activo}
          aria-busy={ocupado}
          aria-controls={ID_RESULTADOS_ABIERTOS}
          title={activo ? "Desactivar el modo Abierto ahora" : "Buscar lugares abiertos cerca de ti"}
          onClick={onAlternar}
        >
          {ocupado ? <span className="abierto-cargando" aria-hidden="true" /> : <IconoReloj />}
          <span>Abierto ahora</span>
        </button>

        {activo && interesesViaje.length > 0 && (
          <label className="abierto-filtro">
            <span>Buscar</span>
            <select value={filtro} disabled={estado.fase === "ubicando"} onChange={(e) => onCambiarFiltro(e.target.value as FiltroAbiertos)}>
              <option value="turisticos">Lugares turísticos</option>
              <option value="intereses">Mis intereses ({interesesViaje.join(", ")})</option>
            </select>
          </label>
        )}
      </div>

      {!activo && <p className="nota">Muestra lugares turísticos cercanos que están abiertos según su horario publicado. No cambia tu itinerario.</p>}

      <p className={activo && mensaje ? "nota abierto-estado" : "solo-lectores"} role="status" aria-live="polite">
        {mensaje}
      </p>

      {estado.fase === "sin_ubicacion" && (
        <div className="abierto-sin-ubicacion">
          <p className="aviso-error">{estado.mensaje}</p>
          <div className="propuesta-clima-acciones">
            {estado.motivo !== "no_soportada" && (
              <button type="button" className="accion-parada" onClick={onReintentar}>Intentar de nuevo</button>
            )}
          </div>
          <SelectorPunto puntos={puntos} onUsar={onUsarPunto} />
        </div>
      )}

      {estado.fase === "error" && (
        <div className="abierto-error">
          <p className="aviso-error" role="alert">{estado.mensaje}</p>
          <button type="button" className="accion-parada" onClick={onReintentar}>Reintentar</button>
        </div>
      )}

      {(estado.fase === "listo" || estado.fase === "error") && (
        <div className="propuesta-clima-acciones">
          <button type="button" className="accion-parada" onClick={onActualizarUbicacion}>
            {referencia?.tipo === "manual" ? "Usar mi ubicación actual" : "Actualizar ubicación"}
          </button>
        </div>
      )}

      {(estado.fase === "listo" || estado.fase === "error") && puntos.length > 0 && (
        <details className="abierto-otro-punto">
          <summary>Buscar cerca de una parada</summary>
          <SelectorPunto puntos={puntos} onUsar={onUsarPunto} />
        </details>
      )}
    </section>
  );
}

export function ResultadosAbiertosAhora({
  estado,
  seleccionadoId,
  onSeleccionar,
}: {
  estado: EstadoAbiertosAhora;
  seleccionadoId: string | null;
  onSeleccionar: (idExterno: string) => void;
}) {
  useEffect(() => {
    if (seleccionadoId) document.getElementById(`abierto-${seleccionadoId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [seleccionadoId]);

  if (estado.fase !== "listo") return null;
  const { respuesta, referencia } = estado;
  const { cobertura } = respuesta;

  return (
    <section className="recomendaciones abiertos-resultados" id={ID_RESULTADOS_ABIERTOS} aria-labelledby="t-abiertos">
      <h3 id="t-abiertos">Abierto ahora</h3>
      <p className="nota">
        Cerca de {describirReferencia(referencia)}, en un radio de {formatearDistancia(respuesta.radioMetros)}, según los horarios publicados en
        Geoapify (revisados a las {horaDe(respuesta.evaluadoEn)}). Un lugar abierto ahora podría cerrar antes de que llegues, y ninguno se agrega a tu itinerario.
      </p>

      {respuesta.lugares.length === 0 ? (
        <p className="aviso-vacio">
          No se encontraron lugares con apertura confirmada cerca de esta ubicación.
          {cobertura.desconocidos > 0 && ` ${cobertura.desconocidos} ${cobertura.desconocidos === 1 ? "lugar cercano no publica" : "lugares cercanos no publican"} un horario que se pueda verificar.`}
        </p>
      ) : (
        <ul className="lugares">
          {respuesta.lugares.map((lugar) => {
            const seleccionado = lugar.idExterno === seleccionadoId;
            const cierre = horaDelLugar(lugar.cierreEstimado);
            return (
              <li key={lugar.idExterno} id={`abierto-${lugar.idExterno}`} className={`lugar lugar-abierto${seleccionado ? " lugar-abierto-seleccionado" : ""}`}>
                <div className="lugar-cab">
                  <h4>{lugar.nombre}</h4>
                  <span className="sello-abierto"><IconoReloj /> Abierto ahora</span>
                </div>
                {lugar.direccion && <p>{lugar.direccion}</p>}
                <ul className="lugar-meta">
                  <li>{etiquetaCategoria(lugar.categorias)}</li>
                  <li>a {formatearDistancia(lugar.distanciaMetros)} en línea recta</li>
                  <li>{cierre ? `Cierra a las ${cierre}` : "Sin cierre en las próximas 48 h"}</li>
                </ul>
                {lugar.horario.valorOriginal && <p>Horario publicado: {lugar.horario.valorOriginal}</p>}
                <button type="button" className="accion-parada" aria-pressed={seleccionado} onClick={() => onSeleccionar(lugar.idExterno)}>
                  {seleccionado ? "Mostrando en el mapa" : "Ver en el mapa"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {cobertura.busquedaLimitada && (
        <p className="nota">Se revisaron los {cobertura.candidatosEvaluados} lugares más cercanos; puede haber otros abiertos en la zona.</p>
      )}
    </section>
  );
}
