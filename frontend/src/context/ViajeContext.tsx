import { createContext, useContext, useState, type ReactNode } from "react";
import type { Itinerario, Viaje } from "../../../shared/types";

export type ViajeBorrador = Partial<Viaje> & {
  presupuestoDiario?: number;
  modulos?: string[];
  sinHotel?: boolean;
};

interface ViajeContextValue {
  viaje: ViajeBorrador;
  paso: number;
  itinerarios: Itinerario[] | null;
  actualizarViaje: (datos: ViajeBorrador) => void;
  irAPaso: (paso: number) => void;
  setItinerarios: (it: Itinerario[] | null) => void;
  reiniciar: () => void;
}

const ViajeContext = createContext<ViajeContextValue | null>(null);

export function ViajeProvider({ children }: { children: ReactNode }) {
  const [viaje, setViaje] = useState<ViajeBorrador>({});
  const [paso, setPaso] = useState(1);
  const [itinerarios, setItinerarios] = useState<Itinerario[] | null>(null);

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
    <ViajeContext.Provider value={{ viaje, paso, itinerarios, actualizarViaje, irAPaso: setPaso, setItinerarios, reiniciar }}>
      {children}
    </ViajeContext.Provider>
  );
}

export function useViaje() {
  const ctx = useContext(ViajeContext);
  if (!ctx) throw new Error("useViaje debe usarse dentro de <ViajeProvider>");
  return ctx;
}