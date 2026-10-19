import { useEffect, useState, useSyncExternalStore } from "react";
import { consultarAbiertosAhora } from "../services/abiertosAhora";
import { crearControladorAbiertosAhora } from "../services/abiertosAhoraEstado";
import { obtenerUbicacionActual } from "../services/ubicacionActual";

// La ubicación solo se pide al activar el modo o al pulsar «Actualizar ubicación», y no se guarda fuera de este estado.
export function useAbiertosAhora(intereses: readonly string[]) {
  const [controlador] = useState(() =>
    crearControladorAbiertosAhora({
      obtenerUbicacion: () => obtenerUbicacionActual(),
      consultar: (consulta, signal) => consultarAbiertosAhora(consulta, signal),
    }),
  );
  const estado = useSyncExternalStore(controlador.suscribir, controlador.obtenerEstado);

  const clave = intereses.join(",");
  useEffect(() => {
    controlador.cambiarIntereses(clave ? clave.split(",") : []);
  }, [controlador, clave]);

  useEffect(() => () => controlador.desactivar(), [controlador]);

  return { estado, ...controlador };
}
