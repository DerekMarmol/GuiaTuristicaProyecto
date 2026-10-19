import { ErrorApi } from "../../errores";
import type { ObtenerClimaActual, ObtenerPronostico } from "../../openweather/cliente";
import type { ClimaActual, Pronostico } from "../../openweather/transformar";
import type { Resultado } from "./deteccion";

const MAX_ENTRADAS = 200;

interface Entrada<T> {
  valor: T;
  obtenidoEn: number;
}

// Guarda solo respuestas exitosas; las consultas simultáneas de la misma clave comparten una sola petición.
export function crearCacheTemporal<T>({ vigenciaMs, ahora }: { vigenciaMs: number; ahora: () => Date }) {
  const entradas = new Map<string, Entrada<T>>();
  const enCurso = new Map<string, Promise<Entrada<T>>>();

  return async function obtener(clave: string, cargar: () => Promise<T>): Promise<Entrada<T>> {
    const guardada = entradas.get(clave);
    if (guardada && ahora().getTime() - guardada.obtenidoEn < vigenciaMs) {
      return guardada;
    }
    const pendiente = enCurso.get(clave);
    if (pendiente) {
      return pendiente;
    }
    const promesa = cargar()
      .then((valor) => {
        const entrada = { valor, obtenidoEn: ahora().getTime() };
        entradas.delete(clave);
        entradas.set(clave, entrada);
        if (entradas.size > MAX_ENTRADAS) {
          entradas.delete(entradas.keys().next().value as string);
        }
        return entrada;
      })
      .finally(() => enCurso.delete(clave));
    enCurso.set(clave, promesa);
    return promesa;
  };
}

export interface ClimaConsultado {
  actual: Resultado<ClimaActual>;
  pronostico: Resultado<Pronostico>;
  consultadoEn: Date;
}

export type ObtenerClimaReactivo = (ubicacion: { lat: number; lng: number }) => Promise<ClimaConsultado>;

// Unos 110 m: las paradas de un mismo sector comparten la consulta mientras está vigente.
const claveUbicacion = ({ lat, lng }: { lat: number; lng: number }) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

export function crearObtenedorClima({
  obtenerClimaActual,
  obtenerPronostico,
  vigenciaMs,
  ahora,
}: {
  obtenerClimaActual: ObtenerClimaActual;
  obtenerPronostico: ObtenerPronostico;
  vigenciaMs: number;
  ahora: () => Date;
}): ObtenerClimaReactivo {
  const cacheActual = crearCacheTemporal<ClimaActual>({ vigenciaMs, ahora });
  const cachePronostico = crearCacheTemporal<Pronostico>({ vigenciaMs, ahora });

  async function capturar<T>(promesa: Promise<Entrada<T>>): Promise<{ resultado: Resultado<T>; obtenidoEn: number | null }> {
    try {
      const { valor, obtenidoEn } = await promesa;
      return { resultado: { ok: true, valor }, obtenidoEn };
    } catch (error) {
      if (!(error instanceof ErrorApi)) {
        throw error;
      }
      return { resultado: { ok: false, error }, obtenidoEn: null };
    }
  }

  return async function obtenerClima(ubicacion) {
    const clave = claveUbicacion(ubicacion);
    const [actual, pronostico] = await Promise.all([
      capturar(cacheActual(clave, () => obtenerClimaActual(ubicacion))),
      capturar(cachePronostico(clave, () => obtenerPronostico(ubicacion))),
    ]);
    const tiempos = [actual.obtenidoEn, pronostico.obtenidoEn].filter((t): t is number => t !== null);
    return {
      actual: actual.resultado,
      pronostico: pronostico.resultado,
      consultadoEn: new Date(tiempos.length > 0 ? Math.min(...tiempos) : ahora().getTime()),
    };
  };
}
