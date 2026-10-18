export type MonedaHospedaje = "GTQ";

export type UnidadTarifaHotel = "habitacion_noche";

export interface SolicitudRecomendacionesHoteles {
  fecha: string;
  destino: string;
  paradas: { lat: number; lng: number }[];
  presupuestoDiario: number;
  moneda: MonedaHospedaje;
  ocupacion: number;
  hospedaje: boolean;
  sinHotel?: boolean;
  radio?: number;
  limite?: number;
}

export type CampoPrecioHotel = "total_rate" | "rate_per_night";

export type ImpuestosTarifaHotel =
  | { estado: "informado"; importeAntesImpuestosUsd: number; impuestosYCargosUsd: number }
  | { estado: "no_informado" };

export type FuenteTarifaHotel = { tipo: "resumen_propiedad" } | { tipo: "oferta"; nombre: string; oficial: boolean };

export interface TarifaReferencialHotel {
  referencial: true;
  importeUsd: number;
  importeUsdCentavos: number;
  importe: number;
  importeCentavos: number;
  moneda: MonedaHospedaje;
  unidad: UnidadTarifaHotel;
  noches: 1;
  campo: CampoPrecioHotel;
  fuente: FuenteTarifaHotel;
  impuestos: ImpuestosTarifaHotel;
}

export interface HotelRecomendado {
  idExterno: string;
  proveedor: "serpapi";
  nombre: string;
  lat: number;
  lng: number;
  distanciaLineaRectaMetros: number;
  tarifa: TarifaReferencialHotel;
}

export interface EstanciaHotel {
  entrada: string;
  salida: string;
  noches: 1;
  adultos: number;
  ninos: 0;
}

export interface BusquedaHoteles {
  proveedor: "serpapi";
  motor: "google_hotels";
  consulta: string;
  monedaProveedor: "USD";
  consultadoEn: string;
  desdeCache: boolean;
  radioMetros: number;
  resultadosRecibidos: number;
  hotelesConPrecio: number;
  hotelesEnRadio: number;
  hayMasPaginas: boolean;
}

export interface TipoCambioHoteles {
  proveedor: "exchangerate-api";
  base: "USD";
  destino: "GTQ";
  tasa: number;
  actualizadoEn: string;
  proximaActualizacion: string;
  consultadoEn: string;
}

export type MotivoSinRecomendacionesHotel =
  | "hospedaje_reservado"
  | "no_necesita_hotel"
  | "itinerario_sin_paradas"
  | "sin_hoteles_encontrados"
  | "sin_hoteles_con_precio"
  | "sin_hoteles_en_radio"
  | "sin_hoteles_en_presupuesto";

export interface RespuestaRecomendacionesHoteles {
  fecha: string;
  destino: string;
  moneda: MonedaHospedaje;
  ocupacion: number;
  estancia: EstanciaHotel;
  presupuestoDiario: number;
  presupuestoDiarioCentavos: number;
  porcentajeHospedaje: 40;
  presupuestoHospedaje: number;
  presupuestoHospedajeCentavos: number;
  centro: { lat: number; lng: number } | null;
  metodoDistancia: "linea_recta";
  busqueda: BusquedaHoteles | null;
  tipoCambio: TipoCambioHoteles | null;
  hoteles: HotelRecomendado[];
  motivo: MotivoSinRecomendacionesHotel | null;
  mensaje: string | null;
}
