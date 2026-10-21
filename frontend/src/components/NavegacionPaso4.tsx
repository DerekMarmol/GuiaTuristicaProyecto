export type SeccionPaso4 = "itinerario" | "mapa" | "dormir" | "ruta";

interface Props {
  actual: SeccionPaso4;
  mostrarHoteles: boolean;
  onCambiar: (seccion: SeccionPaso4) => void;
}

// Iconos de trazo simple (24×24) para que se lean bien a tamaño de pulgar.
const ICONOS: Record<SeccionPaso4, string> = {
  itinerario: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  mapa: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  dormir: "M3 18V7m0 7h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01",
  ruta: "M6 19a2 2 0 1 0 0-.01M18 5a2 2 0 1 0 0-.01M6 17V9a3 3 0 0 1 3-3h3m0 12h3a3 3 0 0 0 3-3V7",
};

// GUI-110: navegación del paso 4 fija abajo, al alcance del pulgar en el teléfono.
export default function NavegacionPaso4({ actual, mostrarHoteles, onCambiar }: Props) {
  const secciones: { id: SeccionPaso4; texto: string }[] = [
    { id: "itinerario", texto: "Itinerario" },
    { id: "mapa", texto: "Mapa" },
    { id: "dormir", texto: mostrarHoteles ? "Dormir y comer" : "Comer" },
    { id: "ruta", texto: "En ruta" },
  ];

  return (
    <nav className="nav-inferior" aria-label="Secciones del itinerario">
      {secciones.map(({ id, texto }) => (
        <button
          key={id}
          type="button"
          className="nav-inferior-boton"
          aria-current={actual === id ? "page" : undefined}
          onClick={() => onCambiar(id)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={ICONOS[id]} />
          </svg>
          <span>{texto}</span>
        </button>
      ))}
    </nav>
  );
}
