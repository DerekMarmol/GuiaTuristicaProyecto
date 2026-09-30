import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const alConectar = () => setOnline(true);
    const alDesconectar = () => setOnline(false);
    window.addEventListener("online", alConectar);
    window.addEventListener("offline", alDesconectar);
    return () => {
      window.removeEventListener("online", alConectar);
      window.removeEventListener("offline", alDesconectar);
    };
  }, []);

  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      Sin conexión: puedes seguir configurando tu viaje, pero no se podrá generar el itinerario hasta volver a estar en línea.
    </div>
  );
}