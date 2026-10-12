import { useEffect, useState } from "react";
import { consultarClima, type DatosClima } from "../services/clima";

interface Props {
  lat: number;
  lng: number;
  fecha: string;
  hora: string;
}

type Estado = "cargando" | "disponible" | "sin_datos";

export default function IndicadorClima({
  lat,
  lng,
  fecha,
  hora,
}: Props) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [clima, setClima] = useState<DatosClima | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function cargar() {
      setEstado("cargando");
      setClima(null);

      const fechaHora = `${fecha}T${hora}:00`;

      const resultado = await consultarClima(
        lat,
        lng,
        fechaHora,
        controller.signal
      );

      if (controller.signal.aborted) {
        return;
      }

      setClima(resultado);
      setEstado(resultado ? "disponible" : "sin_datos");
    }

    cargar();

    return () => controller.abort();
  }, [lat, lng, fecha, hora]);

  if (estado === "cargando") {
    return (
      <div className="indicador-clima" role="status">
        Consultando pronóstico...
      </div>
    );
  }

  if (estado === "sin_datos" || !clima) {
    return (
      <div className="indicador-clima sin-datos">
        Pronóstico no disponible para esta visita.
      </div>
    );
  }

  return (
    <div
      className={`indicador-clima ${
        clima.malClima ? "clima-alerta" : "clima-normal"
      }`}
    >
      <div className="clima-datos">
        <span>
          Temperatura: <strong>{clima.temperatura} °C</strong>
        </span>

        <span>
          Probabilidad de lluvia:{" "}
          <strong>{clima.probabilidadLluvia}%</strong>
        </span>
      </div>

      {clima.malClima && (
        <p className="clima-advertencia" role="status">
          Advertencia: se pronostican condiciones
          meteorológicas desfavorables durante esta visita.
        </p>
      )}
    </div>
  );
}
