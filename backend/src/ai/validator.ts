import type { HorarioLugar } from "../../../shared/types";
import { SalidaIASchema, MAX_PARADAS_POR_DIA } from "./schemas";
import { aMinutos, diasEntre, sumarDias } from "./fechas";
import type {
  DescarteParada,
  DiaSinParadas,
  ItinerarioIA,
  LugarReal,
  MotivoDescarte,
  ParadaIA,
  ViajeValidacion,
} from "./tipos";
import { crearPlanificadorDia, type EstimadorTraslado } from "./validacionApertura";
import { esHoraValida, esZonaHorariaValida } from "./zonaHoraria";

export const HORA_INICIO_PREDETERMINADA = "09:00";
export const ZONA_REFERENCIA_SIN_HORARIOS_REALES = "UTC";

export interface ResultadoValidacion {
  errores: string[];
  advertencias: string[];
  itinerarios: ItinerarioIA[];
  descartes: DescarteParada[];
  diasSinParadas: DiaSinParadas[];
  viable: boolean;
}

export interface LugarNoResuelto {
  motivo: MotivoDescarte;
  horario: HorarioLugar | null;
}

export interface OpcionesValidacion {
  lugaresNoResueltos?: ReadonlyMap<string, LugarNoResuelto>;
  estimarTraslado?: EstimadorTraslado;
}

const MENSAJE_POR_MOTIVO: Record<MotivoDescarte, string> = {
  cerrado: "estaría cerrado a la hora estimada de llegada",
  horario_no_publicado: "no tiene un horario publicado que permita verificar la apertura",
  horario_no_interpretable: "su horario publicado no se pudo interpretar",
  error_consulta: "no se pudo consultar su horario",
  apertura_desconocida: "su horario no permite confirmar que esté abierto a la hora estimada de llegada",
  lugar_no_resuelto: "no se pudieron confirmar sus datos con el proveedor",
  tiempo_insuficiente: "no tiene tiempo suficiente para la visita",
};

export function verificarZonaHoraria(viaje: ViajeValidacion, candidatos: LugarReal[]): string | null {
  if (viaje.zonaHoraria !== undefined && !esZonaHorariaValida(viaje.zonaHoraria)) {
    return `La zona horaria "${viaje.zonaHoraria}" no es un identificador IANA válido.`;
  }
  if (viaje.zonaHoraria === undefined && candidatos.some((c) => c.horario !== undefined)) {
    return "Falta la zona horaria IANA del destino; sin ella no se puede verificar la apertura de los lugares.";
  }
  if (viaje.horaInicio !== undefined && !esHoraValida(viaje.horaInicio)) {
    return `La hora de inicio "${viaje.horaInicio}" no tiene el formato HH:MM.`;
  }
  return null;
}

function resultadoInvalido(errores: string[]): ResultadoValidacion {
  return { errores, advertencias: [], itinerarios: [], descartes: [], diasSinParadas: [], viable: false };
}

