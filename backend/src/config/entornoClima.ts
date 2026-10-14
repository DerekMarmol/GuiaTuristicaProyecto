import type { SensibilidadClima, TipoEntorno } from "../../../shared/types";

export interface ReglaEntornoClima {
  categoria: string;
  tipo_entorno: TipoEntorno;
  sensibilidad_clima: SensibilidadClima;
}

function regla(categoria: string, tipo_entorno: TipoEntorno, sensibilidad_clima: SensibilidadClima): ReglaEntornoClima {
  return Object.freeze({ categoria, tipo_entorno, sensibilidad_clima });
}

export const CLASIFICACION_POR_DEFECTO: Readonly<{ tipo_entorno: TipoEntorno; sensibilidad_clima: SensibilidadClima }> = Object.freeze({
  tipo_entorno: "outdoor",
  sensibilidad_clima: "alta",
});

export const REGLAS_ENTORNO_CLIMA: readonly ReglaEntornoClima[] = Object.freeze([
  regla("entertainment.museum", "indoor", "baja"),
  regla("entertainment.culture", "indoor", "baja"),
  regla("entertainment.aquarium", "indoor", "baja"),
  regla("entertainment.planetarium", "indoor", "baja"),
  regla("entertainment.cinema", "indoor", "baja"),
  regla("entertainment.bowling_alley", "indoor", "baja"),
  regla("entertainment.escape_game", "indoor", "baja"),
  regla("entertainment.amusement_arcade", "indoor", "baja"),
  regla("catering", "indoor", "baja"),
  regla("catering.restaurant", "indoor", "baja"),
  regla("catering.cafe", "indoor", "baja"),
  regla("catering.biergarten", "outdoor", "alta"),
  regla("commercial.shopping_mall", "indoor", "baja"),
  regla("commercial.department_store", "indoor", "baja"),
  regla("commercial.marketplace", "outdoor", "media"),
  regla("accommodation", "indoor", "baja"),
  regla("adult.nightclub", "indoor", "baja"),
  regla("religion.place_of_worship", "indoor", "baja"),
  regla("tourism.sights.place_of_worship", "indoor", "baja"),
  regla("tourism.sights.castle", "outdoor", "media"),
  regla("tourism.sights.fort", "outdoor", "media"),
  regla("tourism.sights.archaeological_site", "outdoor", "alta"),
  regla("tourism.sights.ruines", "outdoor", "alta"),
  regla("tourism.attraction.viewpoint", "outdoor", "alta"),
  regla("leisure.park", "outdoor", "alta"),
  regla("leisure.picnic", "outdoor", "alta"),
  regla("leisure.playground", "outdoor", "alta"),
  regla("natural", "outdoor", "alta"),
  regla("national_park", "outdoor", "alta"),
  regla("beach", "outdoor", "alta"),
  regla("beach.beach_resort", "outdoor", "media"),
  regla("entertainment.zoo", "outdoor", "alta"),
  regla("entertainment.theme_park", "outdoor", "alta"),
  regla("entertainment.water_park", "outdoor", "alta"),
  regla("entertainment.activity_park", "outdoor", "alta"),
  regla("entertainment.miniature_golf", "outdoor", "alta"),
  regla("entertainment.flying_fox", "outdoor", "alta"),
]);
