import type {
  BusquedaHoteles,
  EstanciaHotel,
  HotelRecomendado,
  ImpuestosTarifaHotel,
  MotivoSinRecomendacionesHotel,
  RespuestaRecomendacionesHoteles,
  TarifaReferencialHotel,
  TipoCambioHoteles,
} from "../../../shared/types";
import type { SolicitudHoteles } from "../validacion/hoteles";
import { NINOS_POR_SOLICITUD, NOCHES_POR_SOLICITUD } from "./estancia";
import { calcularCentro, distanciaMetros, type Coordenada } from "./geografia";
import { errorNoConfigurado } from "./http";
import { SERVICIO_SERPAPI, type BuscadorHoteles, type HotelProveedor } from "./serpapi";
import { PORCENTAJE_HOSPEDAJE, calcularPresupuestoHospedajeCentavos, convertirCentavos, type PrecioReferencialUsd } from "./tarifas";
import { SERVICIO_EXCHANGERATE, type ObtenedorTipoCambio } from "./tipoCambio";

export const MENSAJES_SIN_RECOMENDACIONES: Record<MotivoSinRecomendacionesHotel, string> = {
  hospedaje_reservado: "El usuario ya tiene hospedaje reservado; no se generan recomendaciones de hoteles.",
  no_necesita_hotel: "El usuario indicó que no necesita hotel; no se generan recomendaciones.",
  itinerario_sin_paradas: "El itinerario del día no tiene paradas; no es posible calcular su centro.",
  sin_hoteles_encontrados: "La búsqueda de hoteles para el destino y las fechas indicadas no devolvió resultados.",
  sin_hoteles_con_precio: "La búsqueda devolvió resultados, pero ninguno es un hotel con identificador, coordenadas y precio referencial utilizables.",
  sin_hoteles_en_radio: "Ningún hotel con precio referencial está dentro del radio de búsqueda alrededor del centro del día.",
  sin_hoteles_en_presupuesto: "Ningún hotel dentro del radio tiene un precio referencial convertido dentro del presupuesto de hospedaje.",
};

export type RecomendarHoteles = (solicitud: SolicitudHoteles) => Promise<RespuestaRecomendacionesHoteles>;

interface Candidato {
  hotel: HotelProveedor;
  idExterno: string;
  distancia: number;
}

interface CandidatoConvertido extends Candidato {
  importeCentavos: number;
}

const redondear = (valor: number, decimales: number) => {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor + 0;
};

export function deduplicarPorId<T extends { idExterno: string }>(elementos: readonly T[]): T[] {
  const vistos = new Set<string>();
  return elementos.filter((elemento) => {
    if (vistos.has(elemento.idExterno)) {
      return false;
    }
    vistos.add(elemento.idExterno);
    return true;
  });
}

export function ordenarPorCercania<T extends { distancia: number; idExterno: string }>(candidatos: readonly T[]): T[] {
  return [...candidatos].sort((a, b) => {
    if (a.distancia !== b.distancia) {
      return a.distancia - b.distancia;
    }
    if (a.idExterno === b.idExterno) {
      return 0;
    }
    return a.idExterno < b.idExterno ? -1 : 1;
  });
}

function aImpuestos(precio: PrecioReferencialUsd): ImpuestosTarifaHotel {
  if (precio.impuestos.estado === "no_informado") {
    return { estado: "no_informado" };
  }
  const antes = precio.impuestos.antesImpuestosUsdCentavos;
  return {
    estado: "informado",
    importeAntesImpuestosUsd: antes / 100,
    impuestosYCargosUsd: (precio.importeUsdCentavos - antes) / 100,
  };
}

function aTarifa(precio: PrecioReferencialUsd, importeCentavos: number): TarifaReferencialHotel {
  return {
    referencial: true,
    importeUsd: precio.importeUsdCentavos / 100,
    importeUsdCentavos: precio.importeUsdCentavos,
    importe: importeCentavos / 100,
    importeCentavos,
    moneda: "GTQ",
    unidad: "habitacion_noche",
    noches: NOCHES_POR_SOLICITUD,
    campo: precio.campo,
    fuente: precio.fuente.tipo === "oferta" ? { ...precio.fuente } : { tipo: "resumen_propiedad" },
    impuestos: aImpuestos(precio),
  };
}

function aHotelRecomendado({ hotel, distancia, importeCentavos }: CandidatoConvertido): HotelRecomendado {
  return {
    idExterno: hotel.idExterno,
    proveedor: "serpapi",
    nombre: hotel.nombre,
    lat: hotel.lat,
    lng: hotel.lng,
    distanciaLineaRectaMetros: Math.round(distancia),
    tarifa: aTarifa(hotel.precio, importeCentavos),
  };
}

