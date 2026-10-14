export type MonedaHospedaje = "GTQ";

export type UnidadTarifaHotel = "habitacion_noche";

export interface SolicitudRecomendacionesHoteles {
  fecha: string;
  paradas: { lat: number; lng: number }[];
  presupuestoDiario: number;
  moneda: MonedaHospedaje;
  ocupacion: number;
  hospedaje: boolean;
  sinHotel?: boolean;
  radio?: number;
  limite?: number;
}

export type FuenteTarifaHotel =
  | { tipo: "url"; referencia: string }
  | { tipo: "cotizacion"; referencia: string };

export interface TarifaHotelAplicada {
  id: string;
  importe: number;
  importeCentavos: number;
  moneda: MonedaHospedaje;
  unidad: UnidadTarifaHotel;
  ocupacion: number;
  impuestosIncluidos: true;
  vigencia: { desde: string; hasta: string };
  verificadoEn: string;
  fuente: FuenteTarifaHotel;
}

export interface HotelRecomendado {
  idExterno: string;
  proveedor: "geoapify";
  nombre: string;
  direccion: string | null;
  lat: number;
  lng: number;
  distanciaLineaRectaMetros: number;
  tarifa: TarifaHotelAplicada;
}

export type MotivoSinRecomendacionesHotel =
  | "hospedaje_reservado"
  | "no_necesita_hotel"
  | "itinerario_sin_paradas"
  | "catalogo_vacio"
  | "sin_tarifas_aplicables"
  | "sin_hoteles_encontrados"
  | "sin_hoteles_elegibles";

export interface BusquedaHoteles {
  categoria: "accommodation.hotel";
  radioMetros: number;
  maxCandidatos: number;
  candidatosEncontrados: number;
}

export interface RespuestaRecomendacionesHoteles {
  fecha: string;
  moneda: MonedaHospedaje;
  ocupacion: number;
  presupuestoDiario: number;
  presupuestoDiarioCentavos: number;
  porcentajeHospedaje: 40;
  presupuestoHospedaje: number;
  presupuestoHospedajeCentavos: number;
  centro: { lat: number; lng: number } | null;
  metodoDistancia: "linea_recta";
  busqueda: BusquedaHoteles | null;
  hoteles: HotelRecomendado[];
  motivo: MotivoSinRecomendacionesHotel | null;
  mensaje: string | null;
}
