import type { EstadoPronosticoDiario } from "./clima";

export type TipoEntorno = "indoor" | "outdoor";

export type SensibilidadClima = "baja" | "media" | "alta";

export interface ClasificacionClima {
  tipo_entorno: TipoEntorno;
  sensibilidad_clima: SensibilidadClima;
  regla_clima: string | null;
}

export type EstadoPronosticoPrioridad = EstadoPronosticoDiario | "error_consulta";

export type MotivoPrioridadClima =
  | "lluvia_pronosticada"
  | "sin_lluvia_pronosticada"
  | "sin_lluvia_en_cobertura_parcial"
  | "pronostico_fuera_de_cobertura"
  | "pronostico_sin_datos"
  | "consulta_clima_fallida";

export interface DecisionClimaDia {
  numeroDia: number;
  fecha: string;
  estadoPronostico: EstadoPronosticoPrioridad;
  lluviaMm: number | null;
  prioridadAplicada: boolean;
  ordenModificado: boolean;
  motivo: MotivoPrioridadClima;
  mensaje: string;
}

export type ConsultaClimaPrioridad =
  | { estado: "completada" }
  | { estado: "fallida"; codigo: string; mensaje: string };

export interface ResumenPrioridadClima {
  fuente: "openweathermap";
  ubicacion: { lat: number; lng: number };
  consulta: ConsultaClimaPrioridad;
  dias: DecisionClimaDia[];
}
