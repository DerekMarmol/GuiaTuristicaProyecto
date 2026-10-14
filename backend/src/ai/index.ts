export { generarItinerarios, ErrorGeneracionIA } from "./generarItinerario";
export { crearClienteGemini, type ClienteLLM } from "./cliente";
export { validarSalida } from "./validator";
export type {
  LugarReal,
  ViajeIA,
  ItinerarioIA,
  ParadaIA,
  ResultadoGeneracion,
  DescarteParada,
  DiaSinParadas,
  MotivoDescarte,
  TrasladoEstimado,
} from "./tipos";
export { enriquecerParadasConHolgura, calcularTiempoTotalTraslado } from "./tiempoService";
export { crearPlanificadorDia, estimarTraslado } from "./validacionApertura";
export { crearValidadorPropuestas, type ResultadoPropuesta, type PlanValidado } from "./propuesta";
