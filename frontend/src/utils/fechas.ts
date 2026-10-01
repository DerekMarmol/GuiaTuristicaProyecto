// Convierte "AAAA-MM-DD" en una fecha local (sin desfase por zona horaria).
function aFechaLocal(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

// Número de días del viaje, contando el día de inicio y el de fin.
export function diasDeViaje(inicio?: string, fin?: string): number {
  if (!inicio || !fin) return 1;
  const ms = aFechaLocal(fin).getTime() - aFechaLocal(inicio).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// Fecha corta legible, por ejemplo "10 may".
export function fechaCorta(iso?: string): string {
  if (!iso) return "";
  return aFechaLocal(iso).toLocaleDateString("es-GT", { day: "numeric", month: "short" }).replace(".", "");
}