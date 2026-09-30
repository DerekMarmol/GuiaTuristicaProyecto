import { useViaje } from "../context/ViajeContext";
import Stepper from "../components/Stepper";

export default function PasoPendiente() {
  const { paso, viaje, irAPaso } = useViaje();
  return (
    <div className="card">
      <Stepper actual={paso} />
      <h2>Paso {paso}: próximamente</h2>
      <p>Datos guardados hasta ahora:</p>
      <pre data-testid="datos">{JSON.stringify(viaje, null, 2)}</pre>
      <button type="button" className="btn-secundario" onClick={() => irAPaso(paso - 1)}>Atrás</button>
    </div>
  );
}