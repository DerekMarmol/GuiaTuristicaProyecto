import { createContext, useContext, useState, type ReactNode } from "react";
import type { Usuario } from "../types/auth";
import { CLAVE_SESION, iniciarSesionApi, registrarUsuario } from "../services/auth";

interface Sesion {
  usuario: Usuario;
  token: string;
}

interface AuthContextValue {
  usuario: Usuario | null;
  token: string | null; 
  iniciarSesion: (correo: string, contrasena: string) => Promise<void>;
  registrar: (nombre: string, correo: string, contrasena: string) => Promise<void>;
  cerrarSesion: () => void;
}

const CLAVE = CLAVE_SESION;
const AuthContext = createContext<AuthContextValue | null>(null);

function leerSesion(): Sesion | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    return crudo ? (JSON.parse(crudo) as Sesion) : null;
  } catch {
    return null;
  }
}

function guardarSesion(sesion: Sesion | null) {
  try {
    if (sesion) localStorage.setItem(CLAVE, JSON.stringify(sesion));
    else localStorage.removeItem(CLAVE);
  } catch {
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion);

  const abrir = (s: Sesion) => {
    setSesion(s);
    guardarSesion(s);
  };

  const iniciarSesion = async (correo: string, contrasena: string) => {
    abrir(await iniciarSesionApi(correo, contrasena));
  };

  const registrar = async (nombre: string, correo: string, contrasena: string) => {
    abrir(await registrarUsuario(nombre, correo, contrasena));
  };

  const cerrarSesion = () => {
    setSesion(null);
    guardarSesion(null);
  };

  return (
    <AuthContext.Provider
      value={{ usuario: sesion?.usuario ?? null, token: sesion?.token ?? null, iniciarSesion, registrar, cerrarSesion }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}