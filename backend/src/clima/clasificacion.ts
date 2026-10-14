import type { ClasificacionClima, SensibilidadClima, TipoEntorno } from "../../../shared/types";
import { CLASIFICACION_POR_DEFECTO, REGLAS_ENTORNO_CLIMA, type ReglaEntornoClima } from "../config/entornoClima";

const RIESGO_ENTORNO: Record<TipoEntorno, number> = { indoor: 0, outdoor: 1 };
const RIESGO_SENSIBILIDAD: Record<SensibilidadClima, number> = { baja: 0, media: 1, alta: 2 };

function profundidad(categoria: string): number {
  return categoria.split(".").length;
}

function cubre(regla: ReglaEntornoClima, categoria: string): boolean {
  return categoria === regla.categoria || categoria.startsWith(`${regla.categoria}.`);
}

function precede(a: ReglaEntornoClima, b: ReglaEntornoClima): boolean {
  const porProfundidad = profundidad(a.categoria) - profundidad(b.categoria);
  if (porProfundidad !== 0) {
    return porProfundidad > 0;
  }
  const porEntorno = RIESGO_ENTORNO[a.tipo_entorno] - RIESGO_ENTORNO[b.tipo_entorno];
  if (porEntorno !== 0) {
    return porEntorno > 0;
  }
  const porSensibilidad = RIESGO_SENSIBILIDAD[a.sensibilidad_clima] - RIESGO_SENSIBILIDAD[b.sensibilidad_clima];
  if (porSensibilidad !== 0) {
    return porSensibilidad > 0;
  }
  return a.categoria < b.categoria;
}

export function clasificarEntorno(
  categorias: readonly string[],
  reglas: readonly ReglaEntornoClima[] = REGLAS_ENTORNO_CLIMA,
): ClasificacionClima {
  let elegida: ReglaEntornoClima | null = null;
  for (const regla of reglas) {
    if (categorias.some((categoria) => cubre(regla, categoria)) && (!elegida || precede(regla, elegida))) {
      elegida = regla;
    }
  }

  if (!elegida) {
    return { ...CLASIFICACION_POR_DEFECTO, regla_clima: null };
  }
  return { tipo_entorno: elegida.tipo_entorno, sensibilidad_clima: elegida.sensibilidad_clima, regla_clima: elegida.categoria };
}
