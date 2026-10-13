import type { Itinerario, Parada, Viaje } from "../../../shared/types";


export interface LugarReal {
  placeId: string;
  nombre: string;
  lat: number;
  lng: number;
  horaApertura: string; 
  horaCierre: string; 
  categoria: string; 
  precioEstimado?: number; 
}

export type ViajeIA = Pick<
  Viaje,
  "id" | "destino" | "tipoViaje" | "presupuesto" | "transporte" | "intereses" | "fechaInicio" | "fechaFin"
> & {
  presupuestoDiario?: number;
  hospedaje?: boolean;
  nombreHotel?: string;
};


export type ParadaIA = Parada & { placeId: string; motivo?: string };
export type ItinerarioIA = Omit<Itinerario, "paradas"> & { paradas: ParadaIA[] };

export interface ResultadoGeneracion {
  itinerarios: ItinerarioIA[];
  intentos: number;

  advertencias: string[];
}
