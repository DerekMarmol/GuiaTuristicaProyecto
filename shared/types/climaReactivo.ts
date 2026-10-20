import type { SensibilidadClima, TipoEntorno } from "./entornoClima";
import type { EstadoHorario } from "./lugarInteres";
import type { Parada } from "./parada";
import type { ModoTransporteRuta } from "./viaje";

export type EstadoParadaItinerario = "completada" | "en_curso" | "pendiente" | "cancelada";

export interface ParadaItinerarioActivo {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  horaApertura: string;
  horaCierre: string;
  tiempoEstanciaMinutos: number;
  estado: EstadoParadaItinerario;
  placeId?: string;
  categorias?: string[];
  tipo_entorno?: TipoEntorno;
  sensibilidad_clima?: SensibilidadClima;
  horaFinProgramada?: string;
}

export interface ItinerarioActivo {
  id: string;
  fecha: string;
  paradas: ParadaItinerarioActivo[];
}

export interface UbicacionCompartida {
  lat: number;
  lng: number;
  registradaEn: string;
}

export type NivelRiesgoClima = "favorable" | "lluvia_ligera" | "riesgo_elevado" | "lluvia_significativa" | "tormenta";

export interface ReferenciaClima {
  nivel: NivelRiesgoClima;
  eventoId: string | null;
  evaluadoEn: string;
  nivelNotificado: NivelRiesgoClima | null;
  ultimaPropuestaEn: string | null;
}

export interface SolicitudClimaReactivo {
  itinerario: ItinerarioActivo;
  modoTransporte?: ModoTransporteRuta;
  ubicacionActual?: UbicacionCompartida;
  intereses?: string[];
  referencia?: ReferenciaClima | null;
}

export type CondicionClima =
  | "despejado_o_nublado"
  | "llovizna"
  | "lluvia_ligera"
  | "lluvia_moderada"
  | "lluvia_intensa"
  | "tormenta"
  | "otra";

export interface SenalClima {
  origen: "observado" | "pronosticado";
  nivel: NivelRiesgoClima;
  condicion: CondicionClima;
  codigoOpenWeather: number | null;
  descripcion: string | null;
  desde: string;
  hasta: string;
  probabilidadPrecipitacion: number | null;
  lluviaMm: number | null;
  periodoLluviaHoras: 1 | 3 | null;
}

export type FuenteUbicacionClima = "ubicacion_compartida" | "parada_en_curso" | "proxima_parada";

export interface ErrorFuenteClima {
  codigo: string;
  mensaje: string;
}

export interface EvaluacionClima {
  fuente: "openweathermap";
  ubicacion: { lat: number; lng: number; fuente: FuenteUbicacionClima };
  consultadoEn: string;
  observacion: {
    estado: "vigente" | "obsoleta" | "no_disponible";
    observadaEn: string | null;
    senal: SenalClima | null;
    error: ErrorFuenteClima | null;
  };
  pronostico: {
    estado: "disponible" | "sin_cobertura" | "no_disponible";
    senales: SenalClima[];
    error: ErrorFuenteClima | null;
  };
  nivel: NivelRiesgoClima | null;
  senalPrincipal: SenalClima | null;
  eventoId: string | null;
  umbrales: {
    probabilidadPrecipitacion: number;
    lluvia1hMm: number;
    lluvia3hMm: number;
    horizonteHoras: number;
  };
}

export type EstadoMonitoreoClima = "activo" | "itinerario_no_activo" | "sin_paradas_pendientes";

export type MotivoDecisionClima =
  | "empeoramiento_detectado"
  | "sin_riesgo_relevante"
  | "evento_ya_notificado"
  | "sin_empeoramiento"
  | "espera_entre_propuestas"
  | "datos_insuficientes"
  | "itinerario_no_activo"
  | "sin_paradas_pendientes";

export interface AdvertenciaClimaReactivo {
  codigo: string;
  mensaje: string;
}

