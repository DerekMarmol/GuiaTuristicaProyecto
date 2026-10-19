export type MonedaAlimentacion = "GTQ";

export type UnidadTarifaRestaurante = "persona_comida";

export interface ParadaRecomendacionRestaurantes {
  id: string;
  lat: number;
  lng: number;
}

export interface SolicitudRecomendacionesRestaurantes {
  fecha?: string;
  paradas: ParadaRecomendacionRestaurantes[];
  presupuestoDiario: number;
  moneda: MonedaAlimentacion;
  comensales: number;
  radio?: number;
  limite?: number;
}

export type PerfilComidaRestaurante = "comida_rapida" | "patio_de_comidas" | "restaurante_general";

export type AplicabilidadTarifaRestaurante = "perfil_correspondiente" | "escenario_general";

export type ConfianzaTarifaRestaurante = "media" | "baja";

export interface FuenteTarifaRestaurante {
  nombre: string;
  url: string;
  indicador: string;
  consultadoEn: string;
}

export interface TarifaReferencialRestaurante {
  referencial: true;
  precioConfirmado: false;
  referenciaId: string;
  perfil: PerfilComidaRestaurante;
  aplicabilidad: AplicabilidadTarifaRestaurante;
  confianza: ConfianzaTarifaRestaurante;
  region: string;
  moneda: MonedaAlimentacion;
  unidad: UnidadTarifaRestaurante;
  minimo: number;
  minimoCentavos: number;
  maximo: number;
  maximoCentavos: number;
  criterioEvaluacion: "maximo_del_rango";
  valorEvaluacion: number;
  valorEvaluacionCentavos: number;
  alcance: string;
  fuentes: FuenteTarifaRestaurante[];
}

export interface CostoReferencialGrupoRestaurante {
  comensales: number;
  importe: number;
  importeCentavos: number;
  moneda: MonedaAlimentacion;
}

interface RestauranteEvaluadoBase {
  idExterno: string;
  proveedor: "geoapify";
  nombre: string;
  direccion: string | null;
  lat: number;
  lng: number;
  categorias: string[];
  distanciaLineaRectaMetros: number;
}

export interface RestauranteRecomendado extends RestauranteEvaluadoBase {
  estimacion: "estimado";
  tarifaReferencial: TarifaReferencialRestaurante;
  costoReferencialGrupo: CostoReferencialGrupoRestaurante;
  elegiblePorPresupuesto: true;
}

export type MotivoSinEstimacionRestaurante = "categoria_sin_referencia" | "region_no_cubierta" | "region_no_identificada";

export interface RestauranteSinEstimacion extends RestauranteEvaluadoBase {
  estimacion: "sin_estimacion";
  motivoSinEstimacion: MotivoSinEstimacionRestaurante;
  tarifaReferencial: null;
  costoReferencialGrupo: null;
  elegiblePorPresupuesto: false;
}

export type MotivoSinRecomendacionesRestaurante =
  | "sin_restaurantes_encontrados"
  | "sin_restaurantes_en_radio"
  | "sin_tarifas_aplicables"
  | "sin_restaurantes_en_presupuesto";

export interface BusquedaRestaurantesParada {
  proveedor: "geoapify";
  categorias: string[];
  radioMetros: number;
  limiteProveedor: number;
  resultadosProveedor: number;
  resultadosDescartados: number;
  fueraDeRadio: number;
  sinEstimacion: number;
  excluidosPorPresupuesto: number;
  posiblesResultadosAdicionales: boolean;
  busquedaCompartida: boolean;
}

export interface ErrorBusquedaParada {
  codigo: string;
  mensaje: string;
  consultada: boolean;
}

interface ResultadoParadaBase {
  id: string;
  lat: number;
  lng: number;
}

export interface ParadaProcesadaRestaurantes extends ResultadoParadaBase {
  estado: "procesada";
  restaurantesEncontrados: number;
  recomendacionesElegibles: number;
  restaurantes: RestauranteRecomendado[];
  sinEstimacion: RestauranteSinEstimacion[];
  busqueda: BusquedaRestaurantesParada;
  motivo: MotivoSinRecomendacionesRestaurante | null;
  mensaje: string | null;
  error: null;
}

export interface ParadaFallidaRestaurantes extends ResultadoParadaBase {
  estado: "fallida";
  restaurantesEncontrados: null;
  recomendacionesElegibles: null;
  restaurantes: [];
  sinEstimacion: [];
  busqueda: null;
  motivo: "busqueda_fallida";
  mensaje: string;
  error: ErrorBusquedaParada;
}

export type ResultadoParadaRestaurantes = ParadaProcesadaRestaurantes | ParadaFallidaRestaurantes;

export interface PreciosReferencialesRestaurantes {
  referencial: true;
  precioConfirmado: false;
  moneda: MonedaAlimentacion;
  unidad: UnidadTarifaRestaurante;
  criterioEvaluacion: "maximo_del_rango";
  consultadoEn: string;
  fuentes: { nombre: string; url: string }[];
  aviso: string;
}

export interface ResumenRecomendacionesRestaurantes {
  paradasSolicitadas: number;
  paradasProcesadas: number;
  paradasFallidas: number;
  busquedasIntentadas: number;
  busquedasOmitidas: number;
  completo: boolean;
}

export interface RespuestaRecomendacionesRestaurantes {
  fecha: string | null;
  moneda: MonedaAlimentacion;
  presupuestoDiario: number;
  presupuestoDiarioCentavos: number;
  porcentajeAlimentacion: 30;
  presupuestoAlimentacion: number;
  presupuestoAlimentacionCentavos: number;
  comensales: number;
  presupuestoPorPersona: number;
  presupuestoPorPersonaCentavos: number;
  comidasPresupuestadas: 1;
  metodoDistancia: "linea_recta";
  radioMetros: number;
  limitePorParada: number;
  preciosReferenciales: PreciosReferencialesRestaurantes;
  paradas: ResultadoParadaRestaurantes[];
  resumen: ResumenRecomendacionesRestaurantes;
  motivo: "itinerario_sin_paradas" | null;
  mensaje: string | null;
}
