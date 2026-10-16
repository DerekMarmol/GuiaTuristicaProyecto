import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { ErrorAuth } from "../services/auth";
import "./pasos.css";

type Modo = "login" | "registro";

interface Props {
  onListo: () => void;
  onCancelar: () => void;
}

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PantallaAuth({ onListo, onCancelar }: Props) {
  const { iniciarSesion, registrar } = useAuth();
  const [modo, setModo] = useState<Modo>("login");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState("");
  const [enviando, setEnviando] = useState(false);

  const esRegistro = modo === "registro";

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    setErrores({});
    setErrorGeneral("");
  }

  function limpiar(campo: string) {
    setErrores((e) => {
      if (!e[campo]) return e;
      const { [campo]: _quitado, ...resto } = e;
      return resto;
    });
  }

  function validar(): Record<string, string> {
    const e: Record<string, string> = {};
    if (esRegistro && nombre.trim().length < 2) e.nombre = "Escribe tu nombre.";
    if (!CORREO_VALIDO.test(correo.trim())) e.correo = "Escribe un correo válido.";
    if (esRegistro) {
      if (contrasena.length < 8) e.contrasena = "Usa al menos 8 caracteres.";
      if (confirmar !== contrasena) e.confirmar = "Las contraseñas no coinciden.";
    } else if (!contrasena) {
      e.contrasena = "Escribe tu contraseña.";
    }
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setErrorGeneral("");
    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) return;

    setEnviando(true);
    try {
      if (esRegistro) await registrar(nombre, correo, contrasena);
      else await iniciarSesion(correo, contrasena);
      onListo();
    } catch (err) {
      setErrorGeneral(err instanceof ErrorAuth ? err.message : "No se pudo completar la solicitud.");
      setEnviando(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2 id="t-auth">{esRegistro ? "Crea tu cuenta" : "Inicia sesión"}</h2>
      <p className="nota">
        {esRegistro
          ? "Guarda tus viajes y vuelve a ellos cuando quieras."
          : "Entra para ver y guardar tus viajes."}
      </p>

      <div className="dias" role="tablist" aria-label="Acceso">
        <button type="button" role="tab" aria-selected={!esRegistro} className="dia" onClick={() => cambiarModo("login")}>
          Iniciar sesión
        </button>
        <button type="button" role="tab" aria-selected={esRegistro} className="dia" onClick={() => cambiarModo("registro")}>
          Crear cuenta
        </button>
      </div>

      {esRegistro && (
        <>
          <label htmlFor="auth-nombre">Nombre</label>
          <input
            id="auth-nombre"
            type="text"
            autoComplete="name"
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); limpiar("nombre"); }}
            aria-invalid={!!errores.nombre}
            aria-describedby={errores.nombre ? "err-nombre" : undefined}
          />
          {errores.nombre && <p id="err-nombre" className="error" role="alert">{errores.nombre}</p>}
        </>
      )}

      <label htmlFor="auth-correo">Correo electrónico</label>
      <input
        id="auth-correo"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="tu@correo.com"
        value={correo}
        onChange={(e) => { setCorreo(e.target.value); limpiar("correo"); }}
        aria-invalid={!!errores.correo}
        aria-describedby={errores.correo ? "err-correo" : undefined}
      />
      {errores.correo && <p id="err-correo" className="error" role="alert">{errores.correo}</p>}

      <label htmlFor="auth-clave">Contraseña</label>
      <div className="campo-clave">
        <input
          id="auth-clave"
          type={verClave ? "text" : "password"}
          autoComplete={esRegistro ? "new-password" : "current-password"}
          value={contrasena}
          onChange={(e) => { setContrasena(e.target.value); limpiar("contrasena"); }}
          aria-invalid={!!errores.contrasena}
          aria-describedby={errores.contrasena ? "err-clave" : undefined}
        />
        <button
          type="button"
          className="ver-clave"
          aria-pressed={verClave}
          aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
          onClick={() => setVerClave((v) => !v)}
        >
          {verClave ? "Ocultar" : "Ver"}
        </button>
      </div>
      {errores.contrasena && <p id="err-clave" className="error" role="alert">{errores.contrasena}</p>}

      {esRegistro && (
        <>
          <label htmlFor="auth-confirmar">Confirmar contraseña</label>
          <input
            id="auth-confirmar"
            type={verClave ? "text" : "password"}
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => { setConfirmar(e.target.value); limpiar("confirmar"); }}
            aria-invalid={!!errores.confirmar}
            aria-describedby={errores.confirmar ? "err-confirmar" : undefined}
          />
          {errores.confirmar && <p id="err-confirmar" className="error" role="alert">{errores.confirmar}</p>}
        </>
      )}

      {errorGeneral && <p className="aviso-error" role="alert">{errorGeneral}</p>}

      <div className="acciones">
        <button type="button" className="btn-secundario" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </button>
        <button type="submit" className="btn-primario" disabled={enviando}>
          {enviando ? "Un momento…" : esRegistro ? "Crear cuenta" : "Entrar"}
        </button>
      </div>

      <button type="button" className="enlace" onClick={onCancelar}>
        Continuar sin cuenta
      </button>
    </form>
  );
}