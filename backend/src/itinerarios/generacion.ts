import type { ClienteLLM } from "../ai/cliente";
import { diasEntre } from "../ai/fechas";
import { ErrorGeneracionIA, generarItinerarios, type MotivoFalloIA } from "../ai/generarItinerario";
import type { DescarteParada, DiaSinParadas, ItinerarioIA, ViajeIA } from "../ai/tipos";
import { HORA_INICIO_PREDETERMINADA, validarSalida } from "../ai/validator";
import { ErrorApi } from "../errores";
import type { BuscarLugares } from "../geoapify/cliente";
import type { EnriquecerHorarios } from "../geoapify/enriquecer";
import type { DestinoGeocodificado, Geocodificar } from "../geoapify/geocodificacion";
import { ventanasDelDia } from "../geoapify/horario";
import { minutosDesdeHora } from "../ai/validacionEstancia";
import type { SolicitudGeneracion } from "../validacion/generacion";
import { buscarCandidatos, type Candidato } from "./candidatos";
import { planificarSinIA } from "./planRespaldo";
import type { ConsultarClima } from "../clima/servicio";
import type { BuscarEnFoursquare } from "../foursquare/cliente";
import { diasConLluvia, horaDeArranqueHoy, origenCercano } from "./contexto";

// Qué se le dice al usuario cuando la IA no arma el plan y lo hace el planificador automático.
const AVISO_FALLO_IA: Record<MotivoFalloIA, string> = {
  cuota_agotada: "La IA alcanzó su límite de uso por hoy; el itinerario se armó con el planificador automático.",
  modelo_saturado: "La IA está saturada en este momento; el itinerario se armó con el planificador automático. Puedes regenerarlo en unos minutos.",
  error_modelo: "No se pudo conectar con la IA; el itinerario se armó con el planificador automático.",
  plan_invalido: "La IA no logró un plan que cumpla los horarios; el itinerario se armó con el planificador automático.",
};

// El itinerario se arma antes de guardarse: el id definitivo lo asigna /api/itinerarios/guardar.
const ID_VIAJE_BORRADOR = "borrador";
// El planificador no espera a que un lugar abra: si a la hora pedida no hay nada abierto (por ejemplo,
// un destino con solo restaurantes), el plan de respaldo prueba empezar el día más tarde.
const HORAS_DE_INICIO_ALTERNATIVAS = ["10:00", "11:00", "12:00"];

export type ParadaGenerada = ItinerarioIA["paradas"][number] & { horarioEstimado: boolean };
export type ItinerarioGeneradoDia = Omit<ItinerarioIA, "paradas"> & { paradas: ParadaGenerada[] };

export interface ItinerarioGenerado {
  destino: DestinoGeocodificado;
  zonaHoraria: string;
  horaInicio: string;
  generadoCon: "ia" | "respaldo";
  viable: boolean;
  itinerarios: ItinerarioGeneradoDia[];
  descartes: DescarteParada[];
  diasSinParadas: DiaSinParadas[];
  advertencias: string[];
}

export type GenerarItinerario = (solicitud: SolicitudGeneracion) => Promise<ItinerarioGenerado>;

function aHora(minutos: number): string {
  const acotados = Math.min(minutos, 23 * 60 + 59);
  return `${String(Math.floor(acotados / 60)).padStart(2, "0")}:${String(acotados % 60).padStart(2, "0")}`;
}

// Apertura y cierre del día de la visita, a partir del horario publicado: el frontend (tarjeta, mapa y
// monitoreo del clima) muestra un par de horas, no la regla completa de OpenStreetMap.
function horarioDelDia(parada: ItinerarioIA["paradas"][number], fecha: string): { horaApertura?: string; horaCierre?: string } {
  if (parada.horaApertura && parada.horaCierre) {
    return {};
  }
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const resultado = ventanasDelDia(parada.horario, { anio, mes, dia });
  if (resultado.estado !== "disponible" || resultado.ventanas.length === 0) {
    return {};
  }
  const llegada = minutosDesdeHora(parada.llegada.slice(11, 16));
  const ventana =
    resultado.ventanas.find((v) => v.inicioMinutos <= llegada && llegada < v.finMinutos) ?? resultado.ventanas[0];
  return { horaApertura: aHora(ventana.inicioMinutos), horaCierre: aHora(ventana.finMinutos) };
}

