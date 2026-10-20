export interface Parada {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  horaApertura: string;
  horaCierre: string;
  tiempoEstanciaMinutos: number;
  placeId?: string;
  tipo_entorno?: "indoor" | "outdoor";
  sensibilidad_clima?: "baja" | "media" | "alta";
}