export function crearRecomendadorHoteles({
  buscador,
  tipoCambio,
}: {
  buscador: BuscadorHoteles;
  tipoCambio: ObtenedorTipoCambio;
}): RecomendarHoteles {
  return async function recomendarHoteles(solicitud) {
    const presupuestoHospedajeCentavos = calcularPresupuestoHospedajeCentavos(solicitud.presupuestoDiarioCentavos);
    const estancia: EstanciaHotel = {
      entrada: solicitud.fecha,
      salida: solicitud.fechaSalida,
      noches: NOCHES_POR_SOLICITUD,
      adultos: solicitud.ocupacion,
      ninos: NINOS_POR_SOLICITUD,
    };
    let centro: Coordenada | null = null;
    let busqueda: BusquedaHoteles | null = null;
    let tasa: TipoCambioHoteles | null = null;

    const responder = (hoteles: HotelRecomendado[], motivo: MotivoSinRecomendacionesHotel | null): RespuestaRecomendacionesHoteles => ({
      fecha: solicitud.fecha,
      destino: solicitud.destino,
      moneda: solicitud.moneda,
      ocupacion: solicitud.ocupacion,
      estancia,
      presupuestoDiario: solicitud.presupuestoDiarioCentavos / 100,
      presupuestoDiarioCentavos: solicitud.presupuestoDiarioCentavos,
      porcentajeHospedaje: PORCENTAJE_HOSPEDAJE,
      presupuestoHospedaje: presupuestoHospedajeCentavos / 100,
      presupuestoHospedajeCentavos,
      centro: centro && { lat: redondear(centro.lat, 7), lng: redondear(centro.lng, 7) },
      metodoDistancia: "linea_recta",
      busqueda,
      tipoCambio: tasa,
      hoteles,
      motivo,
      mensaje: motivo && MENSAJES_SIN_RECOMENDACIONES[motivo],
    });

    if (solicitud.hospedaje) {
      return responder([], "hospedaje_reservado");
    }
    if (solicitud.sinHotel) {
      return responder([], "no_necesita_hotel");
    }

    centro = calcularCentro(solicitud.paradas);
    if (!centro) {
      return responder([], "itinerario_sin_paradas");
    }

    if (!buscador.configurado) {
      throw errorNoConfigurado(SERVICIO_SERPAPI);
    }
    if (!tipoCambio.configurado) {
      throw errorNoConfigurado(SERVICIO_EXCHANGERATE);
    }

    const resultado = await buscador.buscar({
      destino: solicitud.destino,
      entrada: estancia.entrada,
      salida: estancia.salida,
      adultos: estancia.adultos,
    });

    const origen = centro;
    const hoteles = deduplicarPorId(resultado.hoteles);
    const enRadio: Candidato[] = [];
    for (const hotel of hoteles) {
      const distancia = distanciaMetros(origen, hotel);
      if (distancia <= solicitud.radio) {
        enRadio.push({ hotel, idExterno: hotel.idExterno, distancia });
      }
    }
    busqueda = {
      proveedor: "serpapi",
      motor: "google_hotels",
      consulta: resultado.consulta,
      monedaProveedor: "USD",
      consultadoEn: resultado.consultadoEn,
      desdeCache: resultado.desdeCache,
      radioMetros: solicitud.radio,
      resultadosRecibidos: resultado.resultadosRecibidos,
      hotelesConPrecio: hoteles.length,
      hotelesEnRadio: enRadio.length,
      hayMasPaginas: resultado.hayMasPaginas,
    };

    if (resultado.resultadosRecibidos === 0) {
      return responder([], "sin_hoteles_encontrados");
    }
    if (hoteles.length === 0) {
      return responder([], "sin_hoteles_con_precio");
    }
    if (enRadio.length === 0) {
      return responder([], "sin_hoteles_en_radio");
    }

    tasa = await tipoCambio.obtener();
    const tasaAplicada = tasa.tasa;
    const elegibles: CandidatoConvertido[] = [];
    for (const candidato of enRadio) {
      const importeCentavos = convertirCentavos(candidato.hotel.precio.importeUsdCentavos, tasaAplicada);
      if (importeCentavos !== null && importeCentavos <= presupuestoHospedajeCentavos) {
        elegibles.push({ ...candidato, importeCentavos });
      }
    }

    const recomendados = ordenarPorCercania(elegibles).slice(0, solicitud.limite).map(aHotelRecomendado);
    return responder(recomendados, recomendados.length === 0 ? "sin_hoteles_en_presupuesto" : null);
  };
}
