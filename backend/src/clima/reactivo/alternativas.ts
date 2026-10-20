import type { AlternativaInterior, ParadaAfectada, ParadaItinerarioActivo } from "../../../../shared/types";
import { CATEGORIAS_ALTERNATIVAS_INTERIORES, type ConfiguracionClimaReactivo } from "../../config/climaReactivo";
import { CATEGORIAS_POR_INTERES } from "../../config/intereses";
import { ErrorApi } from "../../errores";
import type { BuscarLugares } from "../../geoapify/cliente";
import type { EnriquecerHorarios } from "../../geoapify/enriquecer";
import { ventanasDelDia, type Horario } from "../../geoapify/horario";
import type { Lugar } from "../../geoapify/transformar";
import { distanciaMetros } from "../../hoteles/geografia";
import { normalizarInteres } from "../../validacion/lugares";
import { componentesFecha, formatearHora } from "./tiempo";

const DISTANCIA_MISMO_LUGAR_M = 30;
const DISTANCIA_MISMO_NOMBRE_M = 150;

export interface CandidatoAlternativa {
  alternativa: AlternativaInterior;
  estanciaMinutos: number;
}

export interface ResultadoAlternativas {
  // Candidatos con horario confirmado que caben hoy, por parada afectada y en orden de preferencia.
  confirmadas: Map<string, CandidatoAlternativa[]>;
  alternativas: AlternativaInterior[];
  busquedasFallidas: { paradaId: string; codigo: string; mensaje: string }[];
}

export interface EntradaAlternativas {
  afectadas: readonly ParadaAfectada[];
  paradas: readonly ParadaItinerarioActivo[];
  intereses: readonly string[];
  fecha: string;
  desdeMinutos: number;
}

export type BuscarAlternativas = (entrada: EntradaAlternativas) => Promise<ResultadoAlternativas>;

function perteneceA(categoria: string, base: string): boolean {
  return categoria === base || categoria.startsWith(`${base}.`);
}

export function esAlternativaInterior(lugar: Pick<Lugar, "categorias" | "tipo_entorno">): boolean {
  return lugar.tipo_entorno === "indoor" && lugar.categorias.some((c) => CATEGORIAS_ALTERNATIVAS_INTERIORES.some((base) => perteneceA(c, base)));
}

const normalizarNombre = (nombre: string) => normalizarInteres(nombre).replace(/\s+/g, " ");

export function esLugarDelItinerario(lugar: Pick<Lugar, "idExterno" | "nombre" | "lat" | "lng">, paradas: readonly ParadaItinerarioActivo[]): boolean {
  return paradas.some((parada) => {
    if (parada.placeId === lugar.idExterno || parada.id === lugar.idExterno) {
      return true;
    }
    const distancia = distanciaMetros(parada, lugar);
    return distancia <= DISTANCIA_MISMO_LUGAR_M || (distancia <= DISTANCIA_MISMO_NOMBRE_M && normalizarNombre(parada.nombre) === normalizarNombre(lugar.nombre));
  });
}

export function categoriasDeIntereses(intereses: readonly string[]): string[] {
  return [...new Set(intereses.flatMap((interes) => CATEGORIAS_POR_INTERES[interes] ?? []))];
}

function coincideConIntereses(lugar: Lugar, categorias: readonly string[]): boolean {
  return lugar.categorias.some((c) => categorias.some((base) => perteneceA(c, base)));
}

function disponibilidad(horario: Horario, fecha: string, desdeMinutos: number, estanciaMinutos: number) {
  const ventanas = ventanasDelDia(horario, componentesFecha(fecha));
  if (ventanas.estado !== "disponible") {
    return { disponibilidad: "horario_no_confirmado" as const, ventana: null };
  }
  const ventana = ventanas.ventanas.find(({ inicioMinutos, finMinutos }) => finMinutos - Math.max(inicioMinutos, desdeMinutos) >= estanciaMinutos);
  if (!ventana) {
    return { disponibilidad: "cerrada_en_el_horario" as const, ventana: null };
  }
  return {
    disponibilidad: "confirmada" as const,
    ventana: { apertura: formatearHora(ventana.inicioMinutos), cierre: formatearHora(ventana.finMinutos) },
  };
}

interface Encontrado {
  lugar: Lugar;
  paradaId: string;
  radio: number;
  distancia: number;
  coincide: boolean;
}

