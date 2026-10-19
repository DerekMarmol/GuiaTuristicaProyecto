import type { ParadaAfectada, ParadaItinerarioActivo, SenalClima } from "../../../../shared/types";
import { CLASIFICACION_POR_DEFECTO } from "../../config/entornoClima";
import { clasificarEntorno } from "../clasificacion";
import { rango } from "./deteccion";
import { formatearHora, minutosLocales, type RelojLocal } from "./tiempo";

export interface PendienteProgramada {
  parada: ParadaItinerarioActivo;
  inicio: number | null;
  fin: number | null;
}

export function clasificarParada(parada: ParadaItinerarioActivo): ParadaAfectada["clasificacion"] {
  if (parada.tipo_entorno && parada.sensibilidad_clima) {
    return { tipo_entorno: parada.tipo_entorno, sensibilidad_clima: parada.sensibilidad_clima, fuente: "itinerario" };
  }
  if (parada.categorias && parada.categorias.length > 0) {
    const clasificacion = clasificarEntorno(parada.categorias);
    return {
      tipo_entorno: clasificacion.tipo_entorno,
      sensibilidad_clima: clasificacion.sensibilidad_clima,
      fuente: clasificacion.regla_clima ? "categorias" : "supuesta",
    };
  }
  return { ...CLASIFICACION_POR_DEFECTO, fuente: "supuesta" };
}

const DESCRIPCION_CONDICION: Record<SenalClima["condicion"], string> = {
  tormenta: "tormenta eléctrica",
  lluvia_intensa: "lluvia intensa",
  lluvia_moderada: "lluvia moderada",
  lluvia_ligera: "lluvia ligera",
  llovizna: "llovizna",
  despejado_o_nublado: "sin lluvia",
  otra: "condición adversa",
};

function describirSenal(senal: SenalClima, reloj: RelojLocal): string {
  const desde = formatearHora(minutosLocales(senal.desde, reloj));
  const hasta = formatearHora(minutosLocales(senal.hasta, reloj));
  if (senal.origen === "observado") {
    return `${DESCRIPCION_CONDICION[senal.condicion]} reportada en la zona (vigencia supuesta ${desde}–${hasta})`;
  }
  const probabilidad = senal.probabilidadPrecipitacion === null ? "" : ` con ${Math.round(senal.probabilidadPrecipitacion * 100)} % de probabilidad`;
  return `${DESCRIPCION_CONDICION[senal.condicion] === "sin lluvia" ? "precipitación" : DESCRIPCION_CONDICION[senal.condicion]} pronosticada${probabilidad} entre ${desde} y ${hasta}`;
}

function afectaA(sensibilidad: ParadaAfectada["clasificacion"]["sensibilidad_clima"], senal: SenalClima): boolean {
  if (sensibilidad === "alta") return rango(senal.nivel) >= rango("riesgo_elevado");
  if (sensibilidad === "media") return rango(senal.nivel) >= rango("lluvia_significativa");
  return false;
}

export function determinarAfectadas(
  programadas: readonly PendienteProgramada[],
  senales: readonly SenalClima[],
  reloj: RelojLocal,
  maxAnalizadas: number,
): ParadaAfectada[] {
  const afectadas: ParadaAfectada[] = [];
  for (const { parada, inicio, fin } of programadas) {
    const clasificacion = clasificarParada(parada);
    if (clasificacion.tipo_entorno === "indoor") {
      continue;
    }
    const ventana = inicio === null || fin === null ? { inicio: reloj.minutos, fin: 1440 } : { inicio, fin: Math.max(fin, inicio + 1) };
    let peor: SenalClima | null = null;
    for (const senal of senales) {
      const desde = minutosLocales(senal.desde, reloj);
      const hasta = minutosLocales(senal.hasta, reloj);
      if (desde < ventana.fin && ventana.inicio < hasta && afectaA(clasificacion.sensibilidad_clima, senal) && (!peor || rango(senal.nivel) > rango(peor.nivel))) {
        peor = senal;
      }
    }
    if (!peor) {
      continue;
    }
    const supuesta = clasificacion.fuente === "supuesta" ? " La clasificación exterior es supuesta porque la parada no informa categorías." : "";
    afectadas.push({
      paradaId: parada.id,
      nombre: parada.nombre,
      inicioEstimado: inicio === null ? null : formatearHora(inicio),
      finEstimado: fin === null ? null : formatearHora(fin),
      clasificacion,
      senal: { origen: peor.origen, nivel: peor.nivel, condicion: peor.condicion, desde: peor.desde, hasta: peor.hasta },
      analizada: afectadas.filter((a) => a.analizada).length < maxAnalizadas,
      motivo: `Lugar exterior con sensibilidad ${clasificacion.sensibilidad_clima} al clima; ${describirSenal(peor, reloj)}.${supuesta}`,
    });
  }
  return afectadas;
}
