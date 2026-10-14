import { interpretarHorario, horarioErrorConsulta, type Horario } from "./horario";
import { transformarDetalles, type Lugar } from "./transformar";
import type { ConsultarDetalles, PropiedadesDetalles } from "./detalles";

export const CONCURRENCIA_DETALLES = 4;
export const INTERVALO_DETALLES_MS = 250;
export const PRESUPUESTO_DETALLES_MS = 10000;

export interface OpcionesEnriquecedor {
  consultarDetalles: ConsultarDetalles;
  concurrencia?: number;
  intervaloMs?: number;
  presupuestoMs?: number;
}

export type EnriquecerHorarios = <T extends { idExterno: string }>(lugares: T[]) => Promise<(T & { horario: Horario })[]>;

export interface LugarResuelto {
  lugar: Lugar | null;
  horario: Horario;
}

export type ResolverLugares = (identificadores: string[]) => Promise<Map<string, LugarResuelto>>;

type ConsultarVarios = <R>(
  identificadores: string[],
  transformar: (propiedades: PropiedadesDetalles, idExterno: string) => R,
  alFallar: () => R,
) => Promise<Map<string, R>>;

function esperar(ms: number, senal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || senal.aborted) {
      resolve();
      return;
    }
    const temporizador = setTimeout(terminar, ms);
    senal.addEventListener("abort", terminar, { once: true });
    function terminar() {
      clearTimeout(temporizador);
      senal.removeEventListener("abort", terminar);
      resolve();
    }
  });
}

function crearConsultaLimitada({
  consultarDetalles,
  concurrencia = CONCURRENCIA_DETALLES,
  intervaloMs = INTERVALO_DETALLES_MS,
  presupuestoMs = PRESUPUESTO_DETALLES_MS,
}: OpcionesEnriquecedor): ConsultarVarios {
  return async function consultarVarios<R>(
    identificadores: string[],
    transformar: (propiedades: PropiedadesDetalles, idExterno: string) => R,
    alFallar: () => R,
  ) {
    const resultados = new Map<string, R>();
    const controlador = new AbortController();
    const { signal: senal } = controlador;
    let siguiente = 0;
    let proximoInicio = 0;

    async function obtener(idExterno: string): Promise<R> {
      try {
        const propiedades = await consultarDetalles(idExterno, senal);
        return transformar(propiedades, idExterno);
      } catch {
        return alFallar();
      }
    }

    async function trabajador(): Promise<void> {
      while (siguiente < identificadores.length && !senal.aborted) {
        const idExterno = identificadores[siguiente++];
        const ahora = Date.now();
        const espera = proximoInicio - ahora;
        proximoInicio = Math.max(ahora, proximoInicio) + intervaloMs;
        await esperar(espera, senal);
        if (senal.aborted) {
          return;
        }
        const resultado = await obtener(idExterno);
        if (!senal.aborted) {
          resultados.set(idExterno, resultado);
        }
      }
    }

    let temporizador: NodeJS.Timeout | undefined;
    const presupuestoAgotado = new Promise<void>((resolve) => {
      temporizador = setTimeout(() => {
        controlador.abort();
        resolve();
      }, presupuestoMs);
    });
    const trabajadores = Array.from({ length: Math.min(concurrencia, identificadores.length) }, trabajador);

    try {
      await Promise.race([Promise.all(trabajadores), presupuestoAgotado]);
    } finally {
      clearTimeout(temporizador);
    }

    return resultados;
  };
}

export function crearEnriquecedorHorarios(opciones: OpcionesEnriquecedor): EnriquecerHorarios {
  const consultarVarios = crearConsultaLimitada(opciones);

  return async function enriquecerHorarios<T extends { idExterno: string }>(lugares: T[]) {
    if (lugares.length === 0) {
      return [];
    }

    const identificadores = [...new Set(lugares.map((lugar) => lugar.idExterno))];
    const horarios = await consultarVarios(
      identificadores,
      (propiedades) => interpretarHorario(propiedades.opening_hours),
      horarioErrorConsulta,
    );

    return lugares.map((lugar) => ({ ...lugar, horario: horarios.get(lugar.idExterno) ?? horarioErrorConsulta() }));
  };
}

function lugarNoResuelto(): LugarResuelto {
  return { lugar: null, horario: horarioErrorConsulta() };
}

export function crearResolvedorLugares(opciones: OpcionesEnriquecedor): ResolverLugares {
  const consultarVarios = crearConsultaLimitada(opciones);

  return async function resolverLugares(identificadores) {
    const unicos = [...new Set(identificadores)];
    if (unicos.length === 0) {
      return new Map();
    }

    const resultados = await consultarVarios<LugarResuelto>(
      unicos,
      (propiedades, idExterno) => ({
        lugar: transformarDetalles(propiedades, idExterno),
        horario: interpretarHorario(propiedades.opening_hours),
      }),
      lugarNoResuelto,
    );

    return new Map(unicos.map((idExterno) => [idExterno, resultados.get(idExterno) ?? lugarNoResuelto()]));
  };
}
