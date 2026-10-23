import type { ConsultarPlaces } from "../geoapify/cliente";
import { transformarLugares, type Lugar } from "../geoapify/transformar";
import type { Coordenada } from "../hoteles/geografia";
import { esObjeto } from "../tipos";

export const CATEGORIAS_RESTAURANTES: readonly string[] = Object.freeze(["catering.restaurant", "catering.fast_food", "catering.food_court"]);
export const RESULTADOS_PROVEEDOR_POR_PARADA = 40;

const CODIGO_PAIS = /^[a-z]{2}$/i;

export interface RestauranteProveedor extends Lugar {
  codigoPais: string | null;
}

export interface ResultadoBusquedaRestaurantes {
  resultadosRecibidos: number;
  restaurantes: RestauranteProveedor[];
}

export type BuscarRestaurantes = (centro: Coordenada, radio: number) => Promise<ResultadoBusquedaRestaurantes>;

function codigosPais(features: unknown[]): Map<string, string> {
  const codigos = new Map<string, string>();
  for (const feature of features) {
    const propiedades = esObjeto(feature) ? feature.properties : null;
    if (!esObjeto(propiedades)) {
      continue;
    }
    const { place_id: id, country_code: codigo } = propiedades;
    if (typeof id === "string" && typeof codigo === "string" && CODIGO_PAIS.test(codigo) && !codigos.has(id)) {
      codigos.set(id, codigo.toLowerCase());
    }
  }
  return codigos;
}

export function crearBuscadorRestaurantes(
  consultarPlaces: ConsultarPlaces,
  resultadosPorParada: number = RESULTADOS_PROVEEDOR_POR_PARADA,
): BuscarRestaurantes {
  return async function buscarRestaurantes({ lat, lng }, radio) {
    const datos = await consultarPlaces({ lat, lng, categorias: [...CATEGORIAS_RESTAURANTES], radio, limite: resultadosPorParada });
    const lugares = transformarLugares(datos);
    const features = (datos as { features: unknown[] }).features;
    const paises = codigosPais(features);
    return {
      resultadosRecibidos: features.length,
      restaurantes: lugares.map((lugar) => ({ ...lugar, codigoPais: paises.get(lugar.idExterno) ?? null })),
    };
  };
}
