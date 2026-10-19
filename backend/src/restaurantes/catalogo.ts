import type {
  AplicabilidadTarifaRestaurante,
  ConfianzaTarifaRestaurante,
  MotivoSinEstimacionRestaurante,
  PerfilComidaRestaurante,
} from "../../../shared/types";
import { interpretarFecha } from "../clima/fechas";

export interface FuenteEstadistica {
  nombre: string;
  url: string;
  indicador: string;
  region: string;
  valorPublicado: string;
  actualizadoEn: string;
  consultadoEn: string;
}

export interface ReferenciaTarifa {
  id: string;
  perfil: PerfilComidaRestaurante;
  region: string;
  codigosPais: readonly string[];
  minimoCentavos: number;
  maximoCentavos: number;
  moneda: "GTQ";
  unidad: "persona_comida";
  aplicabilidad: AplicabilidadTarifaRestaurante;
  confianza: ConfianzaTarifaRestaurante;
  alcance: string;
  fuentes: readonly FuenteEstadistica[];
}

export interface ReglaCategoria {
  categoria: string;
  referenciaId: string;
  justificacion: string;
}

export interface CatalogoTarifasRestaurantes {
  consultadoEn: string;
  referencias: readonly ReferenciaTarifa[];
  reglas: readonly ReglaCategoria[];
}

export type AsignacionTarifa =
  | { estado: "estimado"; referencia: ReferenciaTarifa }
  | { estado: "sin_estimacion"; motivo: MotivoSinEstimacionRestaurante };

export type AsignarTarifa = (categorias: readonly string[], codigoPais: string | null) => AsignacionTarifa;

const CONSULTADO_EN = "2026-10-18";
const URL_NUMBEO_GUATEMALA = "https://www.numbeo.com/cost-of-living/country_result.jsp?country=Guatemala";
const URL_NUMBEO_CIUDAD = "https://www.numbeo.com/cost-of-living/in/Guatemala-City";
const URL_PRECIOSMUNDI = "https://preciosmundi.com/guatemala/precio-restaurantes";
const CLAVE_CATEGORIA = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const CODIGO_PAIS = /^[a-z]{2}$/;
const PERFILES: readonly PerfilComidaRestaurante[] = ["comida_rapida", "patio_de_comidas", "restaurante_general"];
const APLICABILIDADES: readonly AplicabilidadTarifaRestaurante[] = ["perfil_correspondiente", "escenario_general"];
const CONFIANZAS: readonly ConfianzaTarifaRestaurante[] = ["media", "baja"];

const NUMBEO_GUATEMALA = {
  nombre: "Numbeo — Cost of Living in Guatemala",
  url: URL_NUMBEO_GUATEMALA,
  region: "Guatemala (todas las ciudades)",
  actualizadoEn: "2026-10-02",
  consultadoEn: CONSULTADO_EN,
} as const;

const NUMBEO_CIUDAD = {
  nombre: "Numbeo — Cost of Living in Guatemala City",
  url: URL_NUMBEO_CIUDAD,
  region: "Ciudad de Guatemala",
  actualizadoEn: "2026-10-02",
  consultadoEn: CONSULTADO_EN,
} as const;

const PRECIOSMUNDI = {
  nombre: "Preciosmundi — Precios en restaurantes en Guatemala",
  url: URL_PRECIOSMUNDI,
  region: "Guatemala",
  actualizadoEn: "2026-07",
  consultadoEn: CONSULTADO_EN,
} as const;

const COMIDA_ECONOMICA_GUATEMALA: FuenteEstadistica = {
  ...NUMBEO_GUATEMALA,
  indicador: "Meal at an Inexpensive Restaurant",
  valorPublicado: "Q30.00–Q100.00 por persona (promedio Q60.00)",
};

const COMBO_GUATEMALA: FuenteEstadistica = {
  ...NUMBEO_GUATEMALA,
  indicador: "Combo Meal at McDonald's (or Equivalent Fast-Food Meal)",
  valorPublicado: "Q55.00–Q70.00 por persona (promedio Q60.61)",
};

