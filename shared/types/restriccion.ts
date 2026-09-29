export interface Restriccion {
  id: string;
  paradaId: string;
  tipoEntorno: "Bajo Techo" | "Al aire libre";
  sensibilidadClima: "baja" | "media" | "alta";
}