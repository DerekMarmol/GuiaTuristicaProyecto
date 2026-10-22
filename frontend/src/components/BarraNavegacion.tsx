import type { DestinoNavegacion } from "../hooks/useNavegacion";
import { anguloManiobra, formatearDistancia, formatearDuracion, type Progreso, type RutaNavegacion } from "../services/navegacion";

interface Props {
  destino: DestinoNavegacion;
  ruta: RutaNavegacion | null;
  progreso: Progreso | null;
  error: string | null;
  cargando: boolean;
  recalculando: boolean;
  sinUbicacion: boolean;
  hayOtraParada: boolean;
  onTerminar: () => void;
  onMarcarVisitada: () => void;
}

function Flecha({ tipo, modificador }: { tipo: string; modificador: string | null }) {
  if (tipo === "arrive") {
    return (
      <svg className="nav-flecha" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      </svg>
    );
  }
  return (
    <svg className="nav-flecha" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${anguloManiobra(modificador)}deg)` }}>
      <path d="M12 3 5 11h4.5v10h5V11H19Z" />
    </svg>
  );
}

// GUI-116: indicación actual de la navegación, sobre el mapa.
export default function BarraNavegacion({
  destino,
  ruta,
  progreso,
  error,
  cargando,
  recalculando,
  sinUbicacion,
  hayOtraParada,
  onTerminar,
  onMarcarVisitada,
}: Props) {
  let contenido;
  if (sinUbicacion) {
    contenido = <p className="nav-estado">Esperando tu ubicación para guiarte…</p>;
  } else if (error) {
    contenido = <p className="nav-estado aviso-error" role="alert">{error}</p>;
  } else if (!ruta || !progreso) {
    contenido = <p className="nav-estado" role="status">{cargando ? "Calculando la ruta…" : "Preparando la ruta…"}</p>;
  } else if (progreso.llego) {
    contenido = (
      <>
        <div className="nav-indicacion">
          <Flecha tipo="arrive" modificador={null} />
          <p className="nav-texto" role="status"><strong>Llegaste a {destino.nombre}</strong></p>
        </div>
        <button type="button" className="btn-primario nav-boton" onClick={onMarcarVisitada}>
          {hayOtraParada ? "Marcar como visitada y seguir" : "Marcar como visitada"}
        </button>
      </>
    );
  } else {
    const paso = ruta.pasos[progreso.indicePaso];
    contenido = (
      <>
        <div className="nav-indicacion" aria-live="polite">
          <Flecha tipo={paso.tipo} modificador={paso.modificador} />
          <div>
            <p className="nav-distancia">{formatearDistancia(progreso.distanciaAlPaso)}</p>
            <p className="nav-texto">{paso.instruccion}</p>
          </div>
        </div>
        <p className="nav-resumen">
          {recalculando || progreso.fueraDeRuta
            ? "Te saliste de la ruta: buscando otro camino…"
            : `Faltan ${formatearDistancia(progreso.distanciaRestante)} · ${formatearDuracion(progreso.segundosRestantes)} hasta ${destino.nombre}`}
        </p>
      </>
    );
  }

  return (
    <section className="nav-barra" aria-label={`Navegación hacia ${destino.nombre}`}>
      {contenido}
      <button type="button" className="enlace nav-terminar" onClick={onTerminar}>
        Terminar navegación
      </button>
    </section>
  );
}
