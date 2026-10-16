import { useTelemetria } from "../hooks/useTelemetria";

export function PanelTelemetria() {
  const { estado, velocidadKmh, error, iniciar, detener } = useTelemetria();

  const seguimientoActivo = estado === "activo" || estado === "solicitando";

  const estadoTexto =
    estado === "inactivo"
      ? "Seguimiento detenido"
      : estado === "solicitando"
        ? "Buscando señal GPS..."
        : estado === "activo"
          ? "GPS activo"
          : "Error de ubicación";

  return (
    <section className="telemetria" aria-label="Telemetría del recorrido">
      <div className="telemetria-encabezado">
        <div>
          <span className="telemetria-etiqueta">MONITOREO DEL RECORRIDO</span>
          <h3>Velocidad en tiempo real</h3>
        </div>
        <span
          className={`telemetria-indicador ${estado}`}
          aria-label={estadoTexto}
          title={estadoTexto}
        />
      </div>

      <div className="telemetria-contenido">
        <div className="telemetria-velocidad" aria-live="polite">
          {velocidadKmh === null ? (
            <span className="telemetria-sin-datos">--</span>
          ) : (
            <strong>{velocidadKmh.toFixed(1)}</strong>
          )}
          <span className="telemetria-unidad">km/h</span>
        </div>
        <p className="telemetria-descripcion">
          {velocidadKmh === null
            ? "Esperando datos de velocidad del dispositivo"
            : "Velocidad detectada por el GPS"}
        </p>
        <div className="telemetria-estado" role="status">
          <span className={`telemetria-punto ${estado}`} aria-hidden="true" />
          <span>{estadoTexto}</span>
        </div>
      </div>

      {error && (
        <p className="telemetria-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="telemetria-boton"
        onClick={seguimientoActivo ? detener : iniciar}
      >
        {seguimientoActivo ? "Detener seguimiento" : "Iniciar seguimiento"}
      </button>
    </section>
  );
}