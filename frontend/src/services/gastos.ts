import type { Itinerario, Parada } from "../../../shared/types";
import type { Gasto } from "../types/gasto";
// DATOS SIMULADOS.
// TODO(backend): sustituir por la llamada al endpoint de gastos reales.
// La forma de `Gasto` es la que el componente espera; ajustar aquí si el contrato cambia.

const PRESUPUESTO_DIARIO_POR_DEFECTO = 500;
const ENTRADAS_POR_DIA = 2;

// Categorías de Geoapify de lugares que suelen cobrar entrada. Parques, plazas, playas, monumentos,
// iglesias y restaurantes no la cobran, así que no se les simula una.
const CATEGORIAS_CON_ENTRADA = [
  "entertainment.museum",
  "entertainment.theme_park",
  "entertainment.water_park",
  "entertainment.activity_park",
  "entertainment.zoo",
  "entertainment.aquarium",
  "national_park",
  "heritage.unesco",
  "tourism.sights.archaeological_site",
];

function semilla(texto: string): number {
  return texto.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
}

// Geoapify marca algunos lugares con "fee" o "no_fee"; si no, se decide por su categoría.
export function cobraEntrada(parada: Pick<Parada, "categorias">): boolean {
  const categorias = parada.categorias ?? [];
  if (categorias.includes("no_fee")) return false;
  if (categorias.includes("fee")) return true;
  return categorias.some((c) => CATEGORIAS_CON_ENTRADA.some((p) => c === p || c.startsWith(`${p}.`)));
}

export function generarGastosSimulados(
  itinerarios: Itinerario[],
  presupuestoDiario: number = PRESUPUESTO_DIARIO_POR_DEFECTO
): Gasto[] {
  const gastos: Gasto[] = [];

  itinerarios.forEach((it) => {
    const factor = [0.45, 0.8, 1.1][semilla(it.id + it.numeroDia) % 3];
    const tope = presupuestoDiario * factor;
    const conEntrada = it.paradas.filter(cobraEntrada).slice(0, ENTRADAS_POR_DIA);
    const entrada = (parada: Parada | undefined): Omit<Gasto, "id" | "numeroDia">[] =>
      parada ? [{ categoria: "Entradas", descripcion: `Entrada a ${parada.nombre}`, monto: presupuestoDiario * 0.1 }] : [];

    const plantilla: Omit<Gasto, "id" | "numeroDia">[] = [
      { categoria: "Comida", descripcion: "Desayuno", monto: presupuestoDiario * 0.08 },
      { categoria: "Transporte", descripcion: "Traslados de la mañana", monto: presupuestoDiario * 0.12 },
      ...entrada(conEntrada[0]),
      { categoria: "Comida", descripcion: "Almuerzo", monto: presupuestoDiario * 0.2 },
      ...entrada(conEntrada[1]),
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