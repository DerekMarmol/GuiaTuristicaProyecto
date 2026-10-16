// RESPUESTAS SIMULADAS.
// TODO(backend): reemplazar por la llamada al In-Trip AI Agent.
// Debe enviar el mensaje del usuario junto con el viaje/itinerario actual y devolver
// el texto de respuesta (y, más adelante, los ajustes propuestos al itinerario).

const RESPUESTAS: { patron: RegExp; texto: string }[] = [
  { patron: /barat|econ[oó]mic|presupuesto|gast|caro/i, texto: "Puedo buscar opciones más económicas para lo que queda del día. Por ahora te sugiero revisar el panel de presupuesto para ver cuánto te queda." },
  { patron: /tiempo|qued|extra|m[aá]s rato|alarg/i, texto: "Entendido: podría darle más tiempo a esa parada y mover las siguientes. Cuando el asistente esté conectado, te mostraré cómo cambia el horario." },
  { patron: /hotel|hosped|dormir/i, texto: "Sobre el hospedaje, puedo recomendarte opciones cerca de tu ruta. Revisa la sección de recomendaciones del itinerario." },
  { patron: /comer|comida|almuerzo|cena|restaurante|desayuno/i, texto: "Puedo cambiar la parada de comida por otra opción cercana. Dime qué tipo de comida prefieres." },
  { patron: /lluvi|clima|calor|fr[ií]o/i, texto: "Si el clima cambia, puedo reordenar el día para dejar las actividades al aire libre en el mejor momento." },
  { patron: /cansad|descans|pausa/i, texto: "Podemos agregar una pausa o quitar una parada para que el ritmo sea más tranquilo." },
];

const RESPUESTA_POR_DEFECTO =
  "Gracias por tu mensaje. Aún estoy en modo de demostración, pero cuando me conecten podré ajustar tu itinerario a lo que pides.";

export const SUGERENCIAS_CHAT = [
  "Quiero algo más económico",
  "Necesito más tiempo en la siguiente parada",
  "Cambia el almuerzo",
  "Estoy cansado, ¿quitamos una parada?",
];

export function enviarMensajeAgente(texto: string): Promise<string> {
  const respuesta = RESPUESTAS.find((r) => r.patron.test(texto))?.texto ?? RESPUESTA_POR_DEFECTO;
  return new Promise((resolve) => setTimeout(() => resolve(respuesta), 900));
}