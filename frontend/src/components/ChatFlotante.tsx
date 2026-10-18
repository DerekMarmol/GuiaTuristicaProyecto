import { useEffect, useRef, useState, type FormEvent } from "react";
import { useViaje } from "../context/ViajeContext";
import type { MensajeChat } from "../types/chat";
import { enviarMensajeAgente, SUGERENCIAS_CHAT } from "../services/chat";

const BIENVENIDA: MensajeChat = {
  id: "bienvenida",
  autor: "asistente",
  texto: "¡Hola! Soy tu asistente de viaje. Escríbeme qué quieres ajustar de tu ruta y lo vemos juntos.",
};

export default function ChatFlotante() {
  const { viaje } = useViaje();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeChat[]>([BIENVENIDA]);
  const [texto, setTexto] = useState("");
  const [escribiendo, setEscribiendo] = useState(false);
  const [sinLeer, setSinLeer] = useState(0);

  const botonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const vivo = useRef(true);

  // En desarrollo, React StrictMode monta, desmonta y vuelve a montar: la bandera debe reactivarse al montar.
  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  // Si el usuario empieza un viaje nuevo, la conversación anterior ya no aplica.
  useEffect(() => {
    if (!viaje.destino) {
      setMensajes([BIENVENIDA]);
      setSinLeer(0);
    }
  }, [viaje.destino]);

  useEffect(() => {
    finRef.current?.scrollIntoView?.({ block: "end" });
  }, [mensajes, escribiendo, abierto]);

  useEffect(() => {
    if (abierto) {
      setSinLeer(0);
      inputRef.current?.focus();
    }
  }, [abierto]);

  function cerrar() {
    setAbierto(false);
    botonRef.current?.focus();
  }

  async function enviar(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || escribiendo) return;

    setMensajes((m) => [...m, { id: `u-${Date.now()}`, autor: "usuario", texto: limpio }]);
    setTexto("");
    setEscribiendo(true);

    const respuesta = await enviarMensajeAgente(limpio);
    if (!vivo.current) return;

    setMensajes((m) => [...m, { id: `a-${Date.now()}`, autor: "asistente", texto: respuesta }]);
    setEscribiendo(false);
    setAbierto((a) => {
      if (!a) setSinLeer((n) => n + 1);
      return a;
    });
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    enviar(texto);
  }

  const soloBienvenida = mensajes.length === 1;

  return (
    <div className="chat">
      {abierto && (
        <section
          className="chat-panel"
          role="dialog"
          aria-label="Chat con el asistente de viaje"
          onKeyDown={(e) => { if (e.key === "Escape") cerrar(); }}
        >
          <header className="chat-cab">
            <div>
              <strong>Asistente de viaje</strong>
              <small>Modo demostración</small>
            </div>
            <button type="button" className="chat-cerrar" aria-label="Cerrar chat" onClick={cerrar}>×</button>
          </header>

          <div className="chat-mensajes" role="log" aria-live="polite" aria-label="Conversación">
            {mensajes.map((m) => (
              <p key={m.id} className={`burbuja ${m.autor}`}>
                <span className="solo-lectores">{m.autor === "usuario" ? "Tú: " : "Asistente: "}</span>
                {m.texto}
              </p>
            ))}
            {escribiendo && <p className="burbuja asistente escribiendo" aria-label="El asistente está escribiendo">…</p>}
            <div ref={finRef} />
          </div>

          {soloBienvenida && (
            <div className="chat-sugerencias" aria-label="Sugerencias">
              {SUGERENCIAS_CHAT.map((s) => (
                <button key={s} type="button" className="etiqueta" onClick={() => enviar(s)}>{s}</button>
              ))}
            </div>
          )}

          <form className="chat-form" onSubmit={onSubmit}>
            <label htmlFor="chat-texto" className="solo-lectores">Escribe tu mensaje</label>
            <input
              id="chat-texto"
              ref={inputRef}
              type="text"
              maxLength={300}
              autoComplete="off"
              placeholder="Ej. Quiero más tiempo en el museo"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <button type="submit" className="btn-primario" disabled={!texto.trim() || escribiendo}>Enviar</button>
          </form>
        </section>
      )}

      <button
        ref={botonRef}
        type="button"
        className="chat-boton"
        aria-expanded={abierto}
        aria-label={abierto ? "Cerrar chat con el asistente" : "Abrir chat con el asistente"}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
      >
        <span aria-hidden="true">{abierto ? "×" : "💬"}</span>
        {!abierto && sinLeer > 0 && <span className="chat-punto" aria-label={`${sinLeer} mensaje nuevo`}>{sinLeer}</span>}
      </button>
    </div>
  );
}