export interface RespuestaEvaluacionClima {
  estado: EstadoMonitoreoClima;
  evaluacion: EvaluacionClima | null;
  requierePropuesta: boolean;
  motivo: MotivoDecisionClima;
  mensaje: string;
  referencia: ReferenciaClima | null;
  proximaEvaluacionSegundos: number;
  advertencias: AdvertenciaClimaReactivo[];
}

export type FuenteClasificacionParada = "itinerario" | "categorias" | "supuesta";

export interface ParadaAfectada {
  paradaId: string;
  nombre: string;
  inicioEstimado: string | null;
  finEstimado: string | null;
  clasificacion: { tipo_entorno: TipoEntorno; sensibilidad_clima: SensibilidadClima; fuente: FuenteClasificacionParada };
  senal: Pick<SenalClima, "origen" | "nivel" | "condicion" | "desde" | "hasta">;
  analizada: boolean;
  motivo: string;
}

export type DisponibilidadAlternativa = "confirmada" | "horario_no_confirmado" | "cerrada_en_el_horario";

export interface AlternativaInterior {
  idExterno: string;
  proveedor: "geoapify";
  nombre: string;
  direccion: string | null;
  lat: number;
  lng: number;
  categorias: string[];
  paraParadaId: string;
  radioBusquedaMetros: number;
  distanciaLineaRectaMetros: number;
  coincideConIntereses: boolean;
  horario: { estado: EstadoHorario; valorOriginal: string | null };
  ventanaVisita: { apertura: string; cierre: string } | null;
  disponibilidad: DisponibilidadAlternativa;
  seleccionada: boolean;
}

export interface SustitucionPropuesta {
  paradaOriginalId: string;
  paradaOriginalNombre: string;
  alternativaId: string;
  alternativaNombre: string;
  razon: string;
}

export type TipoVisitaPropuesta = "conservada" | "sustituta" | "afectada_sin_alternativa";

export interface VisitaPropuesta {
  paradaId: string;
  nombre: string;
  tipo: TipoVisitaPropuesta;
  inicio: string;
  fin: string;
  trasladoMinutos: number;
  distanciaKm: number;
}

export interface ResumenRutaClima {
  orden: string[];
  viable: boolean;
  distanciaKm: number | null;
  trasladoMinutos: number | null;
  visitas: VisitaPropuesta[];
}

export interface ParadaPropuesta extends Parada {
  categorias?: string[];
  horaInicioProgramada?: string;
  horaFinProgramada?: string;
  tiempoTrasladoMinutos?: number;
}

export type FuenteOrigenRuta = "ubicacion_compartida" | "parada_en_curso" | "ultima_parada_completada" | "desconocida";

export type EstadoPropuestaClima = "pendiente" | "sin_cambios" | "sin_alternativas" | "sin_solucion_viable";

export interface PropuestaClima {
  id: string;
  estado: EstadoPropuestaClima;
  creadaEn: string;
  venceEn: string;
  itinerarioId: string;
  evento: EvaluacionClima;
  origen: { lat: number; lng: number; fuente: FuenteOrigenRuta } | { lat: null; lng: null; fuente: "desconocida" };
  horaInicio: string;
  modoTransporte: ModoTransporteRuta;
  paradasAfectadas: ParadaAfectada[];
  alternativas: AlternativaInterior[];
  sustituciones: SustitucionPropuesta[];
  conservadas: string[];
  rutaAnterior: ResumenRutaClima;
  rutaPropuesta: ResumenRutaClima | null;
  paradasPendientesPropuestas: ParadaPropuesta[] | null;
  advertencias: AdvertenciaClimaReactivo[];
  mensaje: string;
  token: string | null;
}

export interface RespuestaPropuestaClima extends Omit<RespuestaEvaluacionClima, "proximaEvaluacionSegundos"> {
  propuesta: PropuestaClima | null;
}

export interface SolicitudAceptarPropuestaClima {
  token: string;
  itinerario: ItinerarioActivo;
}

export interface RespuestaAceptarPropuestaClima {
  propuestaId: string;
  itinerarioId: string;
  yaAplicada: boolean;
  aplicadaEn: string;
  paradasPendientes: ParadaPropuesta[];
}
