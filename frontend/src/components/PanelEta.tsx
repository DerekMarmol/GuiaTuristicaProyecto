import { useState } from "react";
import {
  solicitarRecalculoEta,
  type SolicitudEta,
  type RespuestaEta,
} from "../services/eta";

interface PanelEtaProps {
  solicitud: SolicitudEta;
}

export default function PanelEta({ solicitud }: PanelEtaProps) {
  const [resultado, setResultado] = useState<RespuestaEta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actualizarEta = async () => {
    setCargando(true);
    setError(null);
    try {
      const datos = await solicitarRecalculoEta({
        ...solicitud,
        horaActual: new Date().toISOString(),
      });
      setResultado(datos);
    } catch {
      setError("No se pudo actualizar la hora estimada de llegada.");
    } finally {
      setCargando(false);
    }
  };

  const formatearHora = (fecha: string) =>
    new Date(fecha).toLocaleTimeString("es-GT", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <section className="eta-panel" aria-label="Seguimiento de llegada">
      <div className="eta-encabezado">
        <span className="eta-icono" aria-hidden="true">🕒</span>
        <div>
          <h3>Hora estimada de llegada</h3>
          <p className="eta-descripcion">
            Consulta el tiempo restante y las próximas paradas.
          </p>
        </div>
      </div>

      <button
        className="eta-actualizar"
        type="button"
        onClick={actualizarEta}
        disabled={cargando}
      >
        {cargando ? "Actualizando..." : "Actualizar ETA"}
      </button>

      {error && <p className="eta-estado eta-estado--error" role="alert">{error}</p>}

      {resultado && (
        <div className="eta-resultados" aria-live="polite">
          <div className="eta-cifras">
            <div className="eta-cifra eta-cifra--principal">
              <small>Llegada estimada</small>
              <strong>{formatearHora(resultado.etaActualizada)}</strong>
            </div>
            <div className="eta-cifra">
              <small>Tiempo restante</small>
              <strong>{resultado.tiempoRestanteMinutos} min</strong>
            </div>
          </div>

          {resultado.retrasoMinutos > 0 ? (
            <p className="eta-estado eta-estado--retraso" role="alert">
              ⚠️ Retraso detectado: {resultado.retrasoMinutos} minutos.
            </p>
          ) : (
            <p className="eta-estado">✓ Sin retrasos detectados.</p>
          )}

          <div className="eta-proximas">
            <h4>Próximas paradas</h4>
            {resultado.proximasParadas.length > 0 ? (
              <ul className="eta-lista">
                {resultado.proximasParadas.map((parada) => (
                  <li key={parada.paradaId}>
                    <span>Parada {parada.paradaId}</span>
                    <strong>{formatearHora(parada.llegadaEstimada)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="eta-vacio">No hay más paradas programadas.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
