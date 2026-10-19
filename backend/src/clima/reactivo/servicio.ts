import { randomUUID } from "node:crypto";
import type {
  AdvertenciaClimaReactivo,
  AlternativaInterior,
  EvaluacionClima,
  FuenteUbicacionClima,
  ItinerarioActivo,
  MotivoDecisionClima,
  ParadaAfectada,
  ParadaItinerarioActivo,
  ParadaPropuesta,
  PropuestaClima,
  RespuestaAceptarPropuestaClima,
  RespuestaEvaluacionClima,
  RespuestaPropuestaClima,
  ResumenRutaClima,
  SolicitudAceptarPropuestaClima,
  SolicitudClimaReactivo,
  SustitucionPropuesta,
  TipoVisitaPropuesta,
} from "../../../../shared/types";
import type { ConfiguracionClimaReactivo } from "../../config/climaReactivo";
import { ErrorApi } from "../../errores";
import { determinarAfectadas } from "./afectadas";
import type { BuscarAlternativas, CandidatoAlternativa } from "./alternativas";
import type { ObtenerClimaReactivo } from "./climaCache";
import { decidir, evaluarClima, referenciaNotificada, senalesDeRiesgo } from "./deteccion";
import { huellaItinerario, type Firmador } from "./firma";
import type { ParadaOptimizador, ReoptimizarClima, RutaOptimizada } from "./optimizador";
import { aMinutos, formatearHora, relojLocal, type RelojLocal } from "./tiempo";

export interface DependenciasClimaReactivo {
  obtenerClima: ObtenerClimaReactivo;
  buscarAlternativas: BuscarAlternativas;
  reoptimizarClima: ReoptimizarClima;
  firmador: Firmador;
  config: ConfiguracionClimaReactivo;
  ahora?: () => Date;
  generarId?: () => string;
}

interface Separadas {
  completadas: ParadaItinerarioActivo[];
  enCurso: ParadaItinerarioActivo | null;
  pendientes: ParadaItinerarioActivo[];
}

interface Analisis {
  separadas: Separadas;
  reloj: RelojLocal;
  evaluacion: EvaluacionClima;
  requierePropuesta: boolean;
  motivo: MotivoDecisionClima;
  referencia: RespuestaEvaluacionClima["referencia"];
  advertencias: AdvertenciaClimaReactivo[];
}

const MENSAJES: Record<MotivoDecisionClima, string> = {
  empeoramiento_detectado: "Las condiciones empeoraron respecto a la última evaluación; conviene revisar las próximas visitas.",
  sin_riesgo_relevante: "No hay lluvia significativa ni tormenta para las próximas horas en la zona del recorrido.",
  evento_ya_notificado: "Este evento meteorológico ya se notificó; no se genera otra propuesta igual.",
  sin_empeoramiento: "El riesgo se mantiene igual o menor que en la última evaluación.",
  espera_entre_propuestas: "Hace poco se generó una propuesta; se esperará antes de proponer otra por un riesgo similar.",
  datos_insuficientes: "No hay datos meteorológicos vigentes para evaluar el riesgo.",
  itinerario_no_activo: "El itinerario no corresponde al día actual en el destino; el monitoreo no está activo.",
  sin_paradas_pendientes: "No quedan paradas pendientes; el monitoreo se detiene.",
};

const AVISO_SEGURIDAD: AdvertenciaClimaReactivo = {
  codigo: "SEGURIDAD",
  mensaje: "Se reporta o pronostica tormenta eléctrica. Las alternativas reducen la exposición, pero no garantizan la seguridad del trayecto: sigue las indicaciones de las autoridades locales.",
};

function separar(itinerario: ItinerarioActivo): Separadas {
  return {
    completadas: itinerario.paradas.filter((p) => p.estado === "completada"),
    enCurso: itinerario.paradas.find((p) => p.estado === "en_curso") ?? null,
    pendientes: itinerario.paradas.filter((p) => p.estado === "pendiente"),
  };
}

