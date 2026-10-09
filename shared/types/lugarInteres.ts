export type EstadoHorario = "disponible" | "no_publicado" | "no_interpretable" | "error_consulta";

export type HorarioLugar =
  | { estado: "disponible"; valorOriginal: string; fuente: "geoapify" }
  | { estado: "no_interpretable"; valorOriginal: string | null; fuente: "geoapify" }
  | { estado: "no_publicado" | "error_consulta"; valorOriginal: null; fuente: "geoapify" };

export interface LugarInteres {
  idExterno: string;
  proveedor: "geoapify";
  nombre: string;
  direccion: string | null;
  lat: number;
  lng: number;
  categorias: string[];
  horario: HorarioLugar;
}

export interface RespuestaLugares {
  lugares: LugarInteres[];
}
