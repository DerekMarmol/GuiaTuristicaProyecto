import type { EstadoUbicacionPartida } from "../hooks/usePuntoPartida";
import { horaDeSalida, sumarMinutos, type PuntoPartida, type TrasladoInicio } from "../services/puntoPartida";

interface BarraProps {
  punto: PuntoPartida | null;
  estado: EstadoUbicacionPartida;
  mensaje: string | null;
  eligiendo: boolean;
  lejos: boolean;
  distanciaKm: number | null;
  destino?: string;
  onUsarUbicacion: () => void;
  onElegirEnMapa: () => void;
  onCancelarEleccion: () => void;
}

function describirPunto(punto: PuntoPartida): string {
  if (punto.fuente === "mapa") return "un punto que marcaste en el mapa";
  return punto.precisionMetros ? `tu ubicación actual (±${punto.precisionMetros} m)` : "tu ubicación actual";
}

export function BarraPuntoPartida({
  punto,
  estado,
  mensaje,
  eligiendo,
  lejos,
  distanciaKm,
  destino,
  onUsarUbicacion,
  onElegirEnMapa,
  onCancelarEleccion,
}: BarraProps) {
  let texto: string;
  if (eligiendo) {
    texto = "Toca el mapa en el lugar desde donde sales (tu hotel, por ejemplo).";
  } else if (estado === "solicitando") {
    texto = "Obteniendo tu ubicación…";
  } else if (punto && lejos && distanciaKm !== null) {
    texto =
      `Estás a ${Math.round(distanciaKm)} km de ${destino ?? "tu destino"}. Usaremos tu ubicación como punto de ` +
      "partida cuando estés allá; mientras, puedes marcar en el mapa desde dónde saldrás.";
  } else if (punto) {
    texto = `Sales desde ${describirPunto(punto)}.`;
  } else {
    texto = "Indica desde dónde sales para calcular el primer traslado.";
  }

  return (
    <section className="punto-partida" aria-label="Punto de partida">
      <p className="nota" role="status" aria-live="polite">
        <b>Punto de partida:</b> {texto}
      </p>
      {mensaje && !eligiendo && (
        <p className="aviso-error" role="alert">
          {mensaje} O marca tu punto de partida en el mapa.
        </p>
      )}
      <div className="propuesta-clima-acciones">
        {eligiendo ? (
          <button type="button" className="accion-parada" onClick={onCancelarEleccion}>
            Cancelar
          </button>
        ) : (
          <>
            <button type="button" className="accion-parada" disabled={estado === "solicitando"} onClick={onUsarUbicacion}>
              {punto?.fuente === "ubicacion" ? "Actualizar mi ubicación" : "Usar mi ubicación"}
            </button>
            <button type="button" className="accion-parada" onClick={onElegirEnMapa}>
              Elegir en el mapa
            </button>
          </>
        )}
      </div>
    </section>
  );
}

interface TrasladoProps {
  punto: PuntoPartida;
  traslado: TrasladoInicio;
  nombreParada: string;
  llegada?: string; // hora programada de llegada a la primera parada, "HH:MM"
  esHoy?: boolean;
}

function horaActual(): string {
  const ahora = new Date();
  return `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
}

// Hoy no se sugiere salir a una hora que ya pasó: se dice a qué hora llega si sale ahora.
export function textoSalida(llegada: string, minutosTraslado: number, esHoy: boolean, ahora = horaActual()): string {
  const salida = horaDeSalida(llegada, minutosTraslado);
  return esHoy && salida < ahora
    ? `Si sales ahora, llegas a las ${sumarMinutos(ahora, minutosTraslado)}.`
    : `Sal a las ${salida} para llegar a las ${llegada}.`;
}

// Mismo desglose que «Traslado y margen de seguridad» entre paradas, para el tramo inicial.
export function TrasladoDesdePartida({ punto, traslado, nombreParada, llegada, esHoy = false }: TrasladoProps) {
  const { tiempoBaseMinutos, desgloseHolgura: d, tiempoTotalConHolgura, distanciaKm } = traslado;
  return (
    <div className="bloque-traslado-holgura">
      <div className="tarjeta-holgura">
        <div className="encabezado-holgura">Desde {punto.fuente === "ubicacion" ? "tu ubicación" : "tu punto de partida"}</div>
        <p className="nota">
          {distanciaKm} km en línea recta hasta {nombreParada}.
          {llegada && ` ${textoSalida(llegada, tiempoTotalConHolgura, esHoy)}`}
        </p>
        <ul className="desglose-lista">
          <li><span>Tiempo base de traslado</span><strong>{tiempoBaseMinutos} min</strong></li>
          <li><span>Margen estándar</span><strong>+{d.margenEstandar} min</strong></li>
          <li><span>{traslado.tipoTraslado === "pie" ? "Caminata y accesos" : "Estacionamiento y peatonal"}</span><strong>+{d.estacionamientoOAdicional} min</strong></li>
          <li><span>Imprevistos / Tráfico</span><strong>+{d.imprevistos} min</strong></li>
          <li><span><strong>Tiempo total recomendado</strong></span><strong>{tiempoTotalConHolgura} min</strong></li>
        </ul>
      </div>
    </div>
  );
}