export function crearServicioClimaReactivo({
  obtenerClima,
  buscarAlternativas,
  reoptimizarClima,
  firmador,
  config,
  ahora = () => new Date(),
  generarId = randomUUID,
}: DependenciasClimaReactivo) {
  const proximaEvaluacionSegundos = config.intervaloMonitoreoMinutos * 60;
  const propuestasEnCurso = new Map<string, Promise<RespuestaPropuestaClima>>();

  function ubicacionDelClima(solicitud: SolicitudClimaReactivo, separadas: Separadas, momento: Date, advertencias: AdvertenciaClimaReactivo[]) {
    const compartida = ubicacionCompartidaVigente(solicitud, momento, advertencias);
    if (compartida) return { ...compartida, fuente: "ubicacion_compartida" as FuenteUbicacionClima };
    const referencia = separadas.enCurso ?? separadas.pendientes[0];
    return { lat: referencia.lat, lng: referencia.lng, fuente: (separadas.enCurso ? "parada_en_curso" : "proxima_parada") as FuenteUbicacionClima };
  }

  function ubicacionCompartidaVigente(solicitud: SolicitudClimaReactivo, momento: Date, advertencias: AdvertenciaClimaReactivo[]) {
    const ubicacion = solicitud.ubicacionActual;
    if (!ubicacion) return null;
    const antiguedad = momento.getTime() - Date.parse(ubicacion.registradaEn);
    if (antiguedad > config.antiguedadMaximaUbicacionMinutos * 60_000 || antiguedad < -5 * 60_000) {
      if (!advertencias.some((a) => a.codigo === "UBICACION_DESACTUALIZADA")) {
        advertencias.push({
          codigo: "UBICACION_DESACTUALIZADA",
          mensaje: `La ubicación compartida tiene más de ${config.antiguedadMaximaUbicacionMinutos} minutos y no se usó.`,
        });
      }
      return null;
    }
    return { lat: ubicacion.lat, lng: ubicacion.lng };
  }

  async function analizar(solicitud: SolicitudClimaReactivo): Promise<RespuestaEvaluacionClima | Analisis> {
    const momento = ahora();
    const separadas = separar(solicitud.itinerario);
    const referenciaPrevia = solicitud.referencia ?? null;
    if (separadas.pendientes.length === 0) {
      return {
        estado: "sin_paradas_pendientes",
        evaluacion: null,
        requierePropuesta: false,
        motivo: "sin_paradas_pendientes",
        mensaje: MENSAJES.sin_paradas_pendientes,
        referencia: referenciaPrevia,
        proximaEvaluacionSegundos,
        advertencias: [],
      };
    }

    const advertencias: AdvertenciaClimaReactivo[] = [];
    const ubicacion = ubicacionDelClima(solicitud, separadas, momento, advertencias);
    const clima = await obtenerClima(ubicacion);
    if (!clima.actual.ok && !clima.pronostico.ok) {
      throw clima.actual.error;
    }
    const desplazamiento = clima.actual.ok ? clima.actual.valor.desplazamientoUtcSegundos : (clima.pronostico.ok ? clima.pronostico.valor.desplazamientoUtcSegundos : 0);
    const reloj = relojLocal(momento, desplazamiento);
    if (solicitud.itinerario.fecha !== reloj.fecha) {
      return {
        estado: "itinerario_no_activo",
        evaluacion: null,
        requierePropuesta: false,
        motivo: "itinerario_no_activo",
        mensaje: `${MENSAJES.itinerario_no_activo} Fecha del itinerario: ${solicitud.itinerario.fecha}; fecha en el destino: ${reloj.fecha}.`,
        referencia: referenciaPrevia,
        proximaEvaluacionSegundos,
        advertencias,
      };
    }

    const evaluacion = evaluarClima({ actual: clima.actual, pronostico: clima.pronostico, ubicacion, ahora: momento, consultadoEn: clima.consultadoEn, config });
    if (evaluacion.observacion.estado === "obsoleta") {
      advertencias.push({ codigo: "OBSERVACION_DESACTUALIZADA", mensaje: `La última observación de OpenWeather tiene más de ${config.antiguedadMaximaObservacionMinutos} minutos y no se usó para decidir.` });
    }
    if (evaluacion.observacion.error) {
      advertencias.push({ codigo: "CLIMA_ACTUAL_NO_DISPONIBLE", mensaje: `No se pudo consultar el clima actual: ${evaluacion.observacion.error.mensaje}` });
    }
    if (evaluacion.pronostico.error) {
      advertencias.push({ codigo: "PRONOSTICO_NO_DISPONIBLE", mensaje: `No se pudo consultar el pronóstico: ${evaluacion.pronostico.error.mensaje}` });
    }
    if (evaluacion.pronostico.estado === "sin_cobertura") {
      advertencias.push({ codigo: "PRONOSTICO_SIN_COBERTURA", mensaje: "El pronóstico disponible no cubre las próximas horas del recorrido." });
    }
    if (evaluacion.nivel === "tormenta") {
      advertencias.push(AVISO_SEGURIDAD);
    }
    const decision = decidir(evaluacion, referenciaPrevia, momento, config);
    return { separadas, reloj, evaluacion, ...decision, advertencias };
  }

  function respuestaEvaluacion(analisis: Analisis): RespuestaEvaluacionClima {
    return {
      estado: "activo",
      evaluacion: analisis.evaluacion,
      requierePropuesta: analisis.requierePropuesta,
      motivo: analisis.motivo,
      mensaje: MENSAJES[analisis.motivo],
      referencia: analisis.referencia,
      proximaEvaluacionSegundos,
      advertencias: analisis.advertencias,
    };
  }

  async function evaluar(solicitud: SolicitudClimaReactivo): Promise<RespuestaEvaluacionClima> {
    const analisis = await analizar(solicitud);
    return "estado" in analisis ? analisis : respuestaEvaluacion(analisis);
  }

  function origenDeRuta(solicitud: SolicitudClimaReactivo, separadas: Separadas, momento: Date, advertencias: AdvertenciaClimaReactivo[]): PropuestaClima["origen"] {
    const compartida = ubicacionCompartidaVigente(solicitud, momento, advertencias);
    if (compartida) return { ...compartida, fuente: "ubicacion_compartida" };
    if (separadas.enCurso) return { lat: separadas.enCurso.lat, lng: separadas.enCurso.lng, fuente: "parada_en_curso" };
    const ultima = separadas.completadas[separadas.completadas.length - 1];
    if (ultima) {
      advertencias.push({
        codigo: "ORIGEN_APROXIMADO",
        mensaje: `No se conoce la ubicación actual; los traslados se calculan desde la última parada completada (${ultima.nombre}).`,
      });
      return { lat: ultima.lat, lng: ultima.lng, fuente: "ultima_parada_completada" };
    }
    advertencias.push({
      codigo: "ORIGEN_DESCONOCIDO",
      mensaje: "No se conoce la ubicación actual ni hay paradas completadas; el recorrido propuesto parte de su primera visita sin calcular el traslado previo.",
    });
    return { lat: null, lng: null, fuente: "desconocida" };
  }

  function aParadaOptimizador(parada: Pick<ParadaPropuesta, "id" | "lat" | "lng" | "horaApertura" | "horaCierre" | "tiempoEstanciaMinutos">): ParadaOptimizador {
    return {
      id: parada.id,
      lat: parada.lat,
      lng: parada.lng,
      hora_apertura: parada.horaApertura,
      hora_cierre: parada.horaCierre,
      tiempo_estancia_minutos: parada.tiempoEstanciaMinutos,
    };
  }

  function aParadaDeAlternativa({ alternativa, estanciaMinutos }: CandidatoAlternativa): ParadaPropuesta {
    const ventana = alternativa.ventanaVisita as NonNullable<AlternativaInterior["ventanaVisita"]>;
    return {
      id: alternativa.idExterno,
      nombre: alternativa.nombre,
      lat: alternativa.lat,
      lng: alternativa.lng,
      horaApertura: ventana.apertura,
      horaCierre: ventana.cierre,
      tiempoEstanciaMinutos: estanciaMinutos,
      placeId: alternativa.idExterno,
      categorias: alternativa.categorias,
      tipo_entorno: "indoor",
      sensibilidad_clima: "baja",
    };
  }

  function aParadaPropuesta(parada: ParadaItinerarioActivo): ParadaPropuesta {
    const { estado: _estado, horaFinProgramada: _fin, ...resto } = parada;
    return resto;
  }

  function resumirRuta(ruta: RutaOptimizada, nombres: Map<string, string>, tipos: Map<string, TipoVisitaPropuesta>): ResumenRutaClima {
    return {
      orden: ruta.orden,
      viable: ruta.viable,
      distanciaKm: ruta.distanciaTotalKm,
      trasladoMinutos: ruta.duracionTrasladoMinutos,
      visitas: ruta.visitas.map((v) => ({
        paradaId: v.paradaId,
        nombre: nombres.get(v.paradaId) ?? v.paradaId,
        tipo: tipos.get(v.paradaId) ?? "conservada",
        inicio: formatearHora(v.inicioMinutos),
        fin: formatearHora(v.finMinutos),
        trasladoMinutos: Math.round(v.trasladoSegundos / 60),
        distanciaKm: Math.round(v.distanciaMetros / 10) / 100,
      })),
    };
  }

  async function construirPropuesta(solicitud: SolicitudClimaReactivo, analisis: Analisis): Promise<RespuestaPropuestaClima> {
    const momento = ahora();
    const { separadas, reloj, evaluacion } = analisis;
    const advertencias = [...analisis.advertencias];
    const modoTransporte = solicitud.modoTransporte ?? "auto";
    const origen = origenDeRuta(solicitud, separadas, momento, advertencias);
    const horaInicioMinutos = Math.max(
      reloj.minutos,
      separadas.enCurso?.horaFinProgramada ? aMinutos(separadas.enCurso.horaFinProgramada) : 0,
    );
    const origenOptimizador = origen.lat === null ? null : { lat: origen.lat, lng: origen.lng };
    const pendientesOptimizador = separadas.pendientes.map(aParadaOptimizador);
    const nombres = new Map(solicitud.itinerario.paradas.map((p) => [p.id, p.nombre]));
    if (separadas.enCurso) {
      advertencias.push({ codigo: "VISITA_EN_CURSO", mensaje: `La visita en curso (${separadas.enCurso.nombre}) se conserva y no se reemplaza.` });
    }

    const base = {
      id: generarId(),
      creadaEn: momento.toISOString(),
      venceEn: new Date(momento.getTime() + config.vigenciaPropuestaMinutos * 60_000).toISOString(),
      itinerarioId: solicitud.itinerario.id,
      evento: evaluacion,
      origen,
      horaInicio: formatearHora(horaInicioMinutos),
      modoTransporte,
    };
    const responder = (propuesta: PropuestaClima): RespuestaPropuestaClima => ({
      estado: "activo",
      evaluacion,
      requierePropuesta: true,
      motivo: analisis.motivo,
      mensaje: propuesta.mensaje,
      referencia: referenciaNotificada(evaluacion, momento),
      advertencias,
      propuesta,
    });

    const faseActual = await reoptimizarClima({
      paradas: pendientesOptimizador,
      horaActualMinutos: Math.min(horaInicioMinutos, 1440),
      modoTransporte,
      origen: origenOptimizador,
      sustituciones: [],
    });
    const visitasActuales = new Map(faseActual.rutaActual.visitas.map((v) => [v.paradaId, v]));
    if (faseActual.rutaActual.visitas.length === 0) {
      advertencias.push({ codigo: "HORARIOS_ESTIMADOS_NO_DISPONIBLES", mensaje: "Valhalla no encontró todos los tramos de la ruta actual; se consideró todo el resto del día para evaluar el riesgo." });
    }
    const afectadas: ParadaAfectada[] = determinarAfectadas(
      separadas.pendientes.map((parada) => {
        const visita = visitasActuales.get(parada.id);
        return { parada, inicio: visita?.inicioMinutos ?? null, fin: visita?.finMinutos ?? null };
      }),
      senalesDeRiesgo(evaluacion),
      reloj,
      config.maxParadasAfectadas,
    );
    const tiposActuales = new Map<string, TipoVisitaPropuesta>(afectadas.map((a) => [a.paradaId, "afectada_sin_alternativa"]));
    const rutaAnterior = resumirRuta(faseActual.rutaActual, nombres, tiposActuales);
    const vacia = {
      ...base,
      paradasAfectadas: afectadas,
      alternativas: [] as AlternativaInterior[],
      sustituciones: [] as SustitucionPropuesta[],
      conservadas: separadas.pendientes.map((p) => p.id),
      rutaAnterior,
      rutaPropuesta: null,
      paradasPendientesPropuestas: null,
      advertencias,
      token: null,
    };

    if (afectadas.length === 0) {
      return responder({
        ...vacia,
        estado: "sin_cambios",
        mensaje: "El clima empeoró, pero ninguna parada pendiente exterior y sensible al clima coincide con el periodo de riesgo. El itinerario se mantiene.",
      });
    }
    const noAnalizadas = afectadas.filter((a) => !a.analizada);
    if (noAnalizadas.length > 0) {
      advertencias.push({
        codigo: "PARADAS_NO_ANALIZADAS",
        mensaje: `Solo se buscan alternativas para las primeras ${config.maxParadasAfectadas} paradas afectadas; también están en riesgo: ${noAnalizadas.map((a) => a.nombre).join(", ")}.`,
      });
    }
    if (afectadas.some((a) => a.clasificacion.fuente === "supuesta")) {
      advertencias.push({ codigo: "CLASIFICACION_SUPUESTA", mensaje: "Algunas paradas no informan su categoría; se asumieron exteriores y sensibles al clima, como establece la regla del proyecto." });
    }

    const encontradas = await buscarAlternativas({
      afectadas,
      paradas: solicitud.itinerario.paradas,
      intereses: solicitud.intereses ?? [],
      fecha: reloj.fecha,
      desdeMinutos: horaInicioMinutos,
    });
    for (const fallo of encontradas.busquedasFallidas) {
      advertencias.push({ codigo: "BUSQUEDA_ALTERNATIVAS_FALLIDA", mensaje: `No se pudieron buscar alternativas para ${nombres.get(fallo.paradaId) ?? fallo.paradaId}: ${fallo.mensaje}` });
    }
    const noConfirmadas = encontradas.alternativas.filter((a) => a.disponibilidad === "horario_no_confirmado").length;
    if (noConfirmadas > 0) {
      advertencias.push({ codigo: "HORARIOS_NO_CONFIRMADOS", mensaje: `${noConfirmadas} lugares cercanos no tienen un horario verificable y no se proponen como alternativas confirmadas.` });
    }
    advertencias.push({ codigo: "FUENTE_HORARIOS", mensaje: "Los horarios provienen de OpenStreetMap a través de Geoapify y pueden estar desactualizados; confírmalos antes de ir." });

    const grupos = afectadas
      .filter((a) => a.analizada && !encontradas.busquedasFallidas.some((f) => f.paradaId === a.paradaId))
      .map((a) => ({ afectada: a, candidatos: encontradas.confirmadas.get(a.paradaId) ?? [] }));
    if (!grupos.some((g) => g.candidatos.length > 0)) {
      return responder({
        ...vacia,
        alternativas: encontradas.alternativas,
        estado: "sin_alternativas",
        mensaje: "No se encontraron alternativas techadas con horario confirmado y abiertas a tiempo cerca de las paradas afectadas. El itinerario actual se conserva.",
      });
    }

    const candidatos = new Map(grupos.flatMap((g) => g.candidatos.map((c) => [c.alternativa.idExterno, c] as const)));
    const fasePropuesta = await reoptimizarClima({
      paradas: pendientesOptimizador,
      horaActualMinutos: Math.min(horaInicioMinutos, 1440),
      modoTransporte,
      origen: origenOptimizador,
      sustituciones: grupos.map((g) => ({
        paradaId: g.afectada.paradaId,
        candidatos: g.candidatos.map((c) => aParadaOptimizador(aParadaDeAlternativa(c))),
      })),
    });

    const usadas = new Set(fasePropuesta.sustituciones.map((s) => s.alternativaId));
    const alternativas = encontradas.alternativas.map((a) => ({ ...a, seleccionada: usadas.has(a.idExterno) && fasePropuesta.sustituciones.some((s) => s.alternativaId === a.idExterno && s.paradaId === a.paraParadaId) }));
    for (const { paradaId } of fasePropuesta.sinSustitucion) {
      advertencias.push({ codigo: "PARADA_AFECTADA_CONSERVADA", mensaje: `${nombres.get(paradaId) ?? paradaId} se conserva porque ninguna alternativa permite una ruta viable.` });
    }
    if (!fasePropuesta.rutaPropuesta) {
      return responder({
        ...vacia,
        alternativas,
        estado: "sin_solucion_viable",
        mensaje: `No existe un recorrido viable con las alternativas encontradas${fasePropuesta.motivoSinRuta ? `: ${fasePropuesta.motivoSinRuta}` : "."} El itinerario actual se conserva.`,
      });
    }
    if (fasePropuesta.sustituciones.length === 0) {
      return responder({
        ...vacia,
        alternativas,
        estado: "sin_alternativas",
        mensaje: "Ninguna alternativa techada permite mantener un recorrido viable. El itinerario actual se conserva.",
      });
    }

    const sustituciones: SustitucionPropuesta[] = fasePropuesta.sustituciones.map(({ paradaId, alternativaId }) => {
      const { alternativa } = candidatos.get(alternativaId) as CandidatoAlternativa;
      const ventana = alternativa.ventanaVisita as NonNullable<AlternativaInterior["ventanaVisita"]>;
      return {
        paradaOriginalId: paradaId,
        paradaOriginalNombre: nombres.get(paradaId) ?? paradaId,
        alternativaId,
        alternativaNombre: alternativa.nombre,
        razon: `${afectadas.find((a) => a.paradaId === paradaId)?.motivo ?? ""} ${alternativa.nombre} es un espacio interior (${alternativa.categorias.join(", ")}) a ${alternativa.distanciaLineaRectaMetros} m en línea recta, con horario confirmado ${ventana.apertura}–${ventana.cierre}${alternativa.coincideConIntereses ? " y relacionado con tus intereses" : ""}. Fue la opción viable con menor tiempo de traslado según Valhalla (${modoTransporte}).`.trim(),
      };
    });
    const sustituidas = new Set(sustituciones.map((s) => s.paradaOriginalId));
    const tiposPropuestos = new Map<string, TipoVisitaPropuesta>([
      ...[...tiposActuales].filter(([id]) => !sustituidas.has(id)),
      ...sustituciones.map((s) => [s.alternativaId, "sustituta"] as [string, TipoVisitaPropuesta]),
    ]);
    for (const s of sustituciones) nombres.set(s.alternativaId, s.alternativaNombre);

    const porId = new Map<string, ParadaPropuesta>([
      ...separadas.pendientes.map((p) => [p.id, aParadaPropuesta(p)] as [string, ParadaPropuesta]),
      ...[...candidatos.values()].map((c) => [c.alternativa.idExterno, aParadaDeAlternativa(c)] as [string, ParadaPropuesta]),
    ]);
    const paradasPendientesPropuestas = fasePropuesta.rutaPropuesta.visitas.map((v) => ({
      ...(porId.get(v.paradaId) as ParadaPropuesta),
      horaInicioProgramada: formatearHora(v.inicioMinutos),
      horaFinProgramada: formatearHora(v.finMinutos),
      tiempoTrasladoMinutos: Math.round(v.trasladoSegundos / 60),
    }));
    const resultado: ItinerarioActivo = {
      ...solicitud.itinerario,
      paradas: [
        ...solicitud.itinerario.paradas.filter((p) => p.estado !== "pendiente"),
        ...paradasPendientesPropuestas.map((p) => ({ ...p, estado: "pendiente" as const })),
      ],
    };
    const propuesta: PropuestaClima = {
      ...vacia,
      estado: "pendiente",
      alternativas,
      sustituciones,
      conservadas: separadas.pendientes.map((p) => p.id).filter((id) => !sustituidas.has(id)),
      rutaPropuesta: resumirRuta(fasePropuesta.rutaPropuesta, nombres, tiposPropuestos),
      paradasPendientesPropuestas,
      mensaje: `Se propone sustituir ${sustituciones.length} ${sustituciones.length === 1 ? "parada" : "paradas"} por alternativas techadas. El itinerario no cambia hasta que aceptes la propuesta.`,
      token: null,
    };
    propuesta.token = firmador.firmar({
      v: 1,
      id: propuesta.id,
      itinerarioId: solicitud.itinerario.id,
      huellaOrigen: huellaItinerario(solicitud.itinerario),
      huellaResultado: huellaItinerario(resultado),
      venceEn: Date.parse(propuesta.venceEn),
      paradasPendientes: paradasPendientesPropuestas,
    });
    return responder(propuesta);
  }

  async function proponer(solicitud: SolicitudClimaReactivo): Promise<RespuestaPropuestaClima> {
    const analisis = await analizar(solicitud);
    if ("estado" in analisis) {
      const { proximaEvaluacionSegundos: _siguiente, ...resto } = analisis;
      return { ...resto, propuesta: null };
    }
    if (!analisis.requierePropuesta) {
      const { proximaEvaluacionSegundos: _siguiente, ...resto } = respuestaEvaluacion(analisis);
      return { ...resto, propuesta: null };
    }
    const clave = `${huellaItinerario(solicitud.itinerario)}:${analisis.evaluacion.eventoId}:${solicitud.modoTransporte ?? "auto"}`;
    const enCurso = propuestasEnCurso.get(clave);
    if (enCurso) {
      return enCurso;
    }
    const promesa = construirPropuesta(solicitud, analisis).finally(() => propuestasEnCurso.delete(clave));
    propuestasEnCurso.set(clave, promesa);
    return promesa;
  }

  function aceptar({ token, itinerario }: SolicitudAceptarPropuestaClima): RespuestaAceptarPropuestaClima {
    const carga = firmador.verificar(token);
    if (!carga) {
      throw new ErrorApi(400, "PROPUESTA_INVALIDA", "La propuesta no es válida o fue modificada.");
    }
    if (carga.itinerarioId !== itinerario.id) {
      throw new ErrorApi(409, "PROPUESTA_OBSOLETA", "La propuesta corresponde a otro día del itinerario.");
    }
    const huella = huellaItinerario(itinerario);
    const respuesta = (yaAplicada: boolean): RespuestaAceptarPropuestaClima => ({
      propuestaId: carga.id,
      itinerarioId: carga.itinerarioId,
      yaAplicada,
      aplicadaEn: ahora().toISOString(),
      paradasPendientes: carga.paradasPendientes,
    });
    if (huella === carga.huellaResultado) {
      return respuesta(true);
    }
    if (ahora().getTime() > carga.venceEn) {
      throw new ErrorApi(410, "PROPUESTA_VENCIDA", "La propuesta venció; vuelve a evaluar el clima para obtener una nueva.");
    }
    if (huella !== carga.huellaOrigen) {
      throw new ErrorApi(409, "PROPUESTA_OBSOLETA", "El itinerario cambió desde que se generó la propuesta; vuelve a evaluarla.");
    }
    return respuesta(false);
  }

  return { evaluar, proponer, aceptar };
}

export type ServicioClimaReactivo = ReturnType<typeof crearServicioClimaReactivo>;
