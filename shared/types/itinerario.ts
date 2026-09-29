import { Parada } from "./parada";

export interface Itinerario {
  id: string;
  viajeId: string;
  numeroDia: number;
  fecha: string;
  paradas: Parada[];
}