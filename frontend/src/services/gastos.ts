import type { Itinerario } from "../../../shared/types";
import type { Gasto } from "../types/gasto";
// DATOS SIMULADOS.
// TODO(backend): sustituir por la llamada al endpoint de gastos reales.
// La forma de `Gasto` es la que el componente espera; ajustar aquí si el contrato cambia.

const PRESUPUESTO_DIARIO_POR_DEFECTO = 500;

function semilla(texto: string): number {
  return texto.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
}

export function generarGastosSimulados(
  itinerarios: Itinerario[],
  presupuestoDiario: number = PRESUPUESTO_DIARIO_POR_DEFECTO
): Gasto[] {
  const gastos: Gasto[] = [];

  itinerarios.forEach((it) => {
    const factor = [0.45, 0.8, 1.1][semilla(it.id + it.numeroDia) % 3];
    const tope = presupuestoDiario * factor;

    const plantilla: Omit<Gasto, "id" | "numeroDia">[] = [
      { categoria: "Comida", descripcion: "Desayuno", monto: presupuestoDiario * 0.08 },
      { categoria: "Transporte", descripcion: "Traslados de la mañana", monto: presupuestoDiario * 0.12 },
      { categoria: "Entradas", descripcion: `Entrada a ${it.paradas[0]?.nombre ?? "primera parada"}`, monto: presupuestoDiario * 0.1 },
      { categoria: "Comida", descripcion: "Almuerzo", monto: presupuestoDiario * 0.2 },
      { categoria: "Entradas", descripcion: `Entrada a ${it.paradas[1]?.nombre ?? "segunda parada"}`, monto: presupuestoDiario * 0.1 },
      { categoria: "Compras", descripcion: "Artesanías", monto: presupuestoDiario * 0.15 },
      { categoria: "Comida", descripcion: "Cena", monto: presupuestoDiario * 0.2 },
    ];

    let acumulado = 0;
    plantilla.forEach((g, i) => {
      const monto = Math.round(g.monto);
      if (acumulado + monto > tope) return;
      acumulado += monto;
      gastos.push({ ...g, monto, id: `${it.id}-g${i}`, numeroDia: it.numeroDia });
    });
  });

  return gastos;
}