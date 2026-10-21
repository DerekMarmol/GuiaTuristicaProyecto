import { useEffect, useRef, useState } from "react";
import type { Itinerario } from "../../../shared/types";
import type { ViajeBorrador } from "../context/ViajeContext";
import { buscarHoteles, buscarRestaurantes } from "../services/recomendaciones";
import type { RecomendacionesHoteles, RecomendacionesRestaurantes } from "../types/recomendacion";
import { fechaCorta } from "../utils/fechas";

const MONEDA = "Q"; // Quetzales. Debe coincidir con la moneda de los pasos 3 y 4.
const VISIBLES_INICIALES = 6;

type Pestana = "hoteles" | "restaurantes";

type Carga<T> = { fase: "cargando" } | { fase: "listo"; datos: T } | { fase: "error"; mensaje: string };

interface Props {
  viaje: ViajeBorrador;
  itinerarios: Itinerario[];
  dia: Itinerario; // día activo: los restaurantes se buscan cerca de sus paradas
  mostrarHoteles: boolean; // true solo si el usuario pidió recomendaciones de hospedaje
}

const dinero = (n: number) => `${MONEDA} ${n.toLocaleString("es-GT")}`;
const personas = (n: number) => `${n} ${n === 1 ? "persona" : "personas"}`;
const distancia = (km: number) => (km < 0.1 ? "a menos de 100 m" : `a ${km.toFixed(1)} km`);

// Consulta una vez por clave y guarda el resultado: volver a una pestaña o a un día ya visto no repite
// la búsqueda. Con clave null no consulta (pestaña cerrada).
function useConsulta<T>(clave: string | null, consultar: (signal: AbortSignal) => Promise<T>) {
  const cache = useRef(new Map<string, T>());
  const [estado, setEstado] = useState<Carga<T>>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (clave === null) return;
    const guardado = cache.current.get(clave);
    if (guardado) {
      setEstado({ fase: "listo", datos: guardado });
      return;
    }
    const controlador = new AbortController();
    setEstado({ fase: "cargando" });
    consultar(controlador.signal).then(
      (datos) => {
        if (controlador.signal.aborted) return;
        cache.current.set(clave, datos);
        setEstado({ fase: "listo", datos });
      },
      (err) => {
        if (controlador.signal.aborted) return;
        setEstado({ fase: "error", mensaje: err instanceof Error ? err.message : "No se pudo completar la búsqueda." });
      }
    );
    return () => controlador.abort();
  }, [clave, intento]);

  return { estado, reintentar: () => setIntento((n) => n + 1) };
}

