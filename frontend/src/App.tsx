import { useViaje } from "./context/ViajeContext";
import OfflineBanner from "./components/OfflineBanner";
import Paso1Destino from "./pages/Paso1Destino";
import Paso2Hospedaje from "./pages/Paso2Hospedaje";
import Paso3Contexto from "./pages/Paso3Contexto";
import PasoPendiente from "./pages/PasoPendiente";

export default function App() {
  const { paso } = useViaje();
  return (
    <>
      <div className="fondo" aria-hidden="true">
        <div className="sol" />
        <div className="rejilla" />
      </div>
      <OfflineBanner />
      <header className="app-header">
        <span className="logo">GUÍA TURÍSTICA</span>
      </header>
      <main className="contenedor">
        {paso === 1 && <Paso1Destino />}
        {paso === 2 && <Paso2Hospedaje />}
        {paso === 3 && <Paso3Contexto />}
        {paso >= 4 && <PasoPendiente />}
      </main>
    </>
  );
}