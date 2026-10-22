import type { Itinerario, Parada, Viaje } from "../../../shared/types";
import type { ViajeBorrador } from "../context/ViajeContext";
import { diasDeViaje } from "../utils/fechas";

// GUI-114: planes que el usuario guardó en su cuenta, para recuperarlos en otro dispositivo o después de
// borrar los datos del teléfono.

export interface ResumenPlan {
  id: string;
  destino: string;
  fechaInicio: string;
  fechaFin: string;
  creadoEn: string;
  totalDias: number;
  totalParadas: number;
}

interface ParadaGuardada {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  horaApertura: string;
  horaCierre: string;
  tiempoEstanciaMinutos: number;
  placeId: string | null;
  restriccion: { tipoEntorno: string; sensibilidadClima: string } | null;
}

interface PlanGuardado {
  id: string;
  destino: string;
  tipoViaje: Viaje["tipoViaje"];
  lat: number;
  lng: number;
  presupuesto: number;
  transporte: Viaje["transporte"];
  intereses: string[];
  fechaInicio: string;
  fechaFin: string;
  hospedaje: boolean;
  nombreHotel: string | null;
  itinerarios: { id: string; numeroDia: number; fecha: string; paradas: ParadaGuardada[] }[];
}

async function pedir<T>(ruta: string, token: string): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error("No se pudo conectar con el servidor para traer tus planes.");
  }
  const datos = await respuesta.json().catch(() => null);
  if (respuesta.status === 401) {
    throw new Error("Tu sesión expiró. Vuelve a iniciar sesión para ver tus planes.");
  }
  if (!respuesta.ok) {
    throw new Error(datos?.mensaje ?? "No se pudieron traer tus planes guardados.");
  }
  return datos as T;
}

const soloFecha = (fecha: string) => fecha.slice(0, 10);

const SENSIBILIDADES: Parada["sensibilidad_clima"][] = ["baja", "media", "alta"];

function aParada(p: ParadaGuardada): Parada {
  const sensibilidad = SENSIBILIDADES.find((s) => s === p.restriccion?.sensibilidadClima);
  return {
    id: p.id,
    nombre: p.nombre,
    lat: p.lat,
    lng: p.lng,
    horaApertura: p.horaApertura,
    horaCierre: p.horaCierre,
    tiempoEstanciaMinutos: p.tiempoEstanciaMinutos,
    ...(p.placeId ? { placeId: p.placeId } : {}),
    ...(p.restriccion ? { tipo_entorno: p.restriccion.tipoEntorno === "Bajo Techo" ? ("indoor" as const) : ("outdoor" as const) } : {}),
    ...(sensibilidad ? { sensibilidad_clima: sensibilidad } : {}),
  };
}

// Convierte un plan del servidor al viaje y los días que usa el paso 4.
export function convertirPlan(plan: PlanGuardado): { viaje: ViajeBorrador; itinerarios: Itinerario[] } {
  const fechaInicio = soloFecha(plan.fechaInicio);
  const fechaFin = soloFecha(plan.fechaFin);
  const dias = Math.max(1, diasDeViaje(fechaInicio, fechaFin));
  return {
    viaje: {
      destino: plan.destino,
      tipoViaje: plan.tipoViaje,
      lat: plan.lat,
      lng: plan.lng,
      presupuesto: plan.presupuesto,
      presupuestoDiario: plan.presupuesto > 0 ? Math.round(plan.presupuesto / dias) : undefined,
      transporte: plan.transporte,
      intereses: plan.intereses,
      fechaInicio,
      fechaFin,
      hospedaje: plan.hospedaje,
      ...(plan.nombreHotel ? { nombreHotel: plan.nombreHotel } : {}),
      idPlanGuardado: plan.id,
    },
    itinerarios: plan.itinerarios.map((it) => ({
      id: it.id,
      viajeId: plan.id,
      numeroDia: it.numeroDia,
      fecha: soloFecha(it.fecha),
      paradas: it.paradas.map(aParada),
    })),
  };
}

export async function listarPlanes(token: string): Promise<ResumenPlan[]> {
  const { planes } = await pedir<{ planes: ResumenPlan[] }>("/api/itinerarios/mis-planes", token);
  return planes;
}

export async function abrirPlan(token: string, id: string) {
  const { plan } = await pedir<{ plan: PlanGuardado }>(`/api/itinerarios/${encodeURIComponent(id)}`, token);
  return convertirPlan(plan);
}
