import { createContext, useContext, useState, type ReactNode } from "react";
import type { Viaje } from "../../../shared/types";

export type ViajeBorrador = Partial<Viaje> & {
  presupuestoDiario?: number;
  modulos?: string[];
};

interface ViajeContextValue {
  viaje: ViajeBorrador;
  paso: number;
  actualizarViaje: (datos: ViajeBorrador) => void;
  irAPaso: (paso: number) => void;
}

const ViajeContext = createContext<ViajeContextValue | null>(null);

export function ViajeProvider({ children }: { children: ReactNode }) {
  const [viaje, setViaje] = useState<ViajeBorrador>({});
  const [paso, setPaso] = useState(1);

  const actualizarViaje = (datos: ViajeBorrador) =>
    setViaje((anterior) => ({ ...anterior, ...datos }));

  return (
    <ViajeContext.Provider value={{ viaje, paso, actualizarViaje, irAPaso: setPaso }}>
      {children}
    </ViajeContext.Provider>
  );
}

export function useViaje() {
  const ctx = useContext(ViajeContext);
  if (!ctx) throw new Error("useViaje debe usarse dentro de <ViajeProvider>");
  return ctx;
}