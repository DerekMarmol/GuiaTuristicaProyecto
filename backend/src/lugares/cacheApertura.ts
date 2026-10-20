import { MAX_ENTRADAS_CACHE_APERTURA, VIGENCIA_CACHE_APERTURA_MS } from "../config/abiertosAhora";
import type { ConsultarApertura, DatosApertura } from "../geoapify/enriquecer";

interface Entrada {
  datos: DatosApertura;
  expiraEn: number;
}

export interface OpcionesCacheApertura {
  consultar: ConsultarApertura;
  vigenciaMs?: number;
  maxEntradas?: number;
  ahora?: () => Date;
}

// Guarda el horario publicado y la zona horaria, nunca el estado de apertura: open_now se recalcula en cada consulta.
// Los fallos de consulta no se guardan para que el siguiente intento vuelva a preguntar al proveedor.
export function crearCacheApertura({
  consultar,
  vigenciaMs = VIGENCIA_CACHE_APERTURA_MS,
  maxEntradas = MAX_ENTRADAS_CACHE_APERTURA,
  ahora = () => new Date(),
}: OpcionesCacheApertura): ConsultarApertura {
  const entradas = new Map<string, Entrada>();

  function vigente(idExterno: string, instante: number): DatosApertura | null {
    const entrada = entradas.get(idExterno);
    if (!entrada) {
      return null;
    }
    if (entrada.expiraEn <= instante) {
      entradas.delete(idExterno);
      return null;
    }
    return entrada.datos;
  }

  function guardar(idExterno: string, datos: DatosApertura, instante: number): void {
    entradas.delete(idExterno);
    entradas.set(idExterno, { datos, expiraEn: instante + vigenciaMs });
    while (entradas.size > maxEntradas) {
      const masAntigua = entradas.keys().next().value as string;
      entradas.delete(masAntigua);
    }
  }

  return async function consultarConCache(identificadores) {
    const unicos = [...new Set(identificadores)];
    const resultado = new Map<string, DatosApertura>();
    const pendientes: string[] = [];
    const inicio = ahora().getTime();

    for (const idExterno of unicos) {
      const datos = vigente(idExterno, inicio);
      if (datos) {
        resultado.set(idExterno, datos);
      } else {
        pendientes.push(idExterno);
      }
    }

    if (pendientes.length > 0) {
      const consultados = await consultar(pendientes);
      const fin = ahora().getTime();
      for (const idExterno of pendientes) {
        const datos = consultados.get(idExterno);
        if (!datos) {
          continue;
        }
        resultado.set(idExterno, datos);
        if (datos.horario.estado !== "error_consulta") {
          guardar(idExterno, datos, fin);
        }
      }
    }

    return resultado;
  };
}
