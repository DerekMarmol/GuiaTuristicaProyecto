export interface Viaje {
id: string;
destino: string;
tipoViaje: "solo" | "pareja" | "familia" | "amigos";
lat: number;
lng: number;
presupuesto: number;
transporte: "A pie"|"Transporte Publico"|"Automovil"|"Moto"|"Transporte Aereo";
intereses: string[];
fechaInicio: string;
fechaFin: string;
hospedaje: boolean;
nombreHotel?: string;
}