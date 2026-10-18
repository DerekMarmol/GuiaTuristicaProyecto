import { useState } from "react";
import { useViaje } from "./context/ViajeContext";
import { useAuth } from "./context/AuthContext";
import FondoMapa from "./components/FondoMapa";
import OfflineBanner from "./components/OfflineBanner";
import ChatFlotante from "./components/ChatFlotante";
import Paso1Destino from "./pages/Paso1Destino";
import Paso2Hospedaje from "./pages/Paso2Hospedaje";
import Paso3Contexto from "./pages/Paso3Contexto";
import Paso4Generacion from "./pages/Paso4Generacion";
import PantallaAuth from "./pages/PantallaAuth";

export default function App() {
  const { paso } = useViaje();
  const { usuario, cerrarSesion } = useAuth();
  const [mostrarAuth, setMostrarAuth] = useState(false);

  return (
    <>
      <FondoMapa />
      <OfflineBanner />
      <header className="app-header">
        <span className="logo">Guía Turística</span>
        <div className="sesion">
          {usuario ? (
            <>
              <span>Hola, {usuario.nombre}</span>
              <button type="button" onClick={cerrarSesion}>Salir</button>
            </>
          ) : (
            !mostrarAuth && (
              <button type="button" onClick={() => setMostrarAuth(true)}>Iniciar sesión</button>
            )
          )}
        </div>
      </header>
      <main className="contenedor">
        {mostrarAuth && !usuario ? (
          <PantallaAuth onListo={() => setMostrarAuth(false)} onCancelar={() => setMostrarAuth(false)} />
        ) : (
          <>
            {paso === 1 && <Paso1Destino />}
            {paso === 2 && <Paso2Hospedaje />}
            {paso === 3 && <Paso3Contexto />}
            {paso === 4 && <Paso4Generacion />}
          </>
        )}
      </main>
      <ChatFlotante />
    </>
  );
}