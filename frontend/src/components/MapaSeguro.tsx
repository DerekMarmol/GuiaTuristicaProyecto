import { Component, type ReactNode } from "react";
import type { Parada } from "../../../shared/types";
import { Mapa } from "./Mapa";

// Sin token de Mapbox el mapa no puede cargar: se muestra un aviso en lugar de romper toda la app.
const hayToken = Boolean(import.meta.env.VITE_MAPBOX_TOKEN);

function Aviso() {
  return (
    <p className="mapa-aviso" role="status">
      No pudimos cargar el mapa. Puedes seguir planeando tu viaje.
      {import.meta.env.DEV && (
        <small>
          Para desarrolladores: revisa que exista <code>frontend/.env</code> con <code>VITE_MAPBOX_TOKEN</code> y{" "}
          <code>VITE_MAPBOX_STYLE_URL</code> (copia <code>.env.example</code>) y reinicia <code>npm run dev</code>.
        </small>
      )}
    </p>
  );
}

// Si el mapa falla al iniciar (token inválido, sin WebGL, etc.) solo cae el mapa, no la página.
class LimiteDeError extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };

  static getDerivedStateFromError() {
    return { fallo: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("El mapa no se pudo iniciar:", error);
  }

  render() {
    return this.state.fallo ? <Aviso /> : this.props.children;
  }
}

export function MapaSeguro({ paradas }: { paradas?: Parada[] }) {
  if (!hayToken) return <Aviso />;
  return (
    <LimiteDeError>
      <Mapa paradas={paradas} />
    </LimiteDeError>
  );
}