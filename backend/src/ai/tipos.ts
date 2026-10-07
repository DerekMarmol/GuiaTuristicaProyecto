import type { Itinerario, Parada, Viaje } from "../../../shared/types";

/**
 * Lugar REAL obtenido de una API externa (Google Places, que integra Ana Laura).
 * Es la única fuente de verdad: la IA nunca inventa nombre, coordenadas ni horarios.
 */
export interface LugarReal {
  placeId: string;
  nombre: string;
  lat: number;
  lng: number;
  horaApertura: string; // "HH:MM"
  horaCierre: string; // "HH:MM"
  categoria: string; // debe coincidir con los intereses del Viaje (ej. "Cultura")
  precioEstimado?: number; // en quetzales, por persona
}

/** Datos del viaje que necesita la IA. */
export type ViajeIA = Pick<
  Viaje,
  "id" | "destino" | "tipoViaje" | "presupuesto" | "transporte" | "intereses" | "fechaInicio" | "fechaFin"
> & {
  presupuestoDiario?: number;
  hospedaje?: boolean;
  nombreHotel?: string;
};

/**
 * Parada del shared/types + placeId.
 * PROPUESTA AL EQUIPO: agregar `placeId?: string` a Parada en shared/types y en schema.prisma.
 */
export type ParadaIA = Parada & { placeId: string; motivo?: string };
export type ItinerarioIA = Omit<Itinerario, "paradas"> & { paradas: ParadaIA[] };

export interface ResultadoGeneracion {
  itinerarios: ItinerarioIA[];
  intentos: number;
  /** Avisos de paradas que la IA propuso y se descartaron por no ser válidas. */
  advertencias: string[];
}