export const CATALOGO_TARIFAS_RESTAURANTES: CatalogoTarifasRestaurantes = {
  consultadoEn: CONSULTADO_EN,
  referencias: [
    {
      id: "gt-comida-rapida",
      perfil: "comida_rapida",
      region: "Guatemala",
      codigosPais: ["gt"],
      minimoCentavos: 5000,
      maximoCentavos: 7000,
      moneda: "GTQ",
      unidad: "persona_comida",
      aplicabilidad: "perfil_correspondiente",
      confianza: "media",
      alcance:
        "Combo de comida rápida (tipo McDonald's o equivalente) para una persona. El rango es estadístico: no es el menú ni el precio publicado por el establecimiento.",
      fuentes: [
        {
          ...NUMBEO_CIUDAD,
          indicador: "Combo Meal at McDonald's (or Equivalent Fast-Food Meal)",
          valorPublicado: "Q50.00–Q70.00 por persona (promedio Q60.00)",
        },
        COMBO_GUATEMALA,
        {
          ...PRECIOSMUNDI,
          indicador: "Menú de McDonalds, Burger King o similar",
          valorPublicado: "Alrededor de Q59.94 (US$7.86) por persona",
        },
      ],
    },
    {
      id: "gt-patio-comidas",
      perfil: "patio_de_comidas",
      region: "Guatemala",
      codigosPais: ["gt"],
      minimoCentavos: 3000,
      maximoCentavos: 10000,
      moneda: "GTQ",
      unidad: "persona_comida",
      aplicabilidad: "escenario_general",
      confianza: "baja",
      alcance:
        "Escenario general de planificación para una comida en un patio de comidas con varios locales de mostrador que no se identifican individualmente. Combina el rango de comida rápida y el de restaurante económico; no es el costo confirmado de ningún local.",
      fuentes: [COMIDA_ECONOMICA_GUATEMALA, COMBO_GUATEMALA],
    },
    {
      id: "gt-restaurante-general",
      perfil: "restaurante_general",
      region: "Guatemala",
      codigosPais: ["gt"],
      minimoCentavos: 3000,
      maximoCentavos: 30000,
      moneda: "GTQ",
      unidad: "persona_comida",
      aplicabilidad: "escenario_general",
      confianza: "baja",
      alcance:
        "Escenario general de planificación para una comida principal en un restaurante cuyo nivel de precios se desconoce: desde un restaurante económico hasta uno de gama media (tres tiempos, sin bebidas). No supone que el restaurante sea económico, no cubre restaurantes de alta gama y no incluye bebidas, propinas ni cargos por servicio.",
      fuentes: [
        COMIDA_ECONOMICA_GUATEMALA,
        {
          ...NUMBEO_GUATEMALA,
          indicador: "Meal for Two at a Mid-Range Restaurant (Three Courses, Without Drinks)",
          valorPublicado: "Q300.00–Q600.00 para dos personas (promedio Q384.09); equivale a Q150.00–Q300.00 por persona",
        },
        {
          ...PRECIOSMUNDI,
          indicador: "Comida en un restaurante barato (menú del día); comida para dos en restaurante a la carta",
          valorPublicado: "Alrededor de Q59.94 por persona; alrededor de Q400 (US$52.43) para dos personas",
        },
      ],
    },
  ],
  reglas: [
    {
      categoria: "catering.fast_food",
      referenciaId: "gt-comida-rapida",
      justificacion: "La categoría corresponde a venta de comida rápida en mostrador, el mismo producto que mide el indicador de combo de comida rápida.",
    },
    {
      categoria: "catering.food_court",
      referenciaId: "gt-patio-comidas",
      justificacion: "Un patio de comidas agrupa locales de mostrador; sin identificar cada local solo se puede usar un escenario general.",
    },
    {
      categoria: "catering.restaurant",
      referenciaId: "gt-restaurante-general",
      justificacion: "La categoría no indica el nivel de precios; se usa el rango que va de restaurante económico a gama media.",
    },
  ],
};