// Agrega a cada parada la clasificación climática del lugar, que el frontend usa para el monitoreo del clima,
// su horario del día y si ese horario es estimado, para que el frontend pida confirmarlo.
function completarParadas(itinerarios: ItinerarioIA[], candidatos: Candidato[]): ItinerarioGeneradoDia[] {
  const porId = new Map(candidatos.map((c) => [c.placeId, c]));
  return itinerarios.map((it) => ({
    ...it,
    paradas: it.paradas.map((parada) => {
      const candidato = porId.get(parada.placeId);
      const base = { ...parada, ...horarioDelDia(parada, it.fecha) };
      if (!candidato) {
        return { ...base, horarioEstimado: false };
      }
      const { lugar } = candidato;
      return {
        ...base,
        categorias: lugar.categorias,
        tipo_entorno: lugar.tipo_entorno,
        sensibilidad_clima: lugar.sensibilidad_clima,
        horarioEstimado: candidato.horarioEstimado,
      };
    }),
  }));
}

// Al regenerar, si no hubo suficientes lugares distintos cerca, se dice cuántos se repitieron.
function avisoRepetidos(itinerarios: ItinerarioGeneradoDia[], evitar: ReadonlySet<string>): string[] {
  if (evitar.size === 0) return [];
  const repetidos = itinerarios.flatMap((it) => it.paradas).filter((p) => evitar.has(p.placeId)).length;
  return repetidos === 0
    ? []
    : [`Cerca no hay suficientes lugares distintos para cambiar todo el plan: se repite(n) ${repetidos} del anterior.`];
}

function avisoHorariosEstimados(itinerarios: ItinerarioGeneradoDia[]): string[] {
  const estimadas = itinerarios.flatMap((it) => it.paradas).filter((p) => p.horarioEstimado).length;
  return estimadas === 0 ? [] : [`${estimadas} parada(s) no publican horario; se usó uno típico de su tipo. Confírmalo antes de ir.`];
}

