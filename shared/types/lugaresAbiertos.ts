import type { LugarInteres } from "./lugarInteres";

export type EstadoApertura = "abierto" | "cerrado" | "desconocido";

export type MotivoAperturaNoVerificable =
  | "no_publicado"
  | "no_interpretable"
  | "error_consulta"
  | "estado_desconocido"
  | "zona_horaria_desconocida";

// open_now es null cuando el horario publicado no permite afirmar si el lugar está abierto o cerrado.
export type AperturaActual =
  | { estadoApertura: "abierto"; open_now: true; cierreEstimado: string | null }
  | { estadoApertura: "cerrado"; open_now: false }
  | { estadoApertura: "desconocido"; open_now: null; motivo: MotivoAperturaNoVerificable };

export interface LugarAbiertoAhora extends LugarInteres {
  open_now: true;
  estadoApertura: "abierto";
  evaluadoEn: string;
  zonaHoraria: string;
  horaLocalEvaluacion: string;
  cierreEstimado: string | null;
  distanciaMetros: number;
}

export interface CoberturaAbiertosAhora {
  candidatosEvaluados: number;
  limiteCandidatos: number;
  busquedaLimitada: boolean;
  abiertos: number;
  cerrados: number;
  desconocidos: number;
  desconocidosPorMotivo: Partial<Record<MotivoAperturaNoVerificable, number>>;
}

export interface RespuestaLugaresAbiertosAhora {
  evaluadoEn: string;
  criterio: "horarios_publicados";
  origen: { lat: number; lng: number };
  radioMetros: number;
  limite: number;
  categorias: string[];
  categoriasPredeterminadas: boolean;
  total: number;
  cobertura: CoberturaAbiertosAhora;
  lugares: LugarAbiertoAhora[];
}
