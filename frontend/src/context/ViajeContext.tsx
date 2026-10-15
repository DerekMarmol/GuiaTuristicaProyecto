import { createContext, useContext, useState, type ReactNode } from "react";
import type { Itinerario, Viaje } from "../../../shared/types";
import type { Calificacion } from "../types/calificacion";

export type ViajeBorrador = Partial<Viaje> & {
  presupuestoDiario?: number;
  modulos?: string[];
  sinHotel?: boolean;
};

interface ViajeContextValue {
  viaje: ViajeBorrador;
  paso: number;
  itinerarios: Itinerario[] | null;
  calificaciones: Record<string, Calificacion>;
  guardarCalificacion: (c: Calificacion) => void;
  actualizarViaje: (datos: ViajeBorrador) => void;
  irAPaso: (paso: number) => void;
  setItinerarios: (it: Itinerario[] | null) => void;
  reiniciar: () => void;
}

const ViajeContext = createContext<ViajeContextValue | null>(null);

export function ViajeProvider({ children }: { children: ReactNode }) {
  const [viaje, setViaje] = useState<ViajeBorrador>({});
  const [paso, setPaso] = useState(1);
  const [itinerarios, setItinerariosState] = useState<Itinerario[] | null>(null);
  // TODO(backend): persistir calificaciones en el servidor. Por ahora viven en memoria.
  const [calificaciones, setCalificaciones] = useState<Record<string, Calificacion>>({});

  const setItinerarios = (it: Itinerario[] | null) => {
    setItinerariosState(it);
    if (it === null) setCalificaciones({}); // itinerario nuevo = paradas nuevas
  };

  const guardarCalificacion = (c: Calificacion) =>
    setCalificaciones((prev) => ({ ...prev, [c.paradaId]: c }));

  const actualizarViaje = (datos: ViajeBorrador) => {
    setViaje((anterior) => ({ ...anterior, ...datos }));
    setItinerarios(null); // si cambian los datos, el itinerario anterior ya no sirve
  };

  const reiniciar = () => {
    setViaje({});
    setItinerarios(null);
    setPaso(1);
  };

  return (
    <ViajeContext.Provider value={{ viaje, paso, itinerarios, calificaciones, guardarCalificacion, actualizarViaje, irAPaso: setPaso, setItinerarios, reiniciar }}>
      {children}
    </ViajeContext.Provider>
  );
}

export function useViaje() {
  const ctx = useContext(ViajeContext);
  if (!ctx) throw new Error("useViaje debe usarse dentro de <ViajeProvider>");
  return ctx;
}