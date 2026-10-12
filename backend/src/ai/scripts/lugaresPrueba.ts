import type { LugarReal, ViajeIA } from "../tipos";

// DATOS DE PRUEBA (horarios aproximados, no oficiales). Se reemplazan por Google Places (Ana Laura).
export const LUGARES_PRUEBA: LugarReal[] = [
  { placeId: "test_palacio", nombre: "Palacio Nacional de la Cultura", lat: 14.6417, lng: -90.5133, horaApertura: "09:00", horaCierre: "16:00", categoria: "Historia", precioEstimado: 60 },
  { placeId: "test_catedral", nombre: "Catedral Metropolitana", lat: 14.6414, lng: -90.5130, horaApertura: "08:00", horaCierre: "18:00", categoria: "Historia", precioEstimado: 0 },
  { placeId: "test_popolvuh", nombre: "Museo Popol Vuh", lat: 14.6045, lng: -90.4895, horaApertura: "09:00", horaCierre: "17:00", categoria: "Cultura", precioEstimado: 50 },
  { placeId: "test_ixchel", nombre: "Museo Ixchel del Traje Indígena", lat: 14.6044, lng: -90.4893, horaApertura: "09:00", horaCierre: "17:00", categoria: "Cultura", precioEstimado: 55 },
  { placeId: "test_mercado", nombre: "Mercado Central", lat: 14.6402, lng: -90.5125, horaApertura: "07:00", horaCierre: "17:00", categoria: "Compras", precioEstimado: 40 },
  { placeId: "test_artesanias", nombre: "Mercado de Artesanías", lat: 14.5890, lng: -90.5230, horaApertura: "09:00", horaCierre: "18:00", categoria: "Compras", precioEstimado: 80 },
  { placeId: "test_carmen", nombre: "Cerro del Carmen", lat: 14.6380, lng: -90.5160, horaApertura: "08:00", horaCierre: "17:00", categoria: "Fotografía", precioEstimado: 0 },
  { placeId: "test_cafe", nombre: "Café de la Zona 1", lat: 14.6420, lng: -90.5110, horaApertura: "07:00", horaCierre: "20:00", categoria: "Gastronomía", precioEstimado: 70 },
  { placeId: "test_fonda", nombre: "Fonda de comida típica", lat: 14.6395, lng: -90.5140, horaApertura: "11:00", horaCierre: "21:00", categoria: "Gastronomía", precioEstimado: 90 },
  { placeId: "test_parque", nombre: "Parque Ecológico", lat: 14.6120, lng: -90.5300, horaApertura: "07:00", horaCierre: "17:00", categoria: "Naturaleza", precioEstimado: 25 },
];

export const VIAJE_PRUEBA: ViajeIA = {
  id: "viaje-prueba",
  destino: "Ciudad de Guatemala",
  tipoViaje: "pareja",
  presupuesto: 1500,
  presupuestoDiario: 500,
  transporte: "Automovil",
  intereses: ["Historia", "Cultura", "Gastronomía"],
  fechaInicio: "2026-11-10",
  fechaFin: "2026-11-11",
};
