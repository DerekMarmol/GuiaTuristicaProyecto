import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useViaje } from "../context/ViajeContext";
import { abrirPlan, listarPlanes, type ResumenPlan } from "../services/planes";
import { fechaCorta } from "../utils/fechas";

const PLANES_VISIBLES = 5;

// GUI-114: con sesión iniciada, el paso 1 ofrece retomar un plan guardado en la cuenta.
export default function MisPlanes() {
  const { usuario, token } = useAuth();
  const { cargarPlan } = useViaje();
  const [planes, setPlanes] = useState<ResumenPlan[] | null>(null);
  const [error, setError] = useState("");
  const [abriendo, setAbriendo] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPlanes(null);
      return;
    }
    let cancelado = false;
    setError("");
    listarPlanes(token).then(
      (lista) => !cancelado && setPlanes(lista),
      (err) => !cancelado && setError(err instanceof Error ? err.message : "No se pudieron traer tus planes.")
    );
    return () => {
      cancelado = true;
    };
  }, [token]);

  if (!usuario || !token || (planes !== null && planes.length === 0 && !error)) return null;

  async function abrir(id: string) {
    if (!token) return;
    setAbriendo(id);
    setError("");
    try {
      const { viaje, itinerarios } = await abrirPlan(token, id);
      cargarPlan(viaje, itinerarios);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el plan.");
    } finally {
      setAbriendo(null);
    }
  }

  return (
    <section className="card mis-planes" aria-labelledby="t-mis-planes">
      <h3 id="t-mis-planes">Tus planes guardados</h3>
      {error && <p className="aviso-error" role="alert">{error}</p>}
      {planes === null && !error && <p className="nota" role="status">Buscando tus planes…</p>}
      {planes && planes.length > 0 && (
        <ul className="lugares">
          {planes.slice(0, PLANES_VISIBLES).map((p) => (
            <li key={p.id} className="lugar">
              <div className="lugar-cab">
                <h4>{p.destino}</h4>
                <button type="button" className="btn-secundario mis-planes-abrir" disabled={abriendo !== null} onClick={() => void abrir(p.id)}>
                  {abriendo === p.id ? "Abriendo…" : "Abrir"}
                </button>
              </div>
              <p>
                {fechaCorta(p.fechaInicio.slice(0, 10))}
                {p.fechaFin.slice(0, 10) !== p.fechaInicio.slice(0, 10) && ` al ${fechaCorta(p.fechaFin.slice(0, 10))}`} ·{" "}
                {p.totalDias} {p.totalDias === 1 ? "día" : "días"} · {p.totalParadas} paradas
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
