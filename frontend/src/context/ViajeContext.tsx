import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { Itinerario, Viaje } from "../../../shared/types";
import type { Calificacion } from "../types/calificacion";
import type { Gasto } from "../types/gasto";
import { borrarConPrefijo, guardarEnTelefono, leerGuardado } from "../utils/almacenLocal";

export type ViajeBorrador = Partial<Viaje> & {
  presupuestoDiario?: number;
  modulos?: string[];
  sinHotel?: boolean;
  // Id del plan en el servidor cuando se abrió desde «Tus planes guardados» (permite exportarlo).
  idPlanGuardado?: string;
};

// GUI-114: el viaje en curso se guarda en el teléfono. Si cambia la forma de lo guardado, subir la versión
// para no intentar leer datos viejos con otro formato.
const CLAVE_VIAJE = "guia.viaje";
const VERSION_GUARDADO = 1;
// Estado de la pantalla del paso 4 (sección y día abiertos, paradas visitadas…), ver Paso4Generacion.
export const PREFIJO_ESTADO_PASO4 = "guia.paso4.";

interface ViajeGuardado {
  version: number;
  viaje: ViajeBorrador;
  paso: number;
  itinerarios: Itinerario[] | null;
  calificaciones: Record<string, Calificacion>;
  gastos: Gasto[];
}

function leerViajeGuardado(): ViajeGuardado | null {
  const guardado = leerGuardado<ViajeGuardado>(CLAVE_VIAJE);
  const valido =
    guardado?.version === VERSION_GUARDADO &&
    typeof guardado.viaje === "object" &&
    [1, 2, 3, 4].includes(guardado.paso) &&
    (guardado.itinerarios === null || Array.isArray(guardado.itinerarios)) &&
    Array.isArray(guardado.gastos);
  return valido ? guardado : null;
}

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
  // Abre un plan recuperado (por ejemplo, de «Tus planes guardados») directamente en el paso 4.
  cargarPlan: (viaje: ViajeBorrador, itinerarios: Itinerario[]) => void;
}

const ViajeContext = createContext<ViajeContextValue | null>(null);

export function ViajeProvider({ children }: { children: ReactNode }) {
  const [guardado] = useState(leerViajeGuardado);
  const [viaje, setViaje] = useState<ViajeBorrador>(guardado?.viaje ?? {});
  const [paso, setPaso] = useState(guardado?.paso ?? 1);
  const [itinerarios, setItinerariosState] = useState<Itinerario[] | null>(guardado?.itinerarios ?? null);
  // TODO(backend): persistir calificaciones en el servidor. Por ahora se guardan en el teléfono.
  const [calificaciones, setCalificaciones] = useState<Record<string, Calificacion>>(guardado?.calificaciones ?? {});
  // Gastos que registra el usuario en el panel de presupuesto. Empiezan vacíos (GUI-113).
  // TODO(backend): guardarlos en el servidor. Por ahora se guardan en el teléfono.
  const [gastos, setGastos] = useState<Gasto[]>(guardado?.gastos ?? []);

  useEffect(() => {
    const aGuardar: ViajeGuardado = { version: VERSION_GUARDADO, viaje, paso, itinerarios, calificaciones, gastos };
    guardarEnTelefono(CLAVE_VIAJE, aGuardar);
  }, [viaje, paso, itinerarios, calificaciones, gastos]);

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
    borrarConPrefijo(PREFIJO_ESTADO_PASO4);
  };

  const cargarPlan = (nuevoViaje: ViajeBorrador, nuevosItinerarios: Itinerario[]) => {
    borrarConPrefijo(PREFIJO_ESTADO_PASO4);
    setViaje(nuevoViaje);
    setItinerariosState(nuevosItinerarios);
    setCalificaciones({});
    setGastos([]);
    setPaso(4);
  };

  return (
    <ViajeContext.Provider
      value={{
        viaje, paso, itinerarios,
        calificaciones, guardarCalificacion,
        gastos, setGastos, agregarGasto, eliminarGasto,
        actualizarViaje, fijarUbicacionDestino, irAPaso: setPaso, setItinerarios, reiniciar, cargarPlan,
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