export function validarCatalogo(catalogo: CatalogoTarifasRestaurantes): string[] {
  const problemas: string[] = [];
  if (interpretarFecha(catalogo.consultadoEn) === null) {
    problemas.push("consultadoEn del catálogo debe ser una fecha AAAA-MM-DD.");
  }

  const ids = new Set<string>();
  for (const referencia of catalogo.referencias) {
    const { id } = referencia;
    if (id.trim() === "") {
      problemas.push("Hay una referencia sin identificador.");
    } else if (ids.has(id)) {
      problemas.push(`La referencia ${id} está repetida.`);
    }
    ids.add(id);

    if (!PERFILES.includes(referencia.perfil)) {
      problemas.push(`${id}: perfil no admitido.`);
    }
    if (!APLICABILIDADES.includes(referencia.aplicabilidad)) {
      problemas.push(`${id}: aplicabilidad no admitida.`);
    }
    if (!CONFIANZAS.includes(referencia.confianza)) {
      problemas.push(`${id}: confianza no admitida.`);
    }
    if (referencia.moneda !== "GTQ" || referencia.unidad !== "persona_comida") {
      problemas.push(`${id}: la moneda debe ser GTQ y la unidad persona_comida.`);
    }
    const { minimoCentavos: minimo, maximoCentavos: maximo } = referencia;
    if (!Number.isSafeInteger(minimo) || !Number.isSafeInteger(maximo) || minimo <= 0 || maximo <= 0) {
      problemas.push(`${id}: el rango debe expresarse en centavos enteros positivos.`);
    } else if (minimo > maximo) {
      problemas.push(`${id}: el mínimo supera al máximo.`);
    }
    if (referencia.region.trim() === "" || referencia.codigosPais.length === 0 || !referencia.codigosPais.every((codigo) => CODIGO_PAIS.test(codigo))) {
      problemas.push(`${id}: la región debe tener nombre y códigos de país ISO 3166-1 alfa-2 en minúsculas.`);
    }
    if (referencia.alcance.trim() === "") {
      problemas.push(`${id}: falta la descripción del alcance.`);
    }
    if (referencia.fuentes.length === 0) {
      problemas.push(`${id}: debe tener al menos una fuente.`);
    }
    for (const fuente of referencia.fuentes) {
      if (!fuente.url.startsWith("https://") || fuente.nombre.trim() === "" || fuente.indicador.trim() === "") {
        problemas.push(`${id}: cada fuente necesita nombre, indicador y URL https.`);
      }
      if (interpretarFecha(fuente.consultadoEn) === null) {
        problemas.push(`${id}: la fecha de consulta de ${fuente.nombre} debe tener formato AAAA-MM-DD.`);
      }
    }
  }

  const categorias = new Set<string>();
  for (const regla of catalogo.reglas) {
    if (!CLAVE_CATEGORIA.test(regla.categoria)) {
      problemas.push(`La categoría ${regla.categoria} no tiene formato de Geoapify.`);
    } else if (categorias.has(regla.categoria)) {
      problemas.push(`La categoría ${regla.categoria} tiene más de una regla.`);
    }
    categorias.add(regla.categoria);
    if (!ids.has(regla.referenciaId)) {
      problemas.push(`La regla de ${regla.categoria} apunta a una referencia inexistente: ${regla.referenciaId}.`);
    }
    if (regla.justificacion.trim() === "") {
      problemas.push(`La regla de ${regla.categoria} no tiene justificación.`);
    }
  }
  return problemas;
}

function perteneceA(categoria: string, base: string): boolean {
  return categoria === base || categoria.startsWith(`${base}.`);
}

export function crearAsignadorTarifas(catalogo: CatalogoTarifasRestaurantes = CATALOGO_TARIFAS_RESTAURANTES): AsignarTarifa {
  const problemas = validarCatalogo(catalogo);
  if (problemas.length > 0) {
    throw new Error(`El catálogo de tarifas de restaurantes no es válido: ${problemas.join(" ")}`);
  }
  const referencias = new Map(catalogo.referencias.map((referencia) => [referencia.id, referencia]));

  return function asignarTarifa(categorias, codigoPais) {
    let elegida: ReferenciaTarifa | null = null;
    for (const regla of catalogo.reglas) {
      const referencia = referencias.get(regla.referenciaId) as ReferenciaTarifa;
      // Si coinciden varios perfiles se usa el de máximo más alto para no subestimar el costo.
      if (categorias.some((categoria) => perteneceA(categoria, regla.categoria)) && (!elegida || referencia.maximoCentavos > elegida.maximoCentavos)) {
        elegida = referencia;
      }
    }
    if (!elegida) {
      return { estado: "sin_estimacion", motivo: "categoria_sin_referencia" };
    }
    if (codigoPais === null) {
      return { estado: "sin_estimacion", motivo: "region_no_identificada" };
    }
    if (!elegida.codigosPais.includes(codigoPais)) {
      return { estado: "sin_estimacion", motivo: "region_no_cubierta" };
    }
    return { estado: "estimado", referencia: elegida };
  };
}

export function fuentesDelCatalogo(catalogo: CatalogoTarifasRestaurantes): { nombre: string; url: string }[] {
  const porUrl = new Map<string, string>();
  for (const referencia of catalogo.referencias) {
    for (const { url, nombre } of referencia.fuentes) {
      if (!porUrl.has(url)) {
        porUrl.set(url, nombre);
      }
    }
  }
  return [...porUrl].map(([url, nombre]) => ({ nombre, url }));
}
