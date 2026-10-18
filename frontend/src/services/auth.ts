import type { RespuestaAuth } from "../types/auth";
const RUTA_REGISTRO = "/api/auth/registro";
const RUTA_LOGIN = "/api/auth/login";

const SIMULADO = import.meta.env.VITE_AUTH_SIMULADO === "true";

export class ErrorAuth extends Error {
  constructor(message: string, readonly estado?: number) {
    super(message);
  }
}

async function enviar(ruta: string, cuerpo: object): Promise<RespuestaAuth> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorAuth("No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.");
  }

  let datos: any = null;
  try {
    datos = await respuesta.json();
  } catch {
    
  }

  if (!respuesta.ok) {
    const delServidor: string | undefined = datos?.mensaje ?? datos?.error;
    if (respuesta.status === 401) throw new ErrorAuth("Correo o contraseña incorrectos.", 401);
    if (respuesta.status === 409) throw new ErrorAuth("Ya existe una cuenta con ese correo.", 409);
    if (respuesta.status === 400 || respuesta.status === 422) {
      throw new ErrorAuth(delServidor ?? "Revisa los datos e inténtalo de nuevo.", respuesta.status);
    }
    throw new ErrorAuth("Ocurrió un problema en el servidor. Inténtalo más tarde.", respuesta.status);
  }

  if (!datos?.token || !datos?.usuario) {
    throw new ErrorAuth("El servidor respondió con un formato inesperado.", respuesta.status);
  }
  return datos as RespuestaAuth;
}

const cuentasSimuladas = new Map<string, { nombre: string; contrasena: string }>();
const pausa = () => new Promise((r) => setTimeout(r, 600));

async function registroSimulado(nombre: string, correo: string, contrasena: string): Promise<RespuestaAuth> {
  await pausa();
  if (cuentasSimuladas.has(correo)) throw new ErrorAuth("Ya existe una cuenta con ese correo.", 409);
  cuentasSimuladas.set(correo, { nombre, contrasena });
  return { usuario: { id: `sim-${correo}`, nombre, correo }, token: "token-simulado" };
}

async function loginSimulado(correo: string, contrasena: string): Promise<RespuestaAuth> {
  await pausa();
  const cuenta = cuentasSimuladas.get(correo);
  if (!cuenta || cuenta.contrasena !== contrasena) throw new ErrorAuth("Correo o contraseña incorrectos.", 401);
  return { usuario: { id: `sim-${correo}`, nombre: cuenta.nombre, correo }, token: "token-simulado" };
}

export function registrarUsuario(nombre: string, correo: string, contrasena: string): Promise<RespuestaAuth> {
  const c = correo.trim().toLowerCase();
  return SIMULADO ? registroSimulado(nombre.trim(), c, contrasena) : enviar(RUTA_REGISTRO, { nombre: nombre.trim(), correo: c, contrasena });
}

export function iniciarSesionApi(correo: string, contrasena: string): Promise<RespuestaAuth> {
  const c = correo.trim().toLowerCase();
  return SIMULADO ? loginSimulado(c, contrasena) : enviar(RUTA_LOGIN, { correo: c, contrasena });
}