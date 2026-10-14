import type {
  ClasificacionClima,
  DecisionClimaDia,
  EstadoPronosticoDiario,
  MotivoPrioridadClima,
  SensibilidadClima,
  TipoEntorno,
} from "../../../shared/types";

export type LugarClasificado = Pick<ClasificacionClima, "tipo_entorno" | "sensibilidad_clima">;

export interface PronosticoDia {
  estado: EstadoPronosticoDiario;
  lluviaMm: number | null;
}

export type DecisionPrioridad = Omit<DecisionClimaDia, "numeroDia" | "fecha">;

export interface ResultadoPrioridad<T> {
  lugares: T[];
  decision: DecisionPrioridad;
}

const ORDEN_ENTORNO: Record<TipoEntorno, number> = { indoor: 0, outdoor: 1 };
const ORDEN_SENSIBILIDAD: Record<SensibilidadClima, number> = { baja: 0, media: 1, alta: 2 };

const MENSAJE_POR_MOTIVO: Record<MotivoPrioridadClima, string> = {
  lluvia_pronosticada:
    "Se pronostica lluvia: se sugieren primero los lugares bajo techo y, dentro de cada grupo, los menos sensibles al clima.",
  sin_lluvia_pronosticada: "El pronóstico del día no indica lluvia; se conserva el orden propuesto.",
  sin_lluvia_en_cobertura_parcial:
    "Los intervalos disponibles no indican lluvia, pero el pronóstico cubre solo parte del día; se conserva el orden propuesto sin asegurar un día sin lluvia.",
  pronostico_fuera_de_cobertura:
    "La fecha está fuera del pronóstico disponible; no se pudo aplicar la prioridad por lluvia y se conserva el orden propuesto.",
  pronostico_sin_datos:
    "El proveedor no devolvió pronóstico para la fecha; no se pudo aplicar la prioridad por lluvia y se conserva el orden propuesto.",
  consulta_clima_fallida:
    "No se pudo consultar el pronóstico; no se aplicó la prioridad por lluvia y se conserva el orden propuesto.",
};

function decidir(pronostico: PronosticoDia | null): Omit<DecisionPrioridad, "ordenModificado" | "mensaje"> {
  if (!pronostico) {
    return { estadoPronostico: "error_consulta", lluviaMm: null, prioridadAplicada: false, motivo: "consulta_clima_fallida" };
  }
  const { estado, lluviaMm } = pronostico;
  if (estado === "fuera_de_cobertura") {
    return { estadoPronostico: estado, lluviaMm: null, prioridadAplicada: false, motivo: "pronostico_fuera_de_cobertura" };
  }
  if (estado === "sin_datos" || lluviaMm === null || !Number.isFinite(lluviaMm)) {
    return { estadoPronostico: estado, lluviaMm: null, prioridadAplicada: false, motivo: "pronostico_sin_datos" };
  }
  if (lluviaMm > 0) {
    return { estadoPronostico: estado, lluviaMm, prioridadAplicada: true, motivo: "lluvia_pronosticada" };
  }
  return {
    estadoPronostico: estado,
    lluviaMm,
    prioridadAplicada: false,
    motivo: estado === "parcial" ? "sin_lluvia_en_cobertura_parcial" : "sin_lluvia_pronosticada",
  };
}

export function ordenarPorPrioridadLluvia<T extends LugarClasificado>(lugares: readonly T[]): T[] {
  return lugares
    .map((lugar, posicion) => ({ lugar, posicion }))
    .sort(
      (a, b) =>
        ORDEN_ENTORNO[a.lugar.tipo_entorno] - ORDEN_ENTORNO[b.lugar.tipo_entorno] ||
        ORDEN_SENSIBILIDAD[a.lugar.sensibilidad_clima] - ORDEN_SENSIBILIDAD[b.lugar.sensibilidad_clima] ||
        a.posicion - b.posicion,
    )
    .map(({ lugar }) => lugar);
}

export function priorizarPorClima<T extends LugarClasificado>(
  lugares: readonly T[],
  pronostico: PronosticoDia | null,
): ResultadoPrioridad<T> {
  const decision = decidir(pronostico);
  const ordenados = decision.prioridadAplicada ? ordenarPorPrioridadLluvia(lugares) : [...lugares];
  return {
    lugares: ordenados,
    decision: {
      ...decision,
      ordenModificado: ordenados.some((lugar, posicion) => lugar !== lugares[posicion]),
      mensaje: MENSAJE_POR_MOTIVO[decision.motivo],
    },
  };
}
