const CATEGORIAS_POR_INTERES = Object.freeze({
  Cultura: Object.freeze(["entertainment.culture", "entertainment.museum"]),
  Historia: Object.freeze(["tourism.sights", "heritage"]),
  "Gastronomía": Object.freeze(["catering.restaurant", "catering.cafe"]),
  Naturaleza: Object.freeze(["natural", "national_park", "leisure.park"]),
  Aventura: Object.freeze([
    "entertainment.activity_park",
    "entertainment.theme_park",
    "entertainment.water_park",
    "natural.mountain",
  ]),
  Compras: Object.freeze([
    "commercial.shopping_mall",
    "commercial.marketplace",
    "commercial.department_store",
    "commercial.gift_and_souvenir",
  ]),
  "Vida nocturna": Object.freeze(["catering.bar", "catering.pub", "adult.nightclub"]),
  Playa: Object.freeze(["beach"]),
  "Fotografía": Object.freeze(["tourism.attraction", "tourism.sights"]),
  Arte: Object.freeze([
    "entertainment.culture.gallery",
    "entertainment.culture.arts_centre",
    "tourism.attraction.artwork",
    "commercial.art",
  ]),
});

const INTERESES_PERMITIDOS = Object.freeze(Object.keys(CATEGORIAS_POR_INTERES));

module.exports = { CATEGORIAS_POR_INTERES, INTERESES_PERMITIDOS };
