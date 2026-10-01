import { useState, type FormEvent } from "react";
import type { Viaje } from "../../../shared/types";
import { useViaje } from "../context/ViajeContext";
import Stepper from "../components/Stepper";
import { diasDeViaje, fechaCorta } from "../utils/fechas";
import "./pasos.css";

const MONEDA = "Q"; 

const TIPOS: { valor: Viaje["tipoViaje"]; texto: string }[] = [
  { valor: "solo", texto: "Solo" },
  { valor: "pareja", texto: "En pareja" },
  { valor: "familia", texto: "En familia" },
  { valor: "amigos", texto: "Con amigos" },
];

const TRANSPORTES: { valor: Viaje["transporte"]; texto: string }[] = [
  { valor: "A pie", texto: "A pie" },
  { valor: "Transporte Publico", texto: "Transporte público" },
  { valor: "Automovil", texto: "Automóvil" },
  { valor: "Moto", texto: "Moto" },
  { valor: "Transporte Aereo", texto: "Transporte aéreo" },
];

const INTERESES = [
  "Cultura", "Historia", "Gastronomía", "Naturaleza", "Aventura",
  "Compras", "Vida nocturna", "Playa", "Fotografía", "Arte",
];

const MODULOS: { id: string; nombre: string; detalle: string }[] = [
  { id: "clima", nombre: "Reordenar por clima", detalle: "Ajusta el orden de las paradas si el pronóstico lo pide." },
  { id: "abiertoAhora", nombre: "Modo «Abierto ahora»", detalle: "Prioriza lugares que estén abiertos en este momento." },
  { id: "chat", nombre: "Asistente en ruta", detalle: "Un chat para pedir cambios mientras viajas." },
  { id: "presupuesto", nombre: "Panel de presupuesto", detalle: "Compara tus gastos con lo que planeaste." },
  { id: "memoria", nombre: "Modo Memoria", detalle: "Un resumen diario de tu viaje." },
];

interface Errores {
  tipo?: string;
  presupuesto?: string;
  transporte?: string;
  intereses?: string;
}

export default function Paso3Contexto() {
  const { viaje, actualizarViaje, irAPaso } = useViaje();
  const dias = diasDeViaje(viaje.fechaInicio, viaje.fechaFin);

  const [tipo, setTipo] = useState<Viaje["tipoViaje"] | "">(viaje.tipoViaje ?? "");
  const [diario, setDiario] = useState(viaje.presupuestoDiario ? String(viaje.presupuestoDiario) : "");
  const [transporte, setTransporte] = useState<Viaje["transporte"] | "">(viaje.transporte ?? "");
  const [intereses, setIntereses] = useState<string[]>(viaje.intereses ?? []);
  const [modulos, setModulos] = useState<string[]>(viaje.modulos ?? []);
  const [errores, setErrores] = useState<Errores>({});

  const montoDiario = Number(diario);
  const montoValido = Number.isFinite(montoDiario) && montoDiario > 0;

  function alternar(lista: string[], valor: string) {
    return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e: Errores = {};
    if (!tipo) e.tipo = "Elige con quién viajas.";
    if (!montoValido) e.presupuesto = "Escribe un presupuesto diario mayor que 0.";
    if (!transporte) e.transporte = "Elige cómo te moverás.";
    if (intereses.length === 0) e.intereses = "Elige al menos un interés.";
    setErrores(e);
    if (Object.keys(e).length > 0) return;

    actualizarViaje({
      tipoViaje: tipo as Viaje["tipoViaje"],
      presupuestoDiario: montoDiario,
      presupuesto: montoDiario * dias, // el modelo compartido guarda el total del viaje
      transporte: transporte as Viaje["transporte"],
      intereses,
      modulos,
    });
    irAPaso(4);
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <Stepper actual={3} />
      <h2>Cuéntanos cómo será tu viaje</h2>

      <p className="duracion">
        Duración: <b>{dias} {dias === 1 ? "día" : "días"}</b> ({fechaCorta(viaje.fechaInicio)} al {fechaCorta(viaje.fechaFin)})
      </p>

      <fieldset className="grupo">
        <legend>¿Con quién viajas?</legend>
        <div className="chips">
          {TIPOS.map((t) => (
            <label key={t.valor} className="chip">
              <input
                type="radio"
                name="tipoViaje"
                value={t.valor}
                checked={tipo === t.valor}
                onChange={() => { setTipo(t.valor); setErrores((x) => ({ ...x, tipo: undefined })); }}
              />
              {t.texto}
            </label>
          ))}
        </div>
        {errores.tipo && <p className="error" role="alert">{errores.tipo}</p>}
      </fieldset>

      <label htmlFor="presupuestoDiario">Presupuesto diario aproximado</label>
      <div className="prefijo">
        <span aria-hidden="true">{MONEDA}</span>
        <input
          id="presupuestoDiario"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="Ej. 500"
          value={diario}
          onChange={(e) => { setDiario(e.target.value); setErrores((x) => ({ ...x, presupuesto: undefined })); }}
          aria-invalid={!!errores.presupuesto}
        />
      </div>
      {errores.presupuesto && <p className="error" role="alert">{errores.presupuesto}</p>}
      {montoValido && (
        <p className="total">
          Total estimado: <b>{MONEDA} {(montoDiario * dias).toLocaleString("es-GT")}</b> por {dias} {dias === 1 ? "día" : "días"}
        </p>
      )}

      <fieldset className="grupo">
        <legend>¿Cómo te moverás?</legend>
        <div className="chips">
          {TRANSPORTES.map((t) => (
            <label key={t.valor} className="chip">
              <input
                type="radio"
                name="transporte"
                value={t.valor}
                checked={transporte === t.valor}
                onChange={() => { setTransporte(t.valor); setErrores((x) => ({ ...x, transporte: undefined })); }}
              />
              {t.texto}
            </label>
          ))}
        </div>
        {errores.transporte && <p className="error" role="alert">{errores.transporte}</p>}
      </fieldset>

      <fieldset className="grupo">
        <legend>¿Qué te interesa? (elige varios)</legend>
        <div className="chips">
          {INTERESES.map((i) => (
            <label key={i} className="chip">
              <input
                type="checkbox"
                checked={intereses.includes(i)}
                onChange={() => { setIntereses((l) => alternar(l, i)); setErrores((x) => ({ ...x, intereses: undefined })); }}
              />
              {i}
            </label>
          ))}
        </div>
        {errores.intereses && <p className="error" role="alert">{errores.intereses}</p>}
      </fieldset>

      <fieldset className="grupo">
        <legend>Módulos opcionales</legend>
        <div className="opciones">
          {MODULOS.map((m) => (
            <label key={m.id} className="opcion casilla">
              <input
                type="checkbox"
                checked={modulos.includes(m.id)}
                onChange={() => setModulos((l) => alternar(l, m.id))}
              />
              {m.nombre}
              <small>{m.detalle}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="acciones">
        <button type="button" className="btn-secundario" onClick={() => irAPaso(2)}>Atrás</button>
        <button type="submit" className="btn-primario">Siguiente</button>
      </div>
    </form>
  );
}