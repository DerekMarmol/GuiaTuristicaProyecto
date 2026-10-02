import { useState } from "react";
import type { Lugar } from "../types/recomendacion";
import { limitesPresupuesto } from "../services/recomendaciones";

const MONEDA = "Q"; // Quetzales. Debe coincidir con la moneda de los pasos 3 y 4.

type Pestana = "hoteles" | "restaurantes";

interface Props {
  lugares: Lugar[];
  presupuestoDiario?: number;
  mostrarHoteles: boolean; // true solo si el usuario pidió recomendaciones de hospedaje
  dia: number; // número del día activo (los restaurantes se muestran por día)
}

const dinero = (n: number) => `${MONEDA} ${n.toLocaleString("es-GT")}`;

export default function Recomendaciones({ lugares, presupuestoDiario, mostrarHoteles, dia }: Props) {
  const [pestana, setPestana] = useState<Pestana>("hoteles");
  const [verTodos, setVerTodos] = useState(false);

  const activa: Pestana = mostrarHoteles ? pestana : "restaurantes";
  const esHoteles = activa === "hoteles";
  const limites = limitesPresupuesto(presupuestoDiario);
  const limite = esHoteles ? limites.hotel : limites.comida;
  const hayLimite = Number.isFinite(limite);

  const delTipo = lugares
    .filter((l) => (esHoteles ? l.tipo === "hotel" : l.tipo === "restaurante" && l.dia === dia))
    .sort((a, b) => a.distanciaKm - b.distanciaKm);
  const dentro = delTipo.filter((l) => l.precio <= limite);
  const ocultos = delTipo.length - dentro.length;
  const visibles = verTodos ? delTipo : dentro;

  function cambiar(p: Pestana) {
    setPestana(p);
    setVerTodos(false);
  }

  const lista = (
    <ul
      className="lugares"
      {...(mostrarHoteles
        ? { id: "panel-reco", role: "tabpanel", "aria-labelledby": `tab-${activa}` }
        : {})}
    >
      {visibles.map((l) => (
        <li key={l.id} className="lugar">
          <div className="lugar-cab">
            <h4>{l.nombre}</h4>
            <span className="precio">
              {dinero(l.precio)} <small>/ {l.tipo === "hotel" ? "noche" : "persona"}</small>
            </span>
          </div>
          <p>{l.descripcion}</p>
          <ul className="lugar-meta">
            <li aria-label={`Calificación ${l.calificacion} de 5`}>
              <span className="estrella">★</span> {l.calificacion.toFixed(1)}
            </li>
            <li>a {l.distanciaKm.toFixed(1)} km {l.tipo === "hotel" ? "de tu ruta" : "de tus paradas"}</li>
            {hayLimite && l.precio > limite && <li className="etiqueta-presupuesto">Sobre tu presupuesto</li>}
          </ul>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="recomendaciones" aria-labelledby="t-reco">
      <h3 id="t-reco">{mostrarHoteles ? "Dónde dormir y comer" : "Dónde comer"}</h3>

      {mostrarHoteles && (
        <div className="dias" role="tablist" aria-label="Tipo de recomendación">
          <button type="button" role="tab" id="tab-hoteles" aria-selected={esHoteles} aria-controls="panel-reco" className="dia" onClick={() => cambiar("hoteles")}>
            Hoteles
          </button>
          <button type="button" role="tab" id="tab-restaurantes" aria-selected={!esHoteles} aria-controls="panel-reco" className="dia" onClick={() => cambiar("restaurantes")}>
            Restaurantes
          </button>
        </div>
      )}

      <p className="nota">
        {esHoteles ? "Cerca del centro de tu itinerario." : `Cerca de las paradas del día ${dia}.`}
        {hayLimite &&
          ` Filtrado por tu presupuesto de ${dinero(presupuestoDiario ?? 0)} al día: ${
            esHoteles ? "hoteles" : "comidas"
          } hasta ${dinero(limite)} por ${esHoteles ? "noche" : "persona"}.`}
      </p>

      {visibles.length > 0 ? (
        lista
      ) : (
        <p className="aviso-vacio" role="status">
          Ninguna opción entra en tu presupuesto. Puedes ver todas o subir tu presupuesto en el Paso 3.
        </p>
      )}

      {ocultos > 0 && (
        <button type="button" className="enlace" onClick={() => setVerTodos((v) => !v)}>
          {verTodos ? "Mostrar solo las de mi presupuesto" : `Ver también ${ocultos} sobre mi presupuesto`}
        </button>
      )}

      <p className="nota">Vista previa con datos de ejemplo mientras se conecta el backend.</p>
    </section>
  );
}
