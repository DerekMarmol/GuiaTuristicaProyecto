// Mensajes del chat flotante en ruta.
// TODO(backend): cuando exista el In-Trip AI Agent, `MensajeChat` y la respuesta
// de `enviarMensajeAgente` deben ajustarse a su contrato.

export interface MensajeChat {
  id: string;
  autor: "usuario" | "asistente";
  texto: string;
}