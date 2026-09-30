import { useState, type FormEvent } from "react";
import { useViaje } from "../context/ViajeContext";
import Stepper from "../components/Stepper";
import "./pasos.css";

type Opcion = "tengo" | "necesito";

export default function Paso2Hospedaje() {
  const { viaje, actualizarViaje, irAPaso } = useViaje();
  const inicial: Opcion | null = viaje.hospedaje === true ? "tengo" : viaje.hospedaje === false ? "necesito" : null;
  const [opcion, setOpcion] = useState<Opcion | null>(inicial);
  const [hotel, setHotel] = useState(viaje.nombreHotel ?? "");
  const [errorOpcion, setErrorOpcion] = useState("");
  const [errorHotel, setErrorHotel] = useState("");

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setErrorOpcion("");
    setErrorHotel("");

    if (!opcion) {
      setErrorOpcion("Elige una opción para continuar.");
      return;
    }
    if (opcion === "tengo") {
      if (hotel.trim().length < 2) {
        setErrorHotel("Escribe el nombre de tu hotel.");
        return;
      }
      actualizarViaje({ hospedaje: true, nombreHotel: hotel.trim() });
    } else {
      actualizarViaje({ hospedaje: false, nombreHotel: undefined });
    }
    irAPaso(3);
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <Stepper actual={2} />
      <h2 id="t-hospedaje">¿Ya tienes dónde hospedarte?</h2>

      <div className="opciones" role="radiogroup" aria-labelledby="t-hospedaje">
        <label className="opcion">
          <input
            type="radio"
            name="hospedaje"
            value="tengo"
            checked={opcion === "tengo"}
            onChange={() => { setOpcion("tengo"); setErrorOpcion(""); }}
          />
          Ya tengo hotel reservado
          <small>Lo usaremos como punto de partida de cada día.</small>
        </label>
        <label className="opcion">
          <input
            type="radio"
            name="hospedaje"
            value="necesito"
            checked={opcion === "necesito"}
            onChange={() => { setOpcion("necesito"); setErrorOpcion(""); setErrorHotel(""); }}
          />
          Necesito recomendaciones de hospedaje
          <small>Te sugeriremos hoteles cerca de tu itinerario y dentro de tu presupuesto.</small>
        </label>
      </div>
      {errorOpcion && <p className="error" role="alert">{errorOpcion}</p>}

      {opcion === "tengo" && (
        <>
          <label htmlFor="nombreHotel">Nombre del hotel</label>
          <input
            id="nombreHotel"
            type="text"
            placeholder="Ej. Hotel Casa Santo Domingo"
            value={hotel}
            onChange={(e) => { setHotel(e.target.value); setErrorHotel(""); }}
            aria-invalid={!!errorHotel}
            autoComplete="off"
          />
          {errorHotel && <p className="error" role="alert">{errorHotel}</p>}
        </>
      )}

      <div className="acciones">
        <button type="button" className="btn-secundario" onClick={() => irAPaso(1)}>Atrás</button>
        <button type="submit" className="btn-primario">Siguiente</button>
      </div>
    </form>
  );
}