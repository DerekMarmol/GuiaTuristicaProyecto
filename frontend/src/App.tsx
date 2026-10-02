import { useViaje } from "./context/ViajeContext";
import FondoMapa from "./components/FondoMapa";
import OfflineBanner from "./components/OfflineBanner";
import { Mapa } from "./components/Mapa";
import Paso1Destino from "./pages/Paso1Destino";
import Paso2Hospedaje from "./pages/Paso2Hospedaje";
import Paso3Contexto from "./pages/Paso3Contexto";
import Paso4Generacion from "./pages/Paso4Generacion";

export default function App() {
  const { paso } = useViaje();
  return (
    <>
      <FondoMapa />
      <OfflineBanner />
      <header className="app-header">
        <span className="logo">Guía Turística</span>
      </header>
      <div className="mapa-marco">
        <Mapa />
      </div>
      <main className="contenedor">
        {paso === 1 && <Paso1Destino />}
        {paso === 2 && <Paso2Hospedaje />}
        {paso === 3 && <Paso3Contexto />}
        {paso === 4 && <Paso4Generacion />}
      </main>
    </>
  );
}