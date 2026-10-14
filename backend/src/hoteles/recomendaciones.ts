import type {
  HotelRecomendado,
  MotivoSinRecomendacionesHotel,
  RespuestaRecomendacionesHoteles,
  TarifaHotelAplicada,
} from "../../../shared/types";
import type { BuscarLugares } from "../geoapify/cliente";
import type { Lugar } from "../geoapify/transformar";
import type { SolicitudHoteles } from "../validacion/hoteles";
import { validarCatalogo, type LeerCatalogo, type TarifaHotel } from "./catalogo";
import { calcularCentro, distanciaMetros, type Coordenada } from "./geografia";
import { PORCENTAJE_HOSPEDAJE, calcularPresupuestoHospedajeCentavos, seleccionarTarifas } from "./tarifas";

export const CATEGORIA_HOTEL = "accommodation.hotel";
export const MAX_CANDIDATOS_HOTELES = 100;

export const MENSAJES_SIN_RECOMENDACIONES: Record<MotivoSinRecomendacionesHotel, string> = {
  hospedaje_reservado: "El usuario ya tiene hospedaje reservado; no se generan recomendaciones de hoteles.",
  no_necesita_hotel: "El usuario indicó que no necesita hotel; no se generan recomendaciones.",
  itinerario_sin_paradas: "El itinerario del día no tiene paradas; no es posible calcular su centro.",
  catalogo_vacio: "El catálogo de tarifas verificadas no tiene tarifas registradas.",
  sin_tarifas_aplicables: "No hay tarifas verificadas para la fecha, moneda y ocupación indicadas dentro del presupuesto de hospedaje.",
  sin_hoteles_encontrados: "Geoapify no encontró hoteles dentro del radio de búsqueda.",
  sin_hoteles_elegibles: "Ninguno de los hoteles encontrados tiene una tarifa verificada aplicable dentro del presupuesto de hospedaje.",
};

export type RecomendarHoteles = (solicitud: SolicitudHoteles) => Promise<RespuestaRecomendacionesHoteles>;

interface Candidato {
  lugar: Lugar;
  tarifa: TarifaHotel;
  distancia: number;
}

const redondear = (valor: number, decimales: number) => {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor + 0;
};

export function deduplicarLugares(lugares: readonly Lugar[]): Lugar[] {
  const vistos = new Set<string>();
  return lugares.filter((lugar) => {
    if (vistos.has(lugar.idExterno)) {
      return false;
    }
    vistos.add(lugar.idExterno);
    return true;
  });
}

export function ordenarPorCercania<T extends { distancia: number; lugar: { idExterno: string } }>(candidatos: readonly T[]): T[] {
  return [...candidatos].sort((a, b) => {
    if (a.distancia !== b.distancia) {
      return a.distancia - b.distancia;
    }
    if (a.lugar.idExterno === b.lugar.idExterno) {
      return 0;
    }
    return a.lugar.idExterno < b.lugar.idExterno ? -1 : 1;
  });
}

function aTarifaAplicada(tarifa: TarifaHotel): TarifaHotelAplicada {
  return {
    id: tarifa.id,
    importe: tarifa.importeCentavos / 100,
    importeCentavos: tarifa.importeCentavos,
    moneda: "GTQ",
    unidad: tarifa.unidad,
    ocupacion: tarifa.ocupacion,
    impuestosIncluidos: true,
    vigencia: { desde: tarifa.vigenciaDesde, hasta: tarifa.vigenciaHasta },
    verificadoEn: tarifa.verificadoEn,
    fuente: tarifa.fuente,
  };
}

function aHotelRecomendado({ lugar, tarifa, distancia }: Candidato): HotelRecomendado {
  return {
    idExterno: lugar.idExterno,
    proveedor: lugar.proveedor,
    nombre: lugar.nombre,
    direccion: lugar.direccion,
    lat: lugar.lat,
    lng: lugar.lng,
    distanciaLineaRectaMetros: Math.round(distancia),
    tarifa: aTarifaAplicada(tarifa),
  };
}

export function crearRecomendadorHoteles({
  buscarLugares,
  leerCatalogo,
}: {
  buscarLugares: BuscarLugares;
  leerCatalogo: LeerCatalogo;
}): RecomendarHoteles {
  return async function recomendarHoteles(solicitud) {
    const presupuestoHospedajeCentavos = calcularPresupuestoHospedajeCentavos(solicitud.presupuestoDiarioCentavos);
    let centro: Coordenada | null = null;
    let busqueda: RespuestaRecomendacionesHoteles["busqueda"] = null;

    const responder = (hoteles: HotelRecomendado[], motivo: MotivoSinRecomendacionesHotel | null): RespuestaRecomendacionesHoteles => ({
      fecha: solicitud.fecha,
      moneda: solicitud.moneda,
      ocupacion: solicitud.ocupacion,
      presupuestoDiario: solicitud.presupuestoDiarioCentavos / 100,
      presupuestoDiarioCentavos: solicitud.presupuestoDiarioCentavos,
      porcentajeHospedaje: PORCENTAJE_HOSPEDAJE,
      presupuestoHospedaje: presupuestoHospedajeCentavos / 100,
      presupuestoHospedajeCentavos,
      centro: centro && { lat: redondear(centro.lat, 7), lng: redondear(centro.lng, 7) },
      metodoDistancia: "linea_recta",
      busqueda,
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

    const tarifas = validarCatalogo(await leerCatalogo());
    if (tarifas.length === 0) {
      return responder([], "catalogo_vacio");
    }

    const tarifasPorHotel = seleccionarTarifas(tarifas, {
      fecha: solicitud.fecha,
      moneda: solicitud.moneda,
      ocupacion: solicitud.ocupacion,
      presupuestoHospedajeCentavos,
    });
    if (tarifasPorHotel.size === 0) {
      return responder([], "sin_tarifas_aplicables");
    }

    const encontrados = deduplicarLugares(
      await buscarLugares({
        lat: centro.lat,
        lng: centro.lng,
        categorias: [CATEGORIA_HOTEL],
        radio: solicitud.radio,
        limite: MAX_CANDIDATOS_HOTELES,
      }),
    );
    busqueda = {
      categoria: CATEGORIA_HOTEL,
      radioMetros: solicitud.radio,
      maxCandidatos: MAX_CANDIDATOS_HOTELES,
      candidatosEncontrados: encontrados.length,
    };
    if (encontrados.length === 0) {
      return responder([], "sin_hoteles_encontrados");
    }

    const origen = centro;
    const elegibles: Candidato[] = [];
    for (const lugar of encontrados) {
      const tarifa = tarifasPorHotel.get(lugar.idExterno);
      if (tarifa) {
        elegibles.push({ lugar, tarifa, distancia: distanciaMetros(origen, lugar) });
      }
    }

    const hoteles = ordenarPorCercania(elegibles).slice(0, solicitud.limite).map(aHotelRecomendado);
    return responder(hoteles, hoteles.length === 0 ? "sin_hoteles_elegibles" : null);
  };
}
