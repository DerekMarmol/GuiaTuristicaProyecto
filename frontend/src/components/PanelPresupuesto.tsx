import { useState, type FormEvent } from "react";
import { CATEGORIAS_GASTO, type CategoriaGasto, type Gasto } from "../types/gasto";

const MONEDA = "Q";

interface Props {
  numeroDia: number;
  presupuestoDiario: number;
  gastosDelDia: Gasto[];
  totalGastadoViaje: number;
  presupuestoTotal?: number;
  onAgregar: (g: Omit<Gasto, "id">) => void;
  onEliminar: (id: string) => void;
}

const fmt = (n: number) => `${MONEDA} ${Math.round(n).toLocaleString("es-GT")}`;

export default function PanelPresupuesto({
  numeroDia,
  presupuestoDiario,
  gastosDelDia,
  totalGastadoViaje,
  presupuestoTotal,
  onAgregar,
  onEliminar,
}: Props) {
  const [categoria, setCategoria] = useState<CategoriaGasto>("Comida");
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const [error, setError] = useState("");

  const gastado = gastosDelDia.reduce((s, g) => s + g.monto, 0);
  const restante = presupuestoDiario - gastado;
  const porcentaje = presupuestoDiario > 0 ? (gastado / presupuestoDiario) * 100 : 0;
  const estado = porcentaje > 100 ? "excedido" : porcentaje >= 80 ? "cerca" : "ok";

  const mensaje =
    estado === "excedido"
      ? `Te pasaste del presupuesto del día por ${fmt(-restante)}.`
      : estado === "cerca"
      ? `Cuidado: ya usaste el ${Math.round(porcentaje)}% del día. Te quedan ${fmt(restante)}.`
      : `Vas bien: te quedan ${fmt(restante)} para hoy.`;

  const porCategoria = CATEGORIAS_GASTO.map((c) => ({
    categoria: c,
    total: gastosDelDia.filter((g) => g.categoria === c).reduce((s, g) => s + g.monto, 0),
  })).filter((c) => c.total > 0);

  function agregar(ev: FormEvent) {
    ev.preventDefault();
    const valor = Number(monto);
    if (!Number.isFinite(valor) || valor <= 0) {
      setError("Escribe un monto mayor que 0.");
      return;
    }
    onAgregar({
      numeroDia,
      categoria,
      descripcion: descripcion.trim() || categoria,
      monto: Math.round(valor * 100) / 100,
    });
    setMonto("");
    setDescripcion("");
    setError("");
  }

  return (
    <section className="presupuesto" aria-labelledby="t-presupuesto">
      <h3 id="t-presupuesto">Presupuesto del día {numeroDia}</h3>

      <div className="pres-cifras">
        <div>
          <small>Gastado</small>
          <strong>{fmt(gastado)}</strong>
        </div>
        <div>
          <small>Presupuesto</small>
          <strong>{fmt(presupuestoDiario)}</strong>
        </div>
        <div className={`pres-restante ${estado}`}>
          <small>{restante >= 0 ? "Disponible" : "Excedido"}</small>
          <strong>{fmt(Math.abs(restante))}</strong>
        </div>
      </div>

      <div
        className={`pres-barra ${estado}`}
        role="progressbar"
        aria-label="Gasto del día frente al presupuesto diario"
        aria-valuemin={0}
        aria-valuemax={presupuestoDiario}
        aria-valuenow={Math.min(Math.round(gastado), presupuestoDiario)}
        aria-valuetext={`${fmt(gastado)} de ${fmt(presupuestoDiario)}`}
      >
        <div className="pres-relleno" style={{ width: `${Math.min(porcentaje, 100)}%` }} />
      </div>
      <p className={`pres-mensaje ${estado}`} role="status">{mensaje}</p>

      {porCategoria.length > 0 && (
        <ul className="pres-categorias" aria-label="Gasto por categoría">
          {porCategoria.map((c) => (
            <li key={c.categoria}>
              <span>{c.categoria}</span>
              <div className="pres-mini" aria-hidden="true">
                <div style={{ width: `${(c.total / gastado) * 100}%` }} />
              </div>
              <strong>{fmt(c.total)}</strong>
            </li>
          ))}
        </ul>
      )}

      {gastosDelDia.length === 0 ? (
        <p className="aviso-vacio">Aún no registras gastos este día. Anota abajo lo que vayas gastando para compararlo con tu presupuesto.</p>
      ) : (
        <ul className="pres-gastos" aria-label="Gastos del día">
          {gastosDelDia.map((g) => (
            <li key={g.id}>
              <div>
                <span>{g.descripcion}</span>
                <small>{g.categoria}</small>
              </div>
              <strong>{fmt(g.monto)}</strong>
              <button
                type="button"
                className="pres-quitar"
                aria-label={`Quitar gasto ${g.descripcion}`}
                onClick={() => onEliminar(g.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="pres-form" onSubmit={agregar} noValidate>
        <p className="pres-form-titulo">Registrar un gasto</p>
        <div className="pres-form-fila">
          <label htmlFor="g-cat">Categoría</label>
          <select id="g-cat" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaGasto)}>
            {CATEGORIAS_GASTO.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="pres-form-fila">
          <label htmlFor="g-desc">Descripción (opcional)</label>
          <input id="g-desc" type="text" maxLength={60} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Tacos en el mercado" />
        </div>
        <div className="pres-form-fila">
          <label htmlFor="g-monto">Monto ({MONEDA})</label>
          <input
            id="g-monto"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={monto}
            onChange={(e) => { setMonto(e.target.value); setError(""); }}
            aria-invalid={!!error}
          />
        </div>
        {error && <p className="aviso-error" role="alert">{error}</p>}
        <button type="submit" className="btn-secundario">Agregar gasto</button>
      </form>

      <p className="nota">
        Total del viaje: <b>{fmt(totalGastadoViaje)}</b>
        {presupuestoTotal !== undefined && <> de {fmt(presupuestoTotal)}</>}.
      </p>
    </section>
  );
}