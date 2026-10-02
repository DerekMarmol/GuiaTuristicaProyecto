export interface Lugar {
  id: string;
  tipo: "hotel" | "restaurante";
  nombre: string;
  descripcion: string;
  lat: number;
  lng: number;
  precio: number; 
  calificacion: number; 
  distanciaKm: number; 
  dia?: number; 
}