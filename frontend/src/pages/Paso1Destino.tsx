import { useState, type FormEvent, type MouseEvent } from "react";
import { useViaje } from "../context/ViajeContext";
import Stepper from "../components/Stepper";
import MisPlanes from "../components/MisPlanes";

interface Errores {
  destino?: string;
  fechaInicio?: string;
  fechaFin?: string;
}

// Fecha de hoy en formato AAAA-MM-DD usando la hora local del usuario.
function hoyISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// GUI-109: en Chrome (incluida la vista de teléfono de DevTools) tocar el campo solo selecciona el día o el
// mes para escribirlo; el calendario abre únicamente desde el icono pequeño. Se abre al tocar cualquier
// parte del campo. Escribir la fecha con el teclado sigue funcionando.
function abrirCalendario(evento: MouseEvent<HTMLInputElement>) {
  try {
    evento.currentTarget.showPicker?.();
  } catch {
    // El navegador puede rechazarlo (por ejemplo, dentro de un iframe); el campo sigue funcionando.
  }
}

export default function Paso1Destino() {
  const { viaje, actualizarViaje, irAPaso } = useViaje();
  const [destino, setDestino] = useState(viaje.destino ?? "");
  const [fechaInicio, setFechaInicio] = useState(viaje.fechaInicio ?? "");
  const [fechaFin, setFechaFin] = useState(viaje.fechaFin ?? "");
  const [errores, setErrores] = useState<Errores>({});
  const hoy = hoyISO();

  function validar(): Errores {
    const e: Errores = {};
    if (!destino.trim()) e.destino = "Escribe el destino al que quieres ir.";
    if (!fechaInicio) e.fechaInicio = "Selecciona la fecha de inicio.";
    else if (fechaInicio < hoy) e.fechaInicio = "La fecha de inicio no puede estar en el pasado.";
    if (!fechaFin) e.fechaFin = "Selecciona la fecha de fin.";
    else if (fechaInicio && fechaFin < fechaInicio) e.fechaFin = "La fecha de fin debe ser igual o posterior al inicio.";
    return e;
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) return;
    // Las coordenadas del destino anterior ya no sirven; el backend las resuelve de nuevo al generar.
    actualizarViaje({ destino: destino.trim(), fechaInicio, fechaFin, lat: undefined, lng: undefined });
    irAPaso(2);
  }

  return (
    <>
    <form className="card" onSubmit={onSubmit} noValidate>
      <Stepper actual={1} />
      <h2>¿A dónde quieres ir?</h2>

      <label htmlFor="destino">Destino</label>
      <input
        id="destino"
        type="text"
        placeholder="Ej. Antigua Guatemala"
        value={destino}
        onChange={(e) => setDestino(e.target.value)}
        aria-invalid={!!errores.destino}
        autoComplete="off"
      />
      {errores.destino && <p className="error">{errores.destino}</p>}

      <div className="fila">
        <div>
          <label htmlFor="fechaInicio">Fecha de inicio</label>
          <input
            id="fechaInicio"
            type="date"
            min={hoy}
            value={fechaInicio}
            onClick={abrirCalendario}
            onChange={(e) => {
              setFechaInicio(e.target.value);
              if (fechaFin && e.target.value > fechaFin) setFechaFin("");
            }}
            aria-invalid={!!errores.fechaInicio}
          />
          {errores.fechaInicio && <p className="error">{errores.fechaInicio}</p>}
        </div>
        <div>
          <label htmlFor="fechaFin">Fecha de fin</label>
          <input
            id="fechaFin"
            type="date"
            min={fechaInicio || hoy}
            value={fechaFin}
            onClick={abrirCalendario}
            onChange={(e) => setFechaFin(e.target.value)}
            aria-invalid={!!errores.fechaFin}
          />
          {errores.fechaFin && <p className="error">{errores.fechaFin}</p>}
        </div>
      </div>

      <button type="submit" className="btn-primario">Siguiente</button>
    </form>
    <MisPlanes />
    </>
  );
}