export function crearGeneradorItinerario({
  geocodificar,
  buscarLugares,
  enriquecerHorarios,
  cliente,
  consultarClima,
  buscarEnFoursquare = null,
  ahora = () => new Date(),
}: {
  geocodificar: Geocodificar;
  buscarLugares: BuscarLugares;
  enriquecerHorarios: EnriquecerHorarios;
  cliente?: ClienteLLM;
  consultarClima?: ConsultarClima;
  // GUI-117: segunda fuente de lugares (comercios y restaurantes); null si no hay FOURSQUARE_API_KEY.
  buscarEnFoursquare?: BuscarEnFoursquare | null;
  ahora?: () => Date;
}): GenerarItinerario {
  return async function generarItinerario(solicitud) {
    const geocodificado = await geocodificar(solicitud.destino);
    if (!geocodificado) {
      throw new ErrorApi(
        422,
        "DESTINO_NO_ENCONTRADO",
        `No encontramos "${solicitud.destino}" en Guatemala. Revisa el nombre o agrega el departamento.`,
      );
    }

    const totalDias = diasEntre(solicitud.fechaInicio, solicitud.fechaFin);
    const [{ candidatos, centro }, lluvia] = await Promise.all([
      buscarCandidatos({
        destino: geocodificado,
        intereses: solicitud.intereses,
        dias: totalDias,
        transporte: solicitud.transporte,
        buscarLugares,
        enriquecerHorarios,
        buscarEnFoursquare,
      }),
      diasConLluvia(consultarClima, geocodificado, solicitud.fechaInicio, solicitud.fechaFin),
    ]);
    // En un departamento o municipio el viaje (mapa, punto de partida, orden de las paradas) se centra en su
    // lugar principal, no en el centro geográfico.
    const destino = { ...geocodificado, ...centro };
    if (candidatos.length === 0) {
      throw new ErrorApi(422, "SIN_LUGARES", "No encontramos lugares cerca del destino para tus intereses. Prueba con otros intereses.");
    }

    const advertencias: string[] = [];
    const interesesSinLugares = solicitud.intereses.filter((interes) => !candidatos.some((c) => c.interes === interes));
    if (interesesSinLugares.length > 0) {
      advertencias.push(`No encontramos lugares de ${interesesSinLugares.join(", ")} cerca de ${destino.nombre}.`);
    }

    // Contexto de este momento: si el viaje es hoy, el primer día empieza ya (no a las 09:00); los días se
    // arman desde donde está el viajero si está en el destino; y con lluvia se prefieren lugares bajo techo.
    let horaInicio = solicitud.horaInicio ?? HORA_INICIO_PREDETERMINADA;
    const arranqueHoy = horaDeArranqueHoy(solicitud.fechaInicio, destino.zonaHoraria, ahora());
    const horaPrimerDia = arranqueHoy && arranqueHoy > horaInicio ? arranqueHoy : undefined;
    const horaInicioDelDia = (numeroDia: number) => (numeroDia === 1 ? horaPrimerDia : undefined);
    const origen = origenCercano(solicitud.origen, destino);
    // GUI-118: al regenerar, los lugares del plan anterior solo se usan si no hay otros.
    const evitar = new Set(solicitud.evitar ?? []);
    if (horaPrimerDia) {
      advertencias.push(`Tu viaje empieza hoy: el recorrido arranca a las ${horaPrimerDia}.`);
    }
    for (const { numeroDia, lluviaMm } of lluvia) {
      advertencias.push(`Se esperan ${lluviaMm} mm de lluvia el día ${numeroDia}: se dio prioridad a lugares bajo techo.`);
    }
    const viaje: ViajeIA = {
      id: ID_VIAJE_BORRADOR,
      destino: destino.nombre,
      tipoViaje: solicitud.tipoViaje,
      presupuesto: solicitud.presupuesto,
      presupuestoDiario: solicitud.presupuestoDiario,
      transporte: solicitud.transporte,
      intereses: solicitud.intereses,
      fechaInicio: solicitud.fechaInicio,
      fechaFin: solicitud.fechaFin,
      hospedaje: solicitud.hospedaje,
      nombreHotel: solicitud.nombreHotel,
      zonaHoraria: destino.zonaHoraria,
      horaInicio,
      origen,
      horaInicioPrimerDia: horaPrimerDia,
      diasConLluvia: lluvia,
      lugaresAEvitar: candidatos.filter((c) => evitar.has(c.placeId)).map((c) => c.nombre),
    };

    const responder = (
      generadoCon: ItinerarioGenerado["generadoCon"],
      resultado: Pick<ItinerarioGenerado, "descartes" | "diasSinParadas" | "advertencias"> & { itinerarios: ItinerarioIA[] },
    ): ItinerarioGenerado => {
      const itinerarios = completarParadas(resultado.itinerarios, candidatos);
      return {
        destino,
        zonaHoraria: destino.zonaHoraria,
        horaInicio,
        generadoCon,
        viable: resultado.diasSinParadas.length === 0,
        itinerarios,
        descartes: resultado.descartes,
        diasSinParadas: resultado.diasSinParadas,
        advertencias: [
          ...advertencias,
          ...avisoRepetidos(itinerarios, evitar),
          ...avisoHorariosEstimados(itinerarios),
          ...resultado.advertencias,
        ],
      };
    };

    if (cliente) {
      try {
        return responder("ia", await generarItinerarios({ viaje, candidatos, cliente, opcionesValidacion: { horaInicioDelDia } }));
      } catch (error) {
        if (!(error instanceof ErrorGeneracionIA)) {
          throw error;
        }
        advertencias.push(AVISO_FALLO_IA[error.motivo]);
      }
    }

    const planificar = (hora: string) =>
      planificarSinIA({
        candidatos,
        intereses: solicitud.intereses,
        centro: origen ?? destino,
        fechaInicio: solicitud.fechaInicio,
        fechaFin: solicitud.fechaFin,
        horaInicio: hora,
        horaInicioDelDia,
        diasConLluvia: new Set(lluvia.map((d) => d.numeroDia)),
        evitar,
        zonaHoraria: destino.zonaHoraria,
      });
    let propuesta = planificar(horaInicio);
    for (const hora of HORAS_DE_INICIO_ALTERNATIVAS.filter((h) => h > horaInicio)) {
      if (propuesta.dias.length === totalDias) {
        break;
      }
      const alternativa = planificar(hora);
      if (alternativa.dias.length > propuesta.dias.length) {
        propuesta = alternativa;
        horaInicio = hora;
      }
    }
    if (propuesta.dias.length === 0) {
      throw new ErrorApi(422, "SIN_LUGARES", "Ninguno de los lugares cercanos está abierto en las fechas y horas del viaje.");
    }
    if (horaInicio !== viaje.horaInicio) {
      advertencias.push(`El recorrido empieza a las ${horaInicio} porque los lugares cercanos abren más tarde.`);
      viaje.horaInicio = horaInicio;
    }
    return responder("respaldo", validarSalida(propuesta, candidatos, viaje, { horaInicioDelDia }));
  };
}
