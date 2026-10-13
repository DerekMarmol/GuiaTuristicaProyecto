export type EstadoPronosticoDiario = "disponible" | "parcial" | "fuera_de_cobertura" | "sin_datos";

export type PronosticoDiario =
  | {
      fecha: string;
      estado: "disponible" | "parcial";
      temperaturaPromedioC: number;
      temperaturaMinimaC: number;
      temperaturaMaximaC: number;
      lluviaMm: number;
      intervalosDisponibles: number;
    }
  | {
      fecha: string;
      estado: "fuera_de_cobertura" | "sin_datos";
      temperaturaPromedioC: null;
      temperaturaMinimaC: null;
      temperaturaMaximaC: null;
      lluviaMm: null;
      intervalosDisponibles: 0;
    };

export interface CoberturaClima {
  desde: string;
  hasta: string;
  primerIntervalo: string;
  ultimoIntervalo: string;
}

export type CodigoAdvertenciaClima = "SERIE_VACIA" | "FUERA_DE_COBERTURA" | "COBERTURA_PARCIAL" | "SIN_DATOS";

export interface AdvertenciaClima {
  codigo: CodigoAdvertenciaClima;
  mensaje: string;
  fechas: string[];
}

export interface RespuestaClima {
  fuente: "openweathermap";
  ubicacion: { lat: number; lng: number };
  rango: { fechaInicio: string; fechaFin: string; totalDias: number };
  consultadoEn: string;
  desplazamientoUtcSegundos: number;
  cobertura: CoberturaClima | null;
  dias: PronosticoDiario[];
  advertencias: AdvertenciaClima[];
}