export function validarSalida(
  raw: unknown,
  candidatos: LugarReal[],
  viaje: ViajeValidacion,
  opciones: OpcionesValidacion = {}
): ResultadoValidacion {
  const errores: string[] = [];
  const advertencias: string[] = [];
  const descartes: DescarteParada[] = [];
  const parsed = SalidaIASchema.safeParse(raw);

  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      errores.push(
        `Formato inválido en "${i.path.join(".")}": ${i.message}`
      );
    }

    return resultadoInvalido(errores);
  }

  const errorZona = verificarZonaHoraria(viaje, candidatos);
  if (errorZona) {
    return resultadoInvalido([errorZona]);
  }

  const zonaHoraria = viaje.zonaHoraria ?? ZONA_REFERENCIA_SIN_HORARIOS_REALES;
  const horaInicio = viaje.horaInicio ?? HORA_INICIO_PREDETERMINADA;
  const porId = new Map(candidatos.map((c) => [c.placeId, c]));
  const totalDias = diasEntre(viaje.fechaInicio, viaje.fechaFin);

  const usados = new Set<string>();
  const vistos = new Set<number>();
  const itinerarios: ItinerarioIA[] = [];

  for (const dia of parsed.data.dias) {
    if (dia.numeroDia > totalDias) {
      errores.push(
        `El día ${dia.numeroDia} no existe: el viaje solo tiene ${totalDias} día(s).`
      );
      continue;
    }

    if (vistos.has(dia.numeroDia)) {
      errores.push(`El día ${dia.numeroDia} aparece repetido.`);
      continue;
    }

    vistos.add(dia.numeroDia);

    const fecha = sumarDias(viaje.fechaInicio, dia.numeroDia - 1);
    const planificador = crearPlanificadorDia({
      fecha,
      horaInicio,
      zonaHoraria,
      estimar: opciones.estimarTraslado,
    });

    if (!planificador) {
      errores.push(
        `Día ${dia.numeroDia}: la hora de inicio ${horaInicio} no existe el ${fecha} en la zona ${zonaHoraria}.`
      );
      continue;
    }

    const paradas: ParadaIA[] = [];

    const descartar = (
      placeId: string,
      nombre: string | null,
      motivo: MotivoDescarte,
      llegada: string | null,
      horario: HorarioLugar | null
    ) => {
      const mensaje =
        `Día ${dia.numeroDia}: "${nombre ?? placeId}" fue descartado porque ${MENSAJE_POR_MOTIVO[motivo]}` +
        (llegada ? ` (llegada estimada ${llegada}).` : ".");
      descartes.push({ numeroDia: dia.numeroDia, fecha, placeId, nombre, motivo, mensaje, llegada, horario });
      advertencias.push(mensaje);
    };

    for (const p of dia.paradas) {
      const noResuelto = opciones.lugaresNoResueltos?.get(p.placeId);

      if (noResuelto) {
        descartar(p.placeId, null, noResuelto.motivo, null, noResuelto.horario);
        continue;
      }

      const real = porId.get(p.placeId);

      // Validar que el lugar exista
      if (!real) {
        errores.push(
          `Día ${dia.numeroDia}: el placeId "${p.placeId}" NO existe en la lista de candidatos (inventado).`
        );
        continue;
      }

      // Evitar lugares repetidos
      if (usados.has(p.placeId)) {
        errores.push(
          `Día ${dia.numeroDia}: "${real.nombre}" ya está en otro punto del plan; no repitas lugares.`
        );
        continue;
      }

      // Máximo de paradas permitidas
      if (paradas.length >= MAX_PARADAS_POR_DIA) {
        errores.push(
          `Día ${dia.numeroDia}: máximo ${MAX_PARADAS_POR_DIA} paradas por día.`
        );
        continue;
      }

      if (
        real.horario === undefined &&
        real.intervalosHorario === undefined &&
        real.horaApertura !== undefined &&
        real.horaCierre !== undefined
      ) {
        // Compatibilidad con lugares que solo tienen apertura y cierre
        const ventana =
          aMinutos(real.horaCierre) -
          aMinutos(real.horaApertura);

        if (p.tiempoEstanciaMinutos > ventana) {
          errores.push(
            `Día ${dia.numeroDia}: "${real.nombre}" abre ${real.horaApertura}-${real.horaCierre} (${ventana} min); ` +
            `no cabe una estancia de ${p.tiempoEstanciaMinutos} min.`
          );
          continue;
        }
      }

      const visita = planificador.evaluar(real, p.tiempoEstanciaMinutos);

      if (!visita.aceptada) {
        descartar(real.placeId, real.nombre, visita.motivo, visita.llegada, real.horario ?? null);
        continue;
      }

      if (visita.estado === "ajustada") {
        advertencias.push(
          `Día ${dia.numeroDia}: la estancia en "${real.nombre}" se ajustó a ${visita.duracionMinutos} minutos por su horario de atención.`
        );
      }

      usados.add(p.placeId);

      paradas.push({
        id: `p${dia.numeroDia}-${paradas.length + 1}`,
        placeId: real.placeId,
        nombre: real.nombre,
        lat: real.lat,
        lng: real.lng,
        ...(real.direccion !== undefined ? { direccion: real.direccion } : {}),
        ...(real.horaApertura !== undefined ? { horaApertura: real.horaApertura } : {}),
        ...(real.horaCierre !== undefined ? { horaCierre: real.horaCierre } : {}),
        ...(real.horario !== undefined ? { horario: real.horario } : {}),
        tiempoEstanciaMinutos: visita.duracionMinutos,
        llegada: visita.llegada,
        salida: visita.salida,
        estadoEstancia: visita.estado,
        traslado: visita.traslado,
        motivo: p.motivo,
      });
    }

    if (paradas.length > 0) {
      itinerarios.push({
        id: `it-${dia.numeroDia}`,
        viajeId: viaje.id,
        numeroDia: dia.numeroDia,
        fecha,
        paradas,
      });
    }
  }

  const diasSinParadas: DiaSinParadas[] = [];

  // Comprobar que todos los días tengan paradas válidas
  for (let d = 1; d <= totalDias; d++) {
    if (!itinerarios.some((it) => it.numeroDia === d)) {
      diasSinParadas.push({ numeroDia: d, fecha: sumarDias(viaje.fechaInicio, d - 1) });
      errores.push(
        `Falta el día ${d} (o no quedó ninguna parada válida).`
      );
    }
  }

  itinerarios.sort((a, b) => a.numeroDia - b.numeroDia);

  return {
    errores,
    advertencias,
    itinerarios,
    descartes,
    diasSinParadas,
    viable: diasSinParadas.length === 0,
  };
}
