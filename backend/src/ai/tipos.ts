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
  // Bajo techo o al aire libre: con lluvia el plan prefiere los lugares bajo techo.
  tipoEntorno?: "indoor" | "outdoor";
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
  // Contexto del momento en que se genera: desde dónde sale el viajero, a qué hora puede empezar el
  // primer día (si el viaje es hoy) y qué días se espera lluvia.
  origen?: { lat: number; lng: number };
  horaInicioPrimerDia?: string;
  diasConLluvia?: { numeroDia: number; lluviaMm: number }[];
  // Nombres de los lugares del plan anterior, cuando el viajero pidió otro (Regenerar).
  lugaresAEvitar?: string[];
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
