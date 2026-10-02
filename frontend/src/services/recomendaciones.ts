import type { Itinerario } from "../../../shared/types";
import type { ViajeBorrador } from "../context/ViajeContext";
import type { Lugar } from "../types/recomendacion";
import { centroide, distanciaKm } from "../utils/distancia";

export const PORCENTAJE_HOTEL = 0.4;
export const PORCENTAJE_COMIDA = 0.15;

export function limitesPresupuesto(presupuestoDiario?: number) {
  if (!presupuestoDiario) return { hotel: Infinity, comida: Infinity };
  return {
    hotel: Math.round(presupuestoDiario * PORCENTAJE_HOTEL),
    comida: Math.round(presupuestoDiario * PORCENTAJE_COMIDA),
  };
}

interface Plantilla {
  nombre: string;
  descripcion: string;
  precio: number;
  calificacion: number;
  dLat: number;
  dLng: number;
}

// Datos de ejemplo. Se reemplazan por los lugares reales cuando el backend esté listo.
const HOTELES: Plantilla[] = [
  { nombre: "Hotel Casa Colonial {d}", descripcion: "Patio interior y desayuno incluido.", precio: 420, calificacion: 4.7, dLat: 0.003, dLng: -0.002 },
  { nombre: "Posada del Centro", descripcion: "Habitaciones sencillas a pasos de la plaza.", precio: 160, calificacion: 4.3, dLat: -0.002, dLng: 0.003 },
  { nombre: "Hostal Viajero", descripcion: "Dormitorios y cuartos privados, ambiente social.", precio: 90, calificacion: 4.1, dLat: 0.004, dLng: 0.002 },
  { nombre: "Hotel Plaza Mayor", descripcion: "Servicio completo con restaurante y estacionamiento.", precio: 580, calificacion: 4.5, dLat: -0.004, dLng: -0.003 },
  { nombre: "Boutique Los Arcos", descripcion: "Diseño local y terraza con vista.", precio: 720, calificacion: 4.8, dLat: 0.001, dLng: -0.005 },
  { nombre: "Casa de Huéspedes Ana", descripcion: "Hospedaje familiar con cocina compartida.", precio: 130, calificacion: 4.4, dLat: -0.006, dLng: 0.001 },
];

const RESTAURANTES: Plantilla[] = [
  { nombre: "Comedor Doña Marta", descripcion: "Comida casera del día.", precio: 35, calificacion: 4.4, dLat: 0, dLng: 0 },
  { nombre: "Café del Parque", descripcion: "Desayunos y café de la región.", precio: 55, calificacion: 4.3, dLat: 0, dLng: 0 },
  { nombre: "Cocina Tradicional {d}", descripcion: "Platillos típicos en una casa colonial.", precio: 80, calificacion: 4.6, dLat: 0, dLng: 0 },
  { nombre: "Parrilla El Fogón", descripcion: "Carnes a la leña y guarniciones.", precio: 120, calificacion: 4.2, dLat: 0, dLng: 0 },
  { nombre: "Terraza Mirador", descripcion: "Cena con vista a la ciudad.", precio: 160, calificacion: 4.5, dLat: 0, dLng: 0 },
  { nombre: "Mesa Contemporánea", descripcion: "Menú de autor con ingredientes locales.", precio: 220, calificacion: 4.7, dLat: 0, dLng: 0 },
  { nombre: "Tacos y Antojitos", descripcion: "Antojitos para comer de paso.", precio: 28, calificacion: 4.0, dLat: 0, dLng: 0 },
  { nombre: "Pizzería de la Plaza", descripcion: "Pizza al horno de leña.", precio: 70, calificacion: 4.1, dLat: 0, dLng: 0 },
];

// Posiciones (en grados) alrededor del centro del día donde caen los restaurantes de ejemplo.
const OFFSETS_REST = [
  [0.0015, 0.001],
  [-0.0012, 0.002],
  [0.002, -0.0015],
  [-0.002, -0.001],
  [0.0008, 0.0028],
];
const RESTAURANTES_POR_DIA = OFFSETS_REST.length;

export function construirRecomendaciones(viaje: ViajeBorrador, itinerarios: Itinerario[]): Lugar[] {
  const destino = viaje.destino ?? "tu destino";
  const nombre = (t: string) => t.replace("{d}", destino);
  const todas = itinerarios.flatMap((it) => it.paradas);
  const centroViaje = centroide(todas);
  const lugares: Lugar[] = [];

  HOTELES.forEach((h, i) => {
    const punto = { lat: centroViaje.lat + h.dLat, lng: centroViaje.lng + h.dLng };
    lugares.push({
      id: `hotel-${i + 1}`,
      tipo: "hotel",
      nombre: nombre(h.nombre),
      descripcion: h.descripcion,
      ...punto,
      precio: h.precio,
      calificacion: h.calificacion,
      distanciaKm: distanciaKm(centroViaje, punto),
    });
  });

  itinerarios.forEach((it) => {
    const centroDia = centroide(it.paradas);
    for (let k = 0; k < RESTAURANTES_POR_DIA; k++) {
      const r = RESTAURANTES[((it.numeroDia - 1) * 3 + k) % RESTAURANTES.length];
      const punto = { lat: centroDia.lat + OFFSETS_REST[k][0], lng: centroDia.lng + OFFSETS_REST[k][1] };
      lugares.push({
        id: `rest-${it.numeroDia}-${k + 1}`,
        tipo: "restaurante",
        nombre: nombre(r.nombre),
        descripcion: r.descripcion,
        ...punto,
        precio: r.precio,
        calificacion: r.calificacion,
        distanciaKm: distanciaKm(centroDia, punto),
        dia: it.numeroDia,
      });
    }
  });

  return lugares;
}