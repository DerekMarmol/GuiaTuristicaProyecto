export const ETIQUETAS_EXPERIENCIA = [
  "Vale la pena",
  "Muy concurrido",
  "Buen precio",
  "Caro",
  "Buen servicio",
  "Ideal para fotos",
  "Familiar",
  "Tranquilo",
  "Volvería",
] as const;

export type EtiquetaExperiencia = (typeof ETIQUETAS_EXPERIENCIA)[number];

export interface Calificacion {
  paradaId: string;
  estrellas: 1 | 2 | 3 | 4 | 5;
  etiquetas: EtiquetaExperiencia[];
  comentario?: string;
  fecha: string; // ISO
}