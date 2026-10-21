export interface HotelRecomendacion {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  precio: number; // por habitación y noche, en quetzales (referencial)
  distanciaKm: number; // en línea recta al centro del itinerario
}

export interface RestauranteRecomendacion {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  precioMinimo: number; // rango referencial por persona, en quetzales
  precioMaximo: number;
  distanciaKm: number; // en línea recta a la parada más cercana
  cercaDe: string | null; // nombre de esa parada
}

export interface RecomendacionesHoteles {
  hoteles: HotelRecomendacion[];
  presupuestoHospedaje: number;
  personas: number;
  mensaje: string | null; // por qué no hay hoteles, si no hay
}

export interface RecomendacionesRestaurantes {
  restaurantes: RestauranteRecomendacion[];
  presupuestoPorPersona: number;
  personas: number;
  mensaje: string | null; // por qué no hay restaurantes, si no hay
  incompleto: boolean; // la búsqueda falló para alguna parada
}
