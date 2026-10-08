export interface LugarInteres {
  idExterno: string;
  proveedor: "geoapify";
  nombre: string;
  direccion: string | null;
  lat: number;
  lng: number;
  categorias: string[];
}

export interface RespuestaLugares {
  lugares: LugarInteres[];
}