export function aMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

export function diasEntre(inicio: string, fin: string): number {
  const [a1, m1, d1] = inicio.split("-").map(Number);
  const [a2, m2, d2] = fin.split("-").map(Number);
  const ms = Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function sumarDias(inicio: string, n: number): string {
  const [a, m, d] = inicio.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + n));
  return f.toISOString().slice(0, 10);
}
