import type { Parada } from "../../../shared/types";

// "09:30" -> 570 minutos desde medianoche.
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// 570 -> "09:30".
export function formatoHora(minutos: number): string {
  const h = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Calcula a qué hora empieza y termina cada parada de un día, respetando la hora de
// apertura y dejando un margen de traslado entre una parada y la siguiente.
export function calcularHorarios(paradas: Parada[], inicioDia = "09:00", traslado = 30) {
  let cursor = aMinutos(inicioDia);
  return paradas.map((p) => {
    const inicio = Math.max(cursor, aMinutos(p.horaApertura));
    const fin = inicio + p.tiempoEstanciaMinutos;
    cursor = fin + traslado;
    return { inicio: formatoHora(inicio), fin: formatoHora(fin) };
  });
}