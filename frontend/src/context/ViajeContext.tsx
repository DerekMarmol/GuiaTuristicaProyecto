import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { Itinerario, Viaje } from "../../../shared/types";
import type { Calificacion } from "../types/calificacion";
import type { Gasto } from "../types/gasto";

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
  gastos: Gasto[];
  setGastos: (g: Gasto[]) => void;
  agregarGasto: (g: Omit<Gasto, "id">) => void;
  eliminarGasto: (id: string) => void;
  actualizarViaje: (datos: ViajeBorrador) => void;
  fijarUbicacionDestino: (lat: number, lng: number) => void;
  irAPaso: (paso: number) => void;
  setItinerarios: Dispatch<SetStateAction<Itinerario[] | null>>;
  reiniciar: () => void;
}

const ViajeContext = createContext<ViajeContextValue | null>(null);

export function ViajeProvider({ children }: { children: ReactNode }) {
  const [viaje, setViaje] = useState<ViajeBorrador>({});
  const [paso, setPaso] = useState(1);
  const [itinerarios, setItinerariosState] = useState<Itinerario[] | null>(null);
  // TODO(backend): persistir calificaciones en el servidor. Por ahora viven en memoria.
  const [calificaciones, setCalificaciones] = useState<Record<string, Calificacion>>({});
  // Gastos que registra el usuario en el panel de presupuesto. Empiezan vacíos (GUI-113).
  // TODO(backend): guardarlos en el servidor. Por ahora viven en memoria.
  const [gastos, setGastos] = useState<Gasto[]>([]);

  const setItinerarios: Dispatch<SetStateAction<Itinerario[] | null>> = (actualizacion) => {
    setItinerariosState((anterior) => {
      const siguiente =
        typeof actualizacion === "function"
          ? (actualizacion as (prev: Itinerario[] | null) => Itinerario[] | null)(anterior)
          : actualizacion;
      if (siguiente === null) {
        setCalificaciones({}); // itinerario nuevo = paradas nuevas
        setGastos([]);
      }
      return siguiente;
    });
  };

  const guardarCalificacion = (c: Calificacion) =>
    setCalificaciones((prev) => ({ ...prev, [c.paradaId]: c }));

  const agregarGasto = (g: Omit<Gasto, "id">) =>
    setGastos((prev) => [...prev, { ...g, id: `local-${Date.now()}-${prev.length}` }]);

  const eliminarGasto = (id: string) =>
    setGastos((prev) => prev.filter((g) => g.id !== id));

  const actualizarViaje = (datos: ViajeBorrador) => {
    setViaje((anterior) => ({ ...anterior, ...datos }));
    setItinerarios(null); // si cambian los datos, el itinerario anterior ya no sirve
  };

  // Coordenadas del destino que resuelve el backend al generar. No toca el itinerario recién creado.
  const fijarUbicacionDestino = (lat: number, lng: number) =>
    setViaje((anterior) => ({ ...anterior, lat, lng }));

  const reiniciar = () => {
    setViaje({});
    setItinerarios(null);
    setPaso(1);
  };

  return (
    <ViajeContext.Provider
      value={{
        viaje, paso, itinerarios,
        calificaciones, guardarCalificacion,
        gastos, setGastos, agregarGasto, eliminarGasto,
        actualizarViaje, fijarUbicacionDestino, irAPaso: setPaso, setItinerarios, reiniciar,
      }}
    >
      {children}
    </ViajeContext.Provider>
  );
}

export function useViaje() {
  const ctx = useContext(ViajeContext);
  if (!ctx) throw new Error("useViaje debe usarse dentro de <ViajeProvider>");
  return ctx;
}
