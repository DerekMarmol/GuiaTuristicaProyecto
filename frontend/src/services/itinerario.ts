import type { Itinerario, Parada } from "../../../shared/types";
import type { ViajeBorrador } from "../context/ViajeContext";
import { diasDeViaje } from "../utils/fechas";

export const PASOS_GENERACION = [
  "Buscando lugares según tus intereses",
  "Validando horarios de apertura",
  "Ordenando la ruta más corta",
  "Armando tu itinerario",
];

interface Plantilla {
  nombre: string;
  apertura: string;
  cierre: string;
  estancia: number;
}

// Datos de ejemplo por interés. Se reemplazan por los lugares reales cuando el backend esté listo.
const LUGARES: Record<string, Plantilla[]> = {
  Cultura: [
    { nombre: "Museo de arte de {d}", apertura: "09:00", cierre: "17:00", estancia: 90 },
    { nombre: "Casa de la cultura de {d}", apertura: "09:00", cierre: "16:00", estancia: 60 },
  ],
  Historia: [
    { nombre: "Centro histórico de {d}", apertura: "08:00", cierre: "18:00", estancia: 75 },
    { nombre: "Catedral de {d}", apertura: "08:00", cierre: "17:00", estancia: 45 },
  ],
  Gastronomía: [
    { nombre: "Mercado de comida típica", apertura: "07:00", cierre: "15:00", estancia: 60 },
    { nombre: "Restaurante tradicional", apertura: "12:00", cierre: "21:00", estancia: 80 },
  ],
  Naturaleza: [
    { nombre: "Mirador natural", apertura: "06:00", cierre: "18:00", estancia: 60 },
    { nombre: "Parque ecológico", apertura: "07:00", cierre: "17:00", estancia: 120 },
  ],
  Aventura: [
    { nombre: "Ruta de senderismo", apertura: "06:00", cierre: "16:00", estancia: 150 },
    { nombre: "Tirolesa y cuerdas", apertura: "08:00", cierre: "16:00", estancia: 120 },
  ],
  Compras: [
    { nombre: "Mercado de artesanías", apertura: "09:00", cierre: "19:00", estancia: 70 },
    { nombre: "Tienda de productos locales", apertura: "10:00", cierre: "19:00", estancia: 40 },
  ],
  "Vida nocturna": [
    { nombre: "Bar con música en vivo", apertura: "18:00", cierre: "23:59", estancia: 120 },
    { nombre: "Terraza con vista nocturna", apertura: "18:00", cierre: "23:00", estancia: 90 },
  ],
  Playa: [
    { nombre: "Playa principal", apertura: "08:00", cierre: "18:00", estancia: 120 },
    { nombre: "Muelle y puesta de sol", apertura: "16:00", cierre: "19:30", estancia: 60 },
  ],
  Fotografía: [
    { nombre: "Punto panorámico para fotos", apertura: "05:30", cierre: "18:30", estancia: 45 },
    { nombre: "Calles coloridas de {d}", apertura: "07:00", cierre: "19:00", estancia: 60 },
  ],
  Arte: [
    { nombre: "Galería de arte contemporáneo", apertura: "10:00", cierre: "18:00", estancia: 60 },
    { nombre: "Taller de artesanos", apertura: "09:00", cierre: "17:00", estancia: 60 },
  ],
};

const MAX_DIAS = 14;
const PARADAS_POR_DIA = 3;
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sumarDias(inicio: string, n: number): string {
  const [a, m, d] = inicio.split("-").map(Number);
  const f = new Date(a, m - 1, d + n);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

function construirItinerarios(viaje: ViajeBorrador): Itinerario[] {
  const dias = Math.min(diasDeViaje(viaje.fechaInicio, viaje.fechaFin), MAX_DIAS);
  const intereses = viaje.intereses && viaje.intereses.length > 0 ? viaje.intereses : ["Cultura"];
  const destino = viaje.destino ?? "tu destino";

  // Mezcla los lugares de todos los intereses para que cada día tenga variedad.
  const pool: Plantilla[] = [];
  const maxLargo = Math.max(...intereses.map((i) => (LUGARES[i] ?? []).length));
  for (let k = 0; k < maxLargo; k++) {
    for (const i of intereses) if (LUGARES[i]?.[k]) pool.push(LUGARES[i][k]);
  }

  return Array.from({ length: dias }, (_, dia) => {
    const elegidas = Array.from({ length: PARADAS_POR_DIA }, (_, k) => pool[(dia * PARADAS_POR_DIA + k) % pool.length]);
    // Los lugares nocturnos van al final del día.
    elegidas.sort((a, b) => Number(a.apertura >= "17:00") - Number(b.apertura >= "17:00"));
    const paradas: Parada[] = elegidas.map((p, k) => ({
      id: `p${dia + 1}-${k + 1}`,
      nombre: p.nombre.replace("{d}", destino),
      lat: 14.6349 + dia * 0.004 + k * 0.0021,
      lng: -90.5069 - dia * 0.002 + k * 0.003,
      horaApertura: p.apertura,
      horaCierre: p.cierre,
      tiempoEstanciaMinutos: p.estancia,
    }));
    return {
      id: `it-${dia + 1}`,
      viajeId: "viaje-demo",
      numeroDia: dia + 1,
      fecha: sumarDias(viaje.fechaInicio ?? "2030-01-01", dia),
      paradas,
    };
  });
}

export async function generarItinerario(
  viaje: ViajeBorrador,
  onProgreso?: (pasosListos: number) => void
): Promise<Itinerario[]> {
  if (!navigator.onLine) {
    throw new Error("Sin conexión. Conéctate a internet para generar tu itinerario.");
  }
  for (let i = 0; i < PASOS_GENERACION.length; i++) {
    await pausa(750);
    onProgreso?.(i + 1);
  }
  return construirItinerarios(viaje);
}