import type { RespuestaLugaresAbiertosAhora } from "../../../shared/types";
import type { ConsultaAbiertosAhora } from "./abiertosAhora";
import type { MotivoSinUbicacion, UbicacionActual } from "./ubicacionActual";

// "actual" viene del GPS del navegador; "manual" es un punto que eligió el usuario y nunca se presenta como su ubicación.
export type ReferenciaBusqueda =
  | ({ tipo: "actual" } & UbicacionActual)
  | { tipo: "manual"; lat: number; lng: number; etiqueta: string };

export type EstadoAbiertosAhora =
  | { fase: "inactivo" }
  | { fase: "ubicando" }
  | { fase: "sin_ubicacion"; motivo: MotivoSinUbicacion; mensaje: string }
  | { fase: "cargando"; referencia: ReferenciaBusqueda }
  | { fase: "listo"; referencia: ReferenciaBusqueda; respuesta: RespuestaLugaresAbiertosAhora }
  | { fase: "error"; referencia: ReferenciaBusqueda; mensaje: string; codigo: string };

export interface DependenciasAbiertosAhora {
  obtenerUbicacion: () => Promise<UbicacionActual>;
  consultar: (consulta: ConsultaAbiertosAhora, signal: AbortSignal) => Promise<RespuestaLugaresAbiertosAhora>;
}

export interface ControladorAbiertosAhora {
  obtenerEstado: () => EstadoAbiertosAhora;
  suscribir: (oyente: () => void) => () => void;
  alternar: () => void;
  activar: () => void;
  desactivar: () => void;
  actualizarUbicacion: () => void;
  usarPuntoManual: (punto: { lat: number; lng: number; etiqueta: string }) => void;
  reintentar: () => void;
  cambiarIntereses: (intereses: readonly string[]) => void;
}

const MOTIVOS = new Set<string>(["no_soportada", "permiso_denegado", "no_disponible", "tiempo_agotado", "coordenadas_invalidas", "ubicacion_antigua"]);

function motivoDe(error: unknown): MotivoSinUbicacion {
  const motivo = (error as { motivo?: unknown } | null)?.motivo;
  return typeof motivo === "string" && MOTIVOS.has(motivo) ? (motivo as MotivoSinUbicacion) : "no_disponible";
}

function puntoValido(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// Cada búsqueda recibe un número de generación; desactivar o iniciar otra búsqueda lo incrementa,
// así una respuesta tardía nunca reactiva el modo ni reemplaza resultados más recientes.
export function crearControladorAbiertosAhora({ obtenerUbicacion, consultar }: DependenciasAbiertosAhora): ControladorAbiertosAhora {
  let estado: EstadoAbiertosAhora = { fase: "inactivo" };
  let generacion = 0;
  let abortador: AbortController | null = null;
  let referencia: ReferenciaBusqueda | null = null;
  let intereses: string[] = [];
  const oyentes = new Set<() => void>();

  function fijar(nuevo: EstadoAbiertosAhora) {
    estado = nuevo;
    oyentes.forEach((oyente) => oyente());
  }

  function nuevaGeneracion(): number {
    generacion += 1;
    abortador?.abort();
    abortador = null;
    return generacion;
  }

  async function buscar(desde: ReferenciaBusqueda, id: number) {
    const controlador = new AbortController();
    abortador = controlador;
    fijar({ fase: "cargando", referencia: desde });
    try {
      const respuesta = await consultar({ lat: desde.lat, lng: desde.lng, intereses }, controlador.signal);
      if (id !== generacion) return;
      fijar({ fase: "listo", referencia: desde, respuesta });
    } catch (error) {
      if (id !== generacion) return;
      const codigo = (error as { codigo?: unknown } | null)?.codigo;
      fijar({
        fase: "error",
        referencia: desde,
        mensaje: error instanceof Error && error.message ? error.message : "No se pudieron consultar los lugares abiertos.",
        codigo: typeof codigo === "string" ? codigo : "ERROR",
      });
    } finally {
      if (abortador === controlador) abortador = null;
    }
  }

  async function ubicarYBuscar(id: number) {
    fijar({ fase: "ubicando" });
    let ubicacion: UbicacionActual;
    try {
      ubicacion = await obtenerUbicacion();
    } catch (error) {
      if (id !== generacion) return;
      const motivo = motivoDe(error);
      fijar({ fase: "sin_ubicacion", motivo, mensaje: error instanceof Error && error.message ? error.message : "No se pudo obtener tu ubicación." });
      return;
    }
    if (id !== generacion) return;
    referencia = { tipo: "actual", ...ubicacion };
    await buscar(referencia, id);
  }

  const controlador: ControladorAbiertosAhora = {
    obtenerEstado: () => estado,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => {
        oyentes.delete(oyente);
      };
    },
    activar() {
      if (estado.fase !== "inactivo") return;
      void ubicarYBuscar(nuevaGeneracion());
    },
    desactivar() {
      nuevaGeneracion();
      referencia = null;
      if (estado.fase !== "inactivo") fijar({ fase: "inactivo" });
    },
    alternar() {
      if (estado.fase === "inactivo") controlador.activar();
      else controlador.desactivar();
    },
    actualizarUbicacion() {
      if (estado.fase === "inactivo" || estado.fase === "ubicando" || estado.fase === "cargando") return;
      void ubicarYBuscar(nuevaGeneracion());
    },
    usarPuntoManual({ lat, lng, etiqueta }) {
      if (estado.fase === "inactivo" || estado.fase === "cargando" || !puntoValido(lat, lng)) return;
      referencia = { tipo: "manual", lat, lng, etiqueta };
      void buscar(referencia, nuevaGeneracion());
    },
    reintentar() {
      if (estado.fase === "error" && referencia) void buscar(referencia, nuevaGeneracion());
      else if (estado.fase === "sin_ubicacion") void ubicarYBuscar(nuevaGeneracion());
    },
    cambiarIntereses(lista) {
      intereses = [...lista];
      if (referencia && (estado.fase === "listo" || estado.fase === "error" || estado.fase === "cargando")) {
        void buscar(referencia, nuevaGeneracion());
      }
    },
  };
  return controlador;
}