export default function Recomendaciones({ viaje, itinerarios, dia, mostrarHoteles }: Props) {
  const [pestana, setPestana] = useState<Pestana>("hoteles");
  const [verTodos, setVerTodos] = useState(false);

  const activa: Pestana = mostrarHoteles ? pestana : "restaurantes";
  const esHoteles = activa === "hoteles";
  const condiciones = `${viaje.presupuestoDiario}|${viaje.tipoViaje}`;
  const claveHoteles = `${itinerarios.map((it) => `${it.fecha}:${it.paradas.map((p) => p.id).join(",")}`).join("|")}|${condiciones}`;
  const claveRestaurantes = `${dia.id}:${dia.paradas.map((p) => p.id).join(",")}|${condiciones}`;

  const hoteles = useConsulta<RecomendacionesHoteles>(
    esHoteles ? claveHoteles : null,
    (signal) => buscarHoteles(viaje, itinerarios, signal)
  );
  const restaurantes = useConsulta<RecomendacionesRestaurantes>(
    esHoteles ? null : claveRestaurantes,
    (signal) => buscarRestaurantes(viaje, dia, signal)
  );

  useEffect(() => setVerTodos(false), [activa, dia.id]);

  const consulta = esHoteles ? hoteles : restaurantes;
  const { estado } = consulta;

  let contenido;
  if (estado.fase === "cargando") {
    contenido = (
      <p className="nota" role="status">
        {esHoteles ? "Buscando hoteles…" : "Buscando restaurantes…"}
      </p>
    );
  } else if (estado.fase === "error") {
    contenido = (
      <>
        <p className="aviso-error" role="alert">{estado.mensaje}</p>
        <button type="button" className="enlace" onClick={consulta.reintentar}>Reintentar</button>
      </>
    );
  } else if (esHoteles) {
    const datos = estado.datos as RecomendacionesHoteles;
    contenido = (
      <>
        <p className="nota">
          Cerca del centro de tu itinerario, para la noche del {fechaCorta(itinerarios[0].fecha)}. Hasta{" "}
          {dinero(datos.presupuestoHospedaje)} por noche (40 % de tu presupuesto diario), habitación para{" "}
          {personas(datos.personas)}.
        </p>
        <Lista
          vacio={datos.mensaje ?? "No encontramos hoteles con precio dentro de tu presupuesto cerca de tu ruta."}
          verTodos={verTodos}
          onVerTodos={() => setVerTodos(true)}
          elementos={datos.hoteles.map((h) => ({
            id: h.id,
            nombre: h.nombre,
            precio: <>{dinero(h.precio)} <small>/ noche</small></>,
            meta: `${distancia(h.distanciaKm)} del centro de tu ruta`,
          }))}
        />
        <p className="nota">Precios referenciales de Google Hotels convertidos a quetzales; el cobro final puede variar.</p>
      </>
    );
  } else {
    const datos = estado.datos as RecomendacionesRestaurantes;
    contenido = (
      <>
        <p className="nota">
          Cerca de las paradas del día {dia.numeroDia}. Hasta {dinero(datos.presupuestoPorPersona)} por persona
          en una comida, para {personas(datos.personas)}.
        </p>
        {datos.incompleto && (
          <p className="nota">No pudimos consultar todas las paradas; la lista puede estar incompleta.</p>
        )}
        <Lista
          vacio={datos.mensaje ?? "No encontramos restaurantes dentro de tu presupuesto cerca de las paradas de este día."}
          verTodos={verTodos}
          onVerTodos={() => setVerTodos(true)}
          elementos={datos.restaurantes.map((r) => ({
            id: r.id,
            nombre: r.nombre,
            precio: <>{dinero(r.precioMinimo)}–{r.precioMaximo} <small>/ persona</small></>,
            meta: `${distancia(r.distanciaKm)} de ${r.cercaDe ?? "tus paradas"}`,
          }))}
        />
        <p className="nota">Rangos de precio referenciales del mercado, no precios del menú.</p>
      </>
    );
  }

  return (
    <section className="recomendaciones" aria-labelledby="t-reco">
      <h3 id="t-reco">{mostrarHoteles ? "Dónde dormir y comer" : "Dónde comer"}</h3>

      {mostrarHoteles && (
        <div className="dias" role="tablist" aria-label="Tipo de recomendación">
          <button type="button" role="tab" id="tab-hoteles" aria-selected={esHoteles} aria-controls="panel-reco" className="dia" onClick={() => setPestana("hoteles")}>
            Hoteles
          </button>
          <button type="button" role="tab" id="tab-restaurantes" aria-selected={!esHoteles} aria-controls="panel-reco" className="dia" onClick={() => setPestana("restaurantes")}>
            Restaurantes
          </button>
        </div>
      )}

      <div {...(mostrarHoteles ? { id: "panel-reco", role: "tabpanel", "aria-labelledby": `tab-${activa}` } : {})}>
        {contenido}
      </div>
    </section>
  );
}

interface Elemento {
  id: string;
  nombre: string;
  precio: React.ReactNode;
  meta: string;
}

function Lista({ elementos, vacio, verTodos, onVerTodos }: { elementos: Elemento[]; vacio: string; verTodos: boolean; onVerTodos: () => void }) {
  if (elementos.length === 0) {
    return <p className="aviso-vacio" role="status">{vacio}</p>;
  }
  const visibles = verTodos ? elementos : elementos.slice(0, VISIBLES_INICIALES);
  const ocultos = elementos.length - visibles.length;
  return (
    <>
      <ul className="lugares">
        {visibles.map((l) => (
          <li key={l.id} className="lugar">
            <div className="lugar-cab">
              <h4>{l.nombre}</h4>
              <span className="precio">{l.precio}</span>
            </div>
            <ul className="lugar-meta">
              <li>{l.meta}</li>
            </ul>
          </li>
        ))}
      </ul>
      {ocultos > 0 && (
        <button type="button" className="enlace" onClick={onVerTodos}>
          Ver {ocultos} más
        </button>
      )}
    </>
  );
}
