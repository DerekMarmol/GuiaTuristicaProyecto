// Gasto registrado durante el viaje (panel de presupuesto).
// TODO(backend): reemplazar por el endpoint real de gastos
// (GET/POST/DELETE) cuando esté disponible.

export const CATEGORIAS_GASTO = ["Comida", "Transporte", "Entradas", "Compras", "Otros"] as const;

export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export interface Gasto {
  id: string;
  numeroDia: number;
  categoria: CategoriaGasto;
  descripcion: string;
  monto: number; 
}