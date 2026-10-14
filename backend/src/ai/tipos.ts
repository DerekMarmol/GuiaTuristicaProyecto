import type { HorarioLugar, Itinerario, Parada, Viaje } from "../../../shared/types";
import type { IntervaloHorario } from "./validacionEstancia";
import type { ResultadoHolgura } from "./tiempoService";

export interface LugarReal {
  placeId: string;
  nombre: string;
  lat: number;
  lng: number;
  horaApertura?: string;
  horaCierre?: string;
  categoria: string;
  precioEstimado?: number;
  direccion?: string | null;

  intervalosHorario?: IntervaloHorario[];
  horario?: HorarioLugar;
}

export type ViajeIA = Pick<
  Viaje,
  | "id"
  | "destino"
  | "tipoViaje"
  | "presupuesto"
  | "transporte"
  | "intereses"
  | "fechaInicio"
  | "fechaFin"
> & {
  presupuestoDiario?: number;
  hospedaje?: boolean;
  nombreHotel?: string;
  zonaHoraria?: string;
  horaInicio?: string;
};

export type ViajeValidacion = Pick<ViajeIA, "id" | "fechaInicio" | "fechaFin" | "zonaHoraria" | "horaInicio">;

export interface TrasladoEstimado extends ResultadoHolgura {
  estimado: true;
  metodo: "distancia_lineal";
  distanciaKm: number;
  velocidadKmh: number;
}

export type ParadaIA = Omit<Parada, "horaApertura" | "horaCierre"> & {
  placeId: string;
  motivo?: string;
  horaApertura?: string;
  horaCierre?: string;
  direccion?: string | null;
  horario?: HorarioLugar;
  llegada: string;
  salida: string;
  estadoEstancia: "completa" | "ajustada";
  traslado: TrasladoEstimado | null;
};

export type ItinerarioIA = Omit<Itinerario, "paradas"> & {
  paradas: ParadaIA[];
};

export type MotivoDescarte =
  | "cerrado"
  | "horario_no_publicado"
  | "horario_no_interpretable"
  | "error_consulta"
  | "apertura_desconocida"
  | "lugar_no_resuelto"
  | "tiempo_insuficiente";

export interface DescarteParada {
  numeroDia: number;
  fecha: string;
  placeId: string;
  nombre: string | null;
  motivo: MotivoDescarte;
  mensaje: string;
  llegada: string | null;
  horario: HorarioLugar | null;
}

export interface DiaSinParadas {
  numeroDia: number;
  fecha: string;
}

export interface ResultadoGeneracion {
  itinerarios: ItinerarioIA[];
  intentos: number;
  advertencias: string[];
  descartes: DescarteParada[];
  diasSinParadas: DiaSinParadas[];
}
