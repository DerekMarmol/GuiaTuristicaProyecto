import type {
  EstadoParadaItinerario,
  ItinerarioActivo,
  Itinerario,
  Parada,
  ParadaPropuesta,
} from "../../../shared/types";

// Solo importa tipos para poder ejecutarse con `node --test` sin compilar.

export interface EstadoParadasDia {
  completadas: ReadonlySet<string>;
  descartadas: ReadonlySet<string>;
}

type ParadaDia = Parada & { estadoHorario?: string };

export function estadoDeParada(parada: ParadaDia, estado: EstadoParadasDia): EstadoParadaItinerario {
  if (estado.completadas.has(parada.id)) return "completada";
  if (estado.descartadas.has(parada.id) || parada.estadoHorario === "descartada") return "cancelada";
  return "pendiente";
}

export function construirItinerarioActivo(dia: Itinerario, estado: EstadoParadasDia): ItinerarioActivo {
  return {
    id: dia.id,
    fecha: dia.fecha,
    paradas: dia.paradas.map((parada) => ({
      id: parada.id,
      nombre: parada.nombre,
      lat: parada.lat,
      lng: parada.lng,
      horaApertura: parada.horaApertura,
      horaCierre: parada.horaCierre,
      tiempoEstanciaMinutos: parada.tiempoEstanciaMinutos,
      estado: estadoDeParada(parada, estado),
      ...(parada.placeId ? { placeId: parada.placeId } : {}),
      ...(parada.categorias?.length ? { categorias: parada.categorias } : {}),
      ...(parada.tipo_entorno && parada.sensibilidad_clima ? { tipo_entorno: parada.tipo_entorno, sensibilidad_clima: parada.sensibilidad_clima } : {}),
    })),
  };
}

// Identifica el estado del día para detectar si cambió entre la solicitud y la respuesta.
export function firmaItinerario(itinerario: ItinerarioActivo): string {
  return JSON.stringify([itinerario.id, itinerario.fecha, itinerario.paradas.map((p) => [p.id, p.estado, p.lat, p.lng, p.horaApertura, p.horaCierre, p.tiempoEstanciaMinutos])]);
}

export function tieneParadasPendientes(itinerario: ItinerarioActivo): boolean {
  return itinerario.paradas.some((p) => p.estado === "pendiente" || p.estado === "en_curso");
}

// Conserva en su lugar las paradas no pendientes y agrega al final las propuestas, igual que el backend al firmar.
export function aplicarParadasPropuestas<T extends ParadaDia>(paradas: readonly T[], estado: EstadoParadasDia, propuestas: readonly ParadaPropuesta[]): (T | ParadaPropuesta)[] {
  return [...paradas.filter((p) => estadoDeParada(p, estado) !== "pendiente"), ...propuestas];
}

export function fechaLocal(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

export function esDiaActivo(itinerario: ItinerarioActivo, ahora: Date): boolean {
  return itinerario.fecha === fechaLocal(ahora) && tieneParadasPendientes(itinerario);
}

// Cada solicitud recibe un número; solo la más reciente puede actualizar el estado.
export function crearControlSolicitudes() {
  let ultima = 0;
  let enCurso = false;
  return {
    iniciar(): number | null {
      if (enCurso) return null;
      enCurso = true;
      ultima += 1;
      return ultima;
    },
    terminar(id: number) {
      if (id === ultima) enCurso = false;
    },
    invalidar() {
      ultima += 1;
      enCurso = false;
    },
    esVigente(id: number): boolean {
      return id === ultima;
    },
  };
}
