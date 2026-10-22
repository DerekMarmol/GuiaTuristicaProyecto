import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// GUI-114: lo que el usuario arma (viaje, itinerario, gastos…) se guarda en el teléfono para que sobreviva
// a recargar la página o apagar el teléfono. El almacenamiento puede no estar disponible (navegación
// privada, espacio lleno): en ese caso la app sigue funcionando, solo que sin recordar.

export function leerGuardado<T>(clave: string): T | null {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo === null ? null : (JSON.parse(crudo) as T);
  } catch {
    return null;
  }
}

export function guardarEnTelefono(clave: string, valor: unknown): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin espacio o sin permiso: se pierde solo la copia guardada.
  }
}

export function borrarConPrefijo(prefijo: string): void {
  try {
    for (const clave of Object.keys(localStorage)) {
      if (clave.startsWith(prefijo)) localStorage.removeItem(clave);
    }
  } catch {
    // Nada que borrar si el almacenamiento no está disponible.
  }
}

// useState que además se guarda en el teléfono bajo `clave`.
export function useEstadoGuardado<T>(clave: string, inicial: T): [T, Dispatch<SetStateAction<T>>] {
  const [valor, setValor] = useState<T>(() => leerGuardado<T>(clave) ?? inicial);
  useEffect(() => guardarEnTelefono(clave, valor), [clave, valor]);
  return [valor, setValor];
}