export function crearBuscadorAlternativas({
  buscarLugares,
  enriquecerHorarios,
  config,
}: {
  buscarLugares: BuscarLugares;
  enriquecerHorarios: EnriquecerHorarios;
  config: ConfiguracionClimaReactivo;
}): BuscarAlternativas {
  async function buscarCerca(afectada: ParadaAfectada, parada: ParadaItinerarioActivo, entrada: EntradaAlternativas, categoriasInteres: string[]): Promise<Encontrado[]> {
    const radios = [...new Set([config.radioInicialMetros, config.radioMaximoMetros])];
    const encontrados = new Map<string, Encontrado>();
    for (const radio of radios) {
      const lugares = await buscarLugares({
        lat: parada.lat,
        lng: parada.lng,
        categorias: [...CATEGORIAS_ALTERNATIVAS_INTERIORES],
        radio,
        limite: config.resultadosPorBusqueda,
      });
      for (const lugar of lugares) {
        const distancia = distanciaMetros(parada, lugar);
        if (encontrados.has(lugar.idExterno) || distancia > radio || !esAlternativaInterior(lugar) || esLugarDelItinerario(lugar, entrada.paradas)) {
          continue;
        }
        encontrados.set(lugar.idExterno, { lugar, paradaId: afectada.paradaId, radio, distancia, coincide: coincideConIntereses(lugar, categoriasInteres) });
      }
      // Solo se amplía el radio cuando el inicial no dio suficientes candidatos.
      if (encontrados.size >= config.candidatosPorParada) {
        break;
      }
    }
    return [...encontrados.values()]
      .sort((a, b) => Number(b.coincide) - Number(a.coincide) || a.distancia - b.distancia || (a.lugar.idExterno < b.lugar.idExterno ? -1 : 1))
      .slice(0, config.detallesPorParada);
  }

  return async function buscarAlternativas(entrada) {
    const categoriasInteres = categoriasDeIntereses(entrada.intereses);
    const porId = new Map(entrada.paradas.map((p) => [p.id, p]));
    const busquedasFallidas: ResultadoAlternativas["busquedasFallidas"] = [];
    const porParada = new Map<string, Encontrado[]>();

    for (const afectada of entrada.afectadas.filter((a) => a.analizada)) {
      const parada = porId.get(afectada.paradaId);
      if (!parada) continue;
      try {
        porParada.set(afectada.paradaId, await buscarCerca(afectada, parada, entrada, categoriasInteres));
      } catch (error) {
        if (!(error instanceof ErrorApi)) throw error;
        busquedasFallidas.push({ paradaId: afectada.paradaId, codigo: error.codigo, mensaje: error.message });
      }
    }
    if (busquedasFallidas.length > 0 && porParada.size === 0) {
      const primera = busquedasFallidas[0];
      throw new ErrorApi(502, primera.codigo, `No fue posible buscar alternativas techadas: ${primera.mensaje}`);
    }

    const unicos = [...new Map([...porParada.values()].flat().map((e) => [e.lugar.idExterno, e.lugar])).values()];
    const conHorario = new Map((await enriquecerHorarios(unicos)).map((lugar) => [lugar.idExterno, lugar.horario]));

    const confirmadas = new Map<string, CandidatoAlternativa[]>();
    const alternativas: AlternativaInterior[] = [];
    for (const [paradaId, encontrados] of porParada) {
      const estanciaMinutos = Math.max(porId.get(paradaId)?.tiempoEstanciaMinutos ?? 0, config.estanciaMinimaAlternativaMinutos);
      const lista: CandidatoAlternativa[] = [];
      for (const { lugar, radio, distancia, coincide } of encontrados) {
        const horario = conHorario.get(lugar.idExterno) ?? { estado: "error_consulta", valorOriginal: null, fuente: "geoapify" };
        const evaluada = disponibilidad(horario, entrada.fecha, entrada.desdeMinutos, estanciaMinutos);
        const alternativa: AlternativaInterior = {
          idExterno: lugar.idExterno,
          proveedor: "geoapify",
          nombre: lugar.nombre,
          direccion: lugar.direccion,
          lat: lugar.lat,
          lng: lugar.lng,
          categorias: lugar.categorias,
          paraParadaId: paradaId,
          radioBusquedaMetros: radio,
          distanciaLineaRectaMetros: Math.round(distancia),
          coincideConIntereses: coincide,
          horario: { estado: horario.estado, valorOriginal: horario.valorOriginal },
          ventanaVisita: evaluada.ventana,
          disponibilidad: evaluada.disponibilidad,
          seleccionada: false,
        };
        alternativas.push(alternativa);
        if (alternativa.disponibilidad === "confirmada" && lista.length < config.candidatosPorParada) {
          lista.push({ alternativa, estanciaMinutos });
        }
      }
      confirmadas.set(paradaId, lista);
    }
    return { confirmadas, alternativas, busquedasFallidas };
  };
}
