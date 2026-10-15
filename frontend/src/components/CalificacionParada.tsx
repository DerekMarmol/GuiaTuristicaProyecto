import { useState } from "react";
import {
  ETIQUETAS_EXPERIENCIA,
  type Calificacion,
  type EtiquetaExperiencia,
} from "../types/calificacion";

interface Props {
  paradaId: string;
  nombre: string;
  inicial?: Calificacion;
  onGuardar: (c: Calificacion) => void;
  onCancelar: () => void;
}

const TEXTO_ESTRELLAS = ["", "Mala", "Regular", "Buena", "Muy buena", "Excelente"];

export default function CalificacionParada({ paradaId, nombre, inicial, onGuardar, onCancelar }: Props) {
  const [estrellas, setEstrellas] = useState<number>(inicial?.estrellas ?? 0);
  const [etiquetas, setEtiquetas] = useState<EtiquetaExperiencia[]>(inicial?.etiquetas ?? []);
  const [comentario, setComentario] = useState(inicial?.comentario ?? "");
  const [error, setError] = useState("");

  function alternar(e: EtiquetaExperiencia) {
    setEtiquetas((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  }

  function guardar() {
    if (estrellas < 1) {
      setError("Elige de 1 a 5 estrellas para guardar.");
      return;
    }
    onGuardar({
      paradaId,
      estrellas: estrellas as Calificacion["estrellas"],
      etiquetas,
      comentario: comentario.trim() || undefined,
      fecha: new Date().toISOString(),
    });
  }

  return (
    <div className="calificar" role="group" aria-label={`Calificar ${nombre}`}>
      <p className="calificar-titulo">¿Cómo te fue en {nombre}?</p>

      <div className="estrellas" role="radiogroup" aria-label="Calificación de 1 a 5 estrellas">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={estrellas === n}
            aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
            className={`estrella-btn${n <= estrellas ? " activa" : ""}`}
            onClick={() => { setEstrellas(n); setError(""); }}
          >
            ★
          </button>
        ))}
        <span className="estrellas-texto" aria-live="polite">{TEXTO_ESTRELLAS[estrellas]}</span>
      </div>

      <div className="etiquetas" role="group" aria-label="Etiquetas de la experiencia">
        {ETIQUETAS_EXPERIENCIA.map((e) => (
          <button
            key={e}
            type="button"
            className="etiqueta"
            aria-pressed={etiquetas.includes(e)}
            onClick={() => alternar(e)}
          >
            {e}
          </button>
        ))}
      </div>

      <label htmlFor={`com-${paradaId}`} className="calificar-label">Comentario (opcional)</label>
      <textarea
        id={`com-${paradaId}`}
        className="calificar-texto"
        rows={2}
        maxLength={280}
        placeholder="Cuéntanos algo más de tu visita"
        value={comentario}
        onChange={(ev) => setComentario(ev.target.value)}
      />

      {error && <p className="aviso-error" role="alert">{error}</p>}

      <div className="calificar-acciones">
        <button type="button" className="btn-secundario" onClick={onCancelar}>Cancelar</button>
        <button type="button" className="btn-primario" onClick={guardar}>Guardar calificación</button>
      </div>
    </div>
  );
}

// Vista de solo lectura de una calificación guardada.
export function ResumenCalificacion({ c, onEditar }: { c: Calificacion; onEditar: () => void }) {
  return (
    <div className="calificacion-resumen">
      <span className="estrellas-fijas" role="img" aria-label={`${c.estrellas} de 5 estrellas`}>
        {"★".repeat(c.estrellas)}
        <span className="vacias">{"★".repeat(5 - c.estrellas)}</span>
      </span>
      {c.etiquetas.length > 0 && (
        <ul className="etiquetas-fijas">
          {c.etiquetas.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {c.comentario && <p className="calificacion-comentario">“{c.comentario}”</p>}
      <button type="button" className="enlace-mini" onClick={onEditar}>Editar calificación</button>
    </div>
  );
}