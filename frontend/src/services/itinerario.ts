import type { Itinerario, Parada } from "../../../shared/types";
import type { ViajeBorrador } from "../context/ViajeContext";
import { tokenGuardado } from "./auth";

export const PASOS_GENERACION = [
  "Ubicando tu destino",
  "Buscando lugares según tus intereses",
  "Validando horarios de apertura",
  "Armando tu itinerario",
];

// El backend responde de una sola vez; mientras tanto el progreso avanza solo hasta el penúltimo paso.
const INTERVALO_PROGRESO_MS = 2500;

// Traslado desde la parada anterior con su margen de seguridad (GUI-34), tal como lo calcula el backend.
export interface TrasladoParada {
  tiempoBaseMinutos: number;
  tipoTraslado: "vehiculo" | "pie";
  desgloseHolgura: {
    margenEstandar: number;
    estacionamientoOAdicional: number;
    imprevistos: number;
    totalHolgura: number;
  };
  tiempoTotalConHolgura: number;
}

export interface ParadaConHorario extends Parada {
  estadoHorario?: "completa" | "ajustada" | "descartada";
  mensajeHorario?: string;
  horaInicioProgramada?: string;
  horaFinProgramada?: string;
  tiempoTrasladoMinutos?: number;
  tiempoTrasladoConHolguraMinutos?: number;
  holgura?: TrasladoParada;
  // El lugar no publica horario: horaApertura y horaCierre son las típicas de su tipo.
  horarioEstimado?: boolean;
  motivo?: string;
}

interface ParadaGenerada {
  id: string;
  placeId: string;
  nombre: string;
  lat: number;
  lng: number;
  horaApertura?: string;
  horaCierre?: string;
  tiempoEstanciaMinutos: number;
  llegada: string;
  salida: string;
  estadoEstancia: "completa" | "ajustada";
  traslado: TrasladoParada | null;
  categorias?: string[];
  tipo_entorno?: Parada["tipo_entorno"];
  sensibilidad_clima?: Parada["sensibilidad_clima"];
  horarioEstimado: boolean;
  motivo?: string;
}

interface RespuestaGeneracion {
  destino: { nombre: string; lat: number; lng: number; zonaHoraria: string };
  itinerarios: (Omit<Itinerario, "paradas"> & { paradas: ParadaGenerada[] })[];
  diasSinParadas: { numeroDia: number; fecha: string }[];
  advertencias: string[];
}

export interface ItinerarioGenerado {
  itinerarios: Itinerario[];
  destino: { lat: number; lng: number };
  advertencias: string[];
}

// "2026-10-22T09:00-06:00" -> "09:00"
const horaLocal = (instante: string) => instante.slice(11, 16);

function aParadaConHorario(p: ParadaGenerada): ParadaConHorario {
  const inicio = horaLocal(p.llegada);
  const fin = horaLocal(p.salida);
  return {
    id: p.id,
    placeId: p.placeId,
    nombre: p.nombre,
    lat: p.lat,
    lng: p.lng,
    // Si el horario publicado no se pudo resumir en un par de horas, se muestra la ventana de la visita.
    horaApertura: p.horaApertura ?? inicio,
    horaCierre: p.horaCierre ?? fin,
    tiempoEstanciaMinutos: p.tiempoEstanciaMinutos,
    ...(p.categorias ? { categorias: p.categorias } : {}),
    ...(p.tipo_entorno ? { tipo_entorno: p.tipo_entorno } : {}),
    ...(p.sensibilidad_clima ? { sensibilidad_clima: p.sensibilidad_clima } : {}),
    estadoHorario: p.estadoEstancia,
    ...(p.estadoEstancia === "ajustada"
      ? { mensajeHorario: `La estancia se ajustó a ${p.tiempoEstanciaMinutos} minutos para respetar el horario del lugar.` }
      : {}),
    horaInicioProgramada: inicio,
    horaFinProgramada: fin,
    tiempoTrasladoMinutos: p.traslado?.tiempoBaseMinutos ?? 0,
    tiempoTrasladoConHolguraMinutos: p.traslado?.tiempoTotalConHolgura ?? 0,
    ...(p.traslado ? { holgura: p.traslado } : {}),
    horarioEstimado: p.horarioEstimado,
    ...(p.motivo ? { motivo: p.motivo } : {}),
  };
}

export function convertirRespuesta(respuesta: RespuestaGeneracion): ItinerarioGenerado {
  const sinParadas = respuesta.diasSinParadas.map(
    (d) => `El día ${d.numeroDia} quedó sin paradas: no encontramos lugares abiertos cerca para esa fecha.`
  );
  return {
    itinerarios: respuesta.itinerarios.map((it) => ({ ...it, paradas: it.paradas.map(aParadaConHorario) })),
    destino: { lat: respuesta.destino.lat, lng: respuesta.destino.lng },
    advertencias: [...respuesta.advertencias, ...sinParadas],
  };
}

function solicitudDesdeViaje(viaje: ViajeBorrador, origen?: { lat: number; lng: number }) {
  return {
    // Dónde está el viajero al generar: el backend arma el día empezando por lo más cercano a este punto.
    ...(origen ? { origen: { lat: origen.lat, lng: origen.lng } } : {}),
    destino: viaje.destino,
    fechaInicio: viaje.fechaInicio,
    fechaFin: viaje.fechaFin,
    intereses: viaje.intereses && viaje.intereses.length > 0 ? viaje.intereses : ["Cultura"],
    tipoViaje: viaje.tipoViaje,
    transporte: viaje.transporte,
    presupuesto: viaje.presupuesto,
    presupuestoDiario: viaje.presupuestoDiario,
    hospedaje: viaje.hospedaje,
    nombreHotel: viaje.nombreHotel || undefined,
  };
}

export async function generarItinerario(
  viaje: ViajeBorrador,
  onProgreso?: (pasosListos: number) => void,
  signal?: AbortSignal,
  origen?: { lat: number; lng: number }
): Promise<ItinerarioGenerado> {
  if (!navigator.onLine) {
    throw new Error(
      "Sin conexión. Conéctate a internet para generar tu itinerario."
    );
  }

  let pasosListos = 0;
  onProgreso?.(pasosListos);
  const temporizador = setInterval(() => {
    if (pasosListos < PASOS_GENERACION.length - 1) {
      onProgreso?.(++pasosListos);
    }
  }, INTERVALO_PROGRESO_MS);

  try {
    let respuesta: Response;
    try {
      respuesta = await fetch("/api/itinerarios/generar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(solicitudDesdeViaje(viaje, origen)),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new Error("No se pudo conectar con el servidor. Inténtalo de nuevo en unos segundos.");
    }

    const cuerpo = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      throw new Error(cuerpo?.error?.mensaje ?? "No se pudo generar el itinerario.");
    }
    if (!Array.isArray(cuerpo?.itinerarios)) {
      throw new Error("El servidor devolvió un itinerario inválido.");
    }

    onProgreso?.(PASOS_GENERACION.length);
    return convertirRespuesta(cuerpo as RespuestaGeneracion);
  } finally {
    clearInterval(temporizador);
  }
}

/**
 * Descarga el itinerario en formato JSON desde el backend disparando
 * la descarga nativa del navegador mediante un blob.
 */
export async function exportarPlanViaje(viajeId: string): Promise<void> {
  // GUI-114: antes se buscaba en "token"/"jwt", que nadie escribe; la sesión vive en CLAVE_SESION.
  const token = tokenGuardado();

  const respuesta = await fetch(`${API_BASE_URL}/api/itinerarios/${viajeId}/exportar`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!respuesta.ok) {
    const errorData = await respuesta.json().catch(() => ({}));
    throw new Error(errorData.mensaje || "Error al descargar el archivo de exportación");
  }

  // Extraer el nombre de archivo de la cabecera o asignar uno por defecto
  const disposicion = respuesta.headers.get("content-disposition");
  let nombreArchivo = `itinerario_${viajeId.slice(0, 8)}.json`;
  if (disposicion && disposicion.includes("filename=")) {
    const match = disposicion.match(/filename="?([^"]+)"?/);
    if (match?.[1]) nombreArchivo = match[1];
  }

  // Generar la descarga nativa en el navegador
  const blob = await respuesta.blob();
  const urlDescarga = window.URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = urlDescarga;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  window.URL.revokeObjectURL(urlDescarga);
}

export interface ResultadoGuardado {
  exito: boolean;
  guardadoEn: "servidor" | "local";
  id?: string;
  mensaje: string;
}

// Vacío = mismo origen que la página (el proxy de Vite reenvía /api al backend), como el resto de servicios.
// Con "http://localhost:3000" fijo, desde el teléfono (por un túnel) apuntaba al propio teléfono.
const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || "";

export async function guardarPlanViaje(
  viaje: ViajeBorrador,
  itinerarios: Itinerario[]
): Promise<ResultadoGuardado> {
  // GUI-114: antes se buscaba en "token"/"jwt", que nadie escribe; la sesión vive en CLAVE_SESION.
  const token = tokenGuardado();

  // Construir el payload que espera el backend
  const payload = {
    destino: viaje.destino || "Destino Turístico",
    tipoViaje: viaje.tipoViaje || "solo",
    lat: viaje.lat ?? 14.6349,
    lng: viaje.lng ?? -90.5069,
    presupuesto: viaje.presupuesto ?? 0,
    transporte: viaje.transporte || "Automovil",
    intereses: viaje.intereses || [],
    fechaInicio: viaje.fechaInicio || new Date().toISOString(),
    fechaFin: viaje.fechaFin || new Date().toISOString(),
    hospedaje: viaje.hospedaje ?? false,
    nombreHotel: viaje.nombreHotel || undefined,
    dias: itinerarios.map((it) => ({
      numeroDia: it.numeroDia,
      fecha: it.fecha,
      paradas: it.paradas.map((p) => {
        const tipoEntorno =
          p.tipo_entorno === "indoor" ? "Bajo Techo" : "Al aire libre";
        const sensibilidad = p.sensibilidad_clima || "media";

        return {
          nombre: p.nombre,
          lat: p.lat,
          lng: p.lng,
          horaApertura: p.horaApertura || "08:00",
          horaCierre: p.horaCierre || "18:00",
          tiempoEstanciaMinutos: p.tiempoEstanciaMinutos || 60,
          placeId: p.placeId || null,
          restriccion: {
            tipoEntorno,
            sensibilidadClima: sensibilidad,
          },
        };
      }),
    })),
  };

  // 1. Criterio de aceptación: Si no está autenticado, no se pierde el plan (respaldo local)
  if (!token) {
    localStorage.setItem("plan_viaje_pendiente", JSON.stringify(payload));
    return {
      exito: true,
      guardadoEn: "local",
      mensaje: "Plan guardado localmente. Inicia sesión para registrarlo en tu cuenta.",
    };
  }

  // 2. Si está autenticado, enviar la petición al endpoint seguro del backend
  try {
    const respuesta = await fetch(`${API_BASE_URL}/api/itinerarios/guardar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const datos = await respuesta.json();

    if (respuesta.status === 201) {
      localStorage.setItem("ultimo_viaje_id", datos.id);
      localStorage.removeItem("plan_viaje_pendiente");
      return {
        exito: true,
        guardadoEn: "servidor",
        id: datos.id,
        mensaje: "¡Itinerario guardado exitosamente en tu cuenta!",
      };
    }

    if (respuesta.status === 401) {
      localStorage.setItem("plan_viaje_pendiente", JSON.stringify(payload));
      return {
        exito: false,
        guardadoEn: "local",
        mensaje: "Tu sesión expiró. El plan se respaldó localmente; inicia sesión para sincronizarlo.",
      };
    }

    throw new Error(datos.mensaje || "Error al procesar el guardado");
  } catch (error) {
    localStorage.setItem("plan_viaje_pendiente", JSON.stringify(payload));
    return {
      exito: false,
      guardadoEn: "local",
      mensaje: "Sin conexión con el servidor. Tu plan quedó resguardado en el navegador.",
    };
  }
}