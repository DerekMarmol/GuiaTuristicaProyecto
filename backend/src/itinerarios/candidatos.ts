import type { Viaje } from "../../../shared/types";
import type { LugarReal } from "../ai/tipos";
import { CATEGORIAS_POR_INTERES } from "../config/intereses";
import { ErrorApi } from "../errores";
import type { BuscarLugares } from "../geoapify/cliente";
import type { EnriquecerHorarios } from "../geoapify/enriquecer";
import type { DestinoGeocodificado } from "../geoapify/geocodificacion";
import type { Lugar } from "../geoapify/transformar";
import type { BuscarEnFoursquare, LugarFoursquare } from "../foursquare/cliente";
import { distanciaMetros, type Coordenada } from "../hoteles/geografia";

export const PARADAS_OBJETIVO_POR_DIA = 3;
export const MAX_CANDIDATOS = 40;
const MIN_CANDIDATOS = 15;
const MIN_POR_INTERES = 6;
const MAX_POR_INTERES = 15;
const MIN_POR_CATEGORIA = 3;
// El plan gratuito de Geoapify admite 5 solicitudes por segundo.
const CONSULTAS_SIMULTANEAS = 3;
const DISTANCIA_DUPLICADO_METROS = 200;
// Con nombres de dos o más palabras en común («Río Dulce» y «Parque Nacional Río Dulce») se tolera más
// distancia: el mismo sitio aparece como punto, como área y en Foursquare, con centros separados.
const DISTANCIA_MISMO_NOMBRE_METROS = 3000;
const DISTANCIA_MISMO_NOMBRE_EXACTO_METROS = 30_000;

// Radio de búsqueda en metros. Los intereses que suelen estar a las afueras (naturaleza, playas, sitios
// históricos y arqueológicos) amplían la búsqueda si traen pocos lugares. Los urbanos (compras, comida,
// cultura…) se quedan en el pueblo: nadie va de compras al municipio vecino porque en el suyo hay pocas tiendas.
const INTERESES_FUERA_DEL_PUEBLO = new Set(["Naturaleza", "Playa", "Aventura", "Fotografía", "Historia"]);
const RADIOS = {
  afueras: { "A pie": { inicial: 3000, ampliado: 6000 }, vehiculo: { inicial: 15000, ampliado: 30000 } },
  urbano: { "A pie": { inicial: 2000, ampliado: 2000 }, vehiculo: { inicial: 5000, ampliado: 5000 } },
};

export function radiosDeBusqueda(interes: string, transporte: Viaje["transporte"]): { inicial: number; ampliado: number } {
  const grupo = INTERESES_FUERA_DEL_PUEBLO.has(interes) ? RADIOS.afueras : RADIOS.urbano;
  return transporte === "A pie" ? grupo["A pie"] : grupo.vehiculo;
}

// Lo que justifica el viaje aunque quede lejos del pueblo: Tikal está a 60 km de Flores. En vehículo se busca
// además en este radio, y por su importancia van primero.
const IMPERDIBLES_POR_INTERES: Record<string, string[]> = {
  Historia: ["heritage.unesco", "tourism.sights.archaeological_site", "tourism.sights.castle"],
  Naturaleza: ["heritage.unesco", "national_park"],
  Cultura: ["heritage.unesco"],
  "Fotografía": ["heritage.unesco", "national_park"],
};
const RADIO_IMPERDIBLES_METROS = 80_000;
const MAX_IMPERDIBLES = 6;

// Cuando el destino es un departamento o municipio se busca en todo su límite, pero un viaje no recorre
// Petén de punta a punta: se arma alrededor del lugar más importante y se deja fuera lo que queda más lejos.
const DISTANCIA_MAXIMA_EN_AREA = { "A pie": 10_000, vehiculo: 80_000 };
// Se piden más lugares por categoría de los que se usan, para elegir los importantes y no solo los más
// cercanos al centro (en Antigua, la Merced no está entre los diez templos más cercanos a la plaza).
const POR_CATEGORIA_EN_PUEBLO = 30;
const POR_CATEGORIA_EN_AREA = 100;
// Cada cuántos km de distancia al centro se resta un punto de importancia: Tikal (7 puntos) a 40 km de Flores
// sigue antes que una plaza del pueblo, pero una ruina sin ficha a 20 km ya no le gana a la catedral.
const KM_POR_PUNTO = 10;

// Intereses en los que Foursquare es la fuente principal (OpenStreetMap tiene pocos negocios). En los demás,
// sus lugares van detrás de los de OpenStreetMap: muchos son registros de usuarios («Felipe», «livingstone»).
const INTERESES_DE_NEGOCIOS = new Set(["Compras", "Gastronomía", "Vida nocturna"]);

// Partes de un sitio arqueológico que OpenStreetMap registra por separado (cada estela de Quiriguá, cada
// conjunto de Tikal): se recorren dentro del sitio, no son una parada aparte.
const PARTES_DE_UN_SITIO = /^(estela|stela|stele|zoomorfo|altar|monumento limitrofe|conjunto|grupo|estructura|structure|estanque)\b/i;

// En Guatemala la mayoría de lugares de OpenStreetMap no publica horario. Descartarlos dejaría el
// itinerario casi vacío, así que se usa un horario típico de su tipo y la parada se marca como estimada.
// Se evalúan en orden: el primer prefijo que coincide gana.
const HORARIOS_TIPICOS: [prefijo: string, apertura: string, cierre: string][] = [
  ["catering.cafe", "07:00", "19:00"],
  ["catering.bar", "18:00", "23:59"],
  ["catering.pub", "18:00", "23:59"],
  ["adult.nightclub", "20:00", "23:59"],
  ["catering", "11:00", "21:00"],
  ["commercial", "09:00", "19:00"],
  ["entertainment", "09:00", "17:00"],
  ["beach", "06:00", "18:00"],
  ["natural", "06:00", "18:00"],
  ["national_park", "06:00", "18:00"],
  ["leisure", "06:00", "18:00"],
  ["tourism", "06:00", "18:00"],
  ["heritage", "06:00", "18:00"],
];
const HORARIO_TIPICO_PREDETERMINADO = { apertura: "09:00", cierre: "17:00" };

// GUI-118: OpenStreetMap etiqueta a veces como «recuerdos» o «tienda» negocios que no son un paseo de compras
// (una perfumería, una farmacia, una ferretería). Para Compras se descartan por el nombre, en las dos fuentes.
const NOMBRES_QUE_NO_SON_COMPRAS =
  /perfum|farmac|ferreter|celular|telefon|repuesto|agroservicio|agropecuari|pintura|materiales de construcci|llanter|gasolin|banco|cooperativa|funeraria|optica|clinica|supermercad|despensa|abarrot|tienda de conveniencia|pulper|walmart/i;

function encajaConElInteres(lugar: { nombre: string }, interes: string): boolean {
  const nombre = lugar.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (PARTES_DE_UN_SITIO.test(nombre) || pareceUnaNota(lugar.nombre)) return false;
  if (INTERESES_AL_AIRE_LIBRE.has(interes) && NOMBRES_DE_TEMPLOS.test(nombre)) return false;
  return interes !== "Compras" || !NOMBRES_QUE_NO_SON_COMPRAS.test(nombre);
}

// Notas que alguien dejó en el mapa como si fueran lugares («detachment one hour from here», «little farms
// owned by barcos»): un nombre propio empieza con mayúscula y es corto; una frase en minúscula o muy larga no.
const MAX_PALABRAS_EN_UN_NOMBRE = 8;

export function pareceUnaNota(nombre: string): boolean {
  const limpio = nombre.trim();
  const palabras = limpio.split(/\s+/).length;
  return (palabras >= 2 && /^\p{Ll}/u.test(limpio)) || palabras > MAX_PALABRAS_EN_UN_NOMBRE;
}

// Las capillas del vía crucis de un cerro quedan dentro de un área protegida y llegan como «naturaleza».
const INTERESES_AL_AIRE_LIBRE = new Set(["Naturaleza", "Playa", "Aventura"]);
const NOMBRES_DE_TEMPLOS = /^(capil+a|ermita|iglesia|parroquia|templo|catedral)\b/i;

// Las plazas, acrópolis y templos de Tikal están en OpenStreetMap como lugares propios (y algunos con ficha),
// pero se recorren en la misma visita al parque. Un lugar del mismo tipo (sitio, ruina, parque) a menos de
// RADIO_DE_UN_SITIO_METROS de un sitio más importante es parte de él; un museo, un templo o un restaurante
// cercano, no.
const RADIO_DE_UN_SITIO_METROS = 5000;
const CATEGORIAS_DE_SITIO = ["heritage.unesco", "national_park", "tourism.sights.archaeological_site"];

function esParteDe(lugar: LugarDeFuente, sitio: LugarDeFuente): boolean {
  return (
    lugar !== sitio &&
    sitio.categorias.some((c) => CATEGORIAS_DE_SITIO.includes(c)) &&
    lugar.categorias.every((c) => /^(tourism|leisure|heritage)(\.|$)/.test(c)) &&
    distanciaMetros(lugar, sitio) <= RADIO_DE_UN_SITIO_METROS
  );
}

function importanciaPara(lugar: LugarDeFuente, interes: string): number {
  if (lugar.proveedor === "foursquare") return INTERESES_DE_NEGOCIOS.has(interes) ? 0 : -1;
  return lugar.importancia ?? 0;
}

// Un lugar de OpenStreetMap (Geoapify) o de Foursquare (GUI-117).
export type LugarDeFuente = Lugar | LugarFoursquare;

export interface ResultadoCandidatos {
  candidatos: Candidato[];
  // Dónde se centra el viaje: el destino, o en un departamento o municipio, su lugar más importante.
  centro: Coordenada;
}

export interface Candidato extends LugarReal {
  interes: string;
  // Posición dentro de su interés: 0 es el lugar más representativo (ver buscarCandidatos).
  rango: number;
  lugar: LugarDeFuente;
  horarioEstimado: boolean;
}

function coincide(categoria: string, prefijo: string): boolean {
  return categoria === prefijo || categoria.startsWith(`${prefijo}.`);
}

export function horarioTipico(categorias: string[]): { apertura: string; cierre: string } {
  const regla = HORARIOS_TIPICOS.find(([prefijo]) => categorias.some((categoria) => coincide(categoria, prefijo)));
  return regla ? { apertura: regla[1], cierre: regla[2] } : HORARIO_TIPICO_PREDETERMINADO;
}

// La categoría que se muestra al modelo es la que hizo coincidir el lugar con el interés del viajero.
function categoriaDelInteres(lugar: LugarDeFuente, interes: string): string {
  const delInteres = CATEGORIAS_POR_INTERES[interes] ?? [];
  return lugar.categorias.find((categoria) => delInteres.some((prefijo) => coincide(categoria, prefijo))) ?? lugar.categorias[0];
}

function limitePorInteres(dias: number, intereses: number): number {
  const necesarios = Math.ceil((dias * PARADAS_OBJETIVO_POR_DIA * 1.5) / intereses);
  return Math.min(MAX_POR_INTERES, Math.max(MIN_POR_INTERES, necesarios));
}

const PALABRAS_SIN_PESO = new Set(["de", "del", "la", "las", "el", "los", "y", "en", "san", "santa"]);

// Palabras que identifican un lugar, sin tildes, mayúsculas ni artículos.
function palabrasDelNombre(nombre: string): string[] {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((palabra) => palabra && !PALABRAS_SIN_PESO.has(palabra));
}

// El mismo lugar aparece repetido: en OpenStreetMap (un punto y un edificio) y entre fuentes, con nombres más
// o menos completos («Parque Central Jalapa» y «Parque Central de Jalapa Doctor Silvano Antonio Carías»). Se
// tratan como uno si todas las palabras de un nombre están en el otro y están a menos de
// DISTANCIA_DUPLICADO_METROS, o de DISTANCIA_MISMO_NOMBRE_METROS si comparten dos palabras o más.
export function esElMismoLugar(a: LugarDeFuente, b: LugarDeFuente): boolean {
  if (a.idExterno === b.idExterno) return true;
  const distancia = distanciaMetros(a, b);
  const [corto, largo] = [palabrasDelNombre(a.nombre), palabrasDelNombre(b.nombre)].sort((x, y) => x.length - y.length);
  // El mismo nombre exacto en la misma zona (dos puntos de «Bejucal») es un solo lugar para el viajero.
  if (corto.length > 0 && corto.join(" ") === largo.join(" ") && distancia < DISTANCIA_MISMO_NOMBRE_EXACTO_METROS) return true;
  if (distancia >= DISTANCIA_MISMO_NOMBRE_METROS) return false;
  if (corto.length === 0 || !corto.every((palabra) => largo.includes(palabra))) return false;
  return distancia < DISTANCIA_DUPLICADO_METROS || corto.length >= 2;
}

// Una categoría que tarda demasiado (Geoapify a veces no responde a tiempo con las muy pobladas) se deja
// vacía en vez de tumbar todo el itinerario. Los demás errores (credenciales, límite) sí se propagan.
async function sinDemoras(busqueda: Promise<Lugar[]>): Promise<Lugar[]> {
  try {
    return await busqueda;
  } catch (error) {
    if (error instanceof ErrorApi && error.codigo === "PROVEEDOR_TIEMPO_AGOTADO") return [];
    throw error;
  }
}

// El propio destino no es una parada: Antigua Guatemala está en el mapa como patrimonio de la UNESCO.
function esElDestino(lugar: LugarDeFuente, destino: DestinoGeocodificado): boolean {
  const palabras = palabrasDelNombre(lugar.nombre);
  const delDestino = palabrasDelNombre(destino.nombre);
  return palabras.length > 0 && palabras.every((p) => delDestino.includes(p)) && distanciaMetros(lugar, destino) < DISTANCIA_MISMO_NOMBRE_METROS;
}

// Ejecuta las tareas con a lo más `simultaneas` a la vez y devuelve los resultados en el orden de entrada.
async function enParalelo<T, R>(elementos: T[], simultaneas: number, tarea: (elemento: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(elementos.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++;
      resultados[i] = await tarea(elementos[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(simultaneas, elementos.length) }, trabajador));
  return resultados;
}

// Toma uno de cada lista por turnos, para que ninguna acapare el resultado cuando se recorta.
function intercalar<T>(listas: T[][]): T[] {
  const salida: T[] = [];
  const largo = Math.max(0, ...listas.map((lista) => lista.length));
  for (let i = 0; i < largo; i++) {
    for (const lista of listas) {
      if (i < lista.length) {
        salida.push(lista[i]);
      }
    }
  }
  return salida;
}

export async function buscarCandidatos({
  destino,
  intereses,
  dias,
  transporte,
  buscarLugares,
  enriquecerHorarios,
  buscarEnFoursquare = null,
}: {
  destino: DestinoGeocodificado;
  intereses: string[];
  dias: number;
  transporte: Viaje["transporte"];
  buscarLugares: BuscarLugares;
  enriquecerHorarios: EnriquecerHorarios;
  buscarEnFoursquare?: BuscarEnFoursquare | null;
}): Promise<ResultadoCandidatos> {
  const limite = limitePorInteres(dias, intereses.length);
  const enArea = Boolean(destino.areaId);
  const aPie = transporte === "A pie";

  // Una consulta por categoría, no una por interés: Geoapify ordena por cercanía, y con todas las categorías
  // juntas las más abundantes cerca del centro (plazas como leisure.park) desplazan a las representativas
  // (natural, national_park). Las listas se intercalan en el orden de CATEGORIAS_POR_INTERES.
  const consultas = intereses.flatMap((interes) => {
    const categorias = CATEGORIAS_POR_INTERES[interes] ?? [];
    const porCategoria = Math.max(MIN_POR_CATEGORIA, Math.ceil(limite / categorias.length));
    return categorias.map((categoria) => ({ interes, categoria, porCategoria }));
  });
  const resultados = await enParalelo(consultas, CONSULTAS_SIMULTANEAS, async ({ interes, categoria, porCategoria }) => {
    const radios = radiosDeBusqueda(interes, transporte);
    const aPedir = enArea ? POR_CATEGORIA_EN_AREA : POR_CATEGORIA_EN_PUEBLO;
    const consulta = { lat: destino.lat, lng: destino.lng, categorias: [categoria], limite: aPedir, conImportancia: true };
    if (enArea) return sinDemoras(buscarLugares({ ...consulta, radio: radios.ampliado, area: destino.areaId }));
    const lugares = await sinDemoras(buscarLugares({ ...consulta, radio: radios.inicial }));
    return lugares.length >= porCategoria / 2 || radios.ampliado === radios.inicial
      ? lugares
      : sinDemoras(buscarLugares({ ...consulta, radio: radios.ampliado }));
  });
  // En un pueblo, los imperdibles de los alrededores (en un área ya entran en la búsqueda de sus categorías).
  const conImperdibles = enArea || aPie ? [] : intereses.filter((interes) => IMPERDIBLES_POR_INTERES[interes]);
  const imperdibles = await enParalelo(conImperdibles, CONSULTAS_SIMULTANEAS, (interes) =>
    sinDemoras(
      buscarLugares({
        lat: destino.lat,
        lng: destino.lng,
        categorias: IMPERDIBLES_POR_INTERES[interes],
        radio: RADIO_IMPERDIBLES_METROS,
        limite: MAX_IMPERDIBLES,
        conImportancia: true,
      }),
    ),
  );
  // GUI-117: Foursquare, una consulta por interés, como una lista más que se intercala con las de Geoapify.
  // OpenStreetMap va primero: sus lugares suelen traer horario publicado; los duplicados se descartan abajo.
  const deFoursquare: LugarDeFuente[][] = buscarEnFoursquare
    ? await enParalelo(intereses, CONSULTAS_SIMULTANEAS, (interes) =>
        buscarEnFoursquare({ lat: destino.lat, lng: destino.lng, radio: radiosDeBusqueda(interes, transporte).ampliado, limite, interes }),
      )
    : intereses.map(() => []);
  const apariciones = intercalar(intereses.map((interes, indice) =>
    intercalar<LugarDeFuente>([
      imperdibles[conImperdibles.indexOf(interes)] ?? [],
      ...resultados.filter((_, i) => consultas[i].interes === interes),
      deFoursquare[indice],
    ]).map((lugar) => ({ interes, lugar, importancia: importanciaPara(lugar, interes) })),
  ));

  // Un lugar que aparece en varias categorías, intereses o fuentes se queda una vez, en su aparición más
  // importante (el orden es estable: entre iguales manda el intercalado de arriba).
  const unicos: typeof apariciones = [];
  for (const aparicion of [...apariciones].sort((a, b) => b.importancia - a.importancia)) {
    if (
      encajaConElInteres(aparicion.lugar, aparicion.interes) &&
      !esElDestino(aparicion.lugar, destino) &&
      !unicos.some((u) => esElMismoLugar(u.lugar, aparicion.lugar))
    ) {
      unicos.push(aparicion);
    }
  }

  // En un área el viaje se centra en su lugar más importante (a igual importancia, el más cercano al centro
  // geográfico) y se deja fuera lo que queda demasiado lejos de él.
  const centro = enArea && unicos.length > 0 ? lugarCentral(unicos, destino) : { lat: destino.lat, lng: destino.lng };
  const distanciaMaxima = aPie ? DISTANCIA_MAXIMA_EN_AREA["A pie"] : DISTANCIA_MAXIMA_EN_AREA.vehiculo;
  const alAlcance = (enArea ? unicos.filter((u) => distanciaMetros(centro, u.lugar) <= distanciaMaxima) : unicos).filter(
    (u, _, todos) => !todos.some((sitio) => sitio.importancia > u.importancia && esParteDe(u.lugar, sitio.lugar)),
  );

  // Cada interés ordena sus lugares por importancia, descontando la distancia al centro; entre iguales se
  // conserva el intercalado de categorías.
  const porInteres = intereses.map((interes) =>
    alAlcance
      .filter((u) => u.interes === interes)
      .map((u, orden) => ({ ...u, orden, puntaje: u.importancia - distanciaMetros(centro, u.lugar) / 1000 / KM_POR_PUNTO }))
      .sort((a, b) => b.puntaje - a.puntaje || a.orden - b.orden)
      .slice(0, limite)
      .map(({ lugar, importancia }, rango) => ({ interes, rango, lugar, importancia })),
  );
  // Los lugares con importancia negativa (el templo del barrio, una cadena de comida, un registro dudoso de
  // Foursquare) solo entran si los demás no alcanzan para las paradas del viaje: con dos sitios históricos en
  // Izabal y suficiente naturaleza, el plan no se rellena con seis iglesias de colonia; en Puerto Barrios,
  // donde la naturaleza son los parques de la ciudad, sí se usan.
  const buenos = intercalar(porInteres.map((lista) => lista.filter((c) => c.importancia >= 0)));
  const menores = intercalar(porInteres.map((lista) => lista.filter((c) => c.importancia < 0)));
  const encontrados = [...buenos, ...menores.slice(0, Math.max(0, dias * PARADAS_OBJETIVO_POR_DIA - buenos.length))];

  // Cada candidato de Geoapify cuesta una consulta de horario (espaciadas 250 ms), así que se piden las que
  // el viaje necesita. Los de Foursquare no la necesitan: usan el horario típico de su tipo.
  const maxCandidatos = Math.min(MAX_CANDIDATOS, Math.max(MIN_CANDIDATOS, dias * PARADAS_OBJETIVO_POR_DIA * 2));
  const elegidos = encontrados.slice(0, maxCandidatos);
  const conHorario = await enriquecerHorarios(
    elegidos.flatMap(({ lugar }) => (lugar.proveedor === "geoapify" ? [lugar] : [])),
  );
  const horarios = new Map(conHorario.map((l) => [l.idExterno, l.horario]));

  const candidatos = elegidos.map(({ interes, rango, lugar }): Candidato => {
    const horario = horarios.get(lugar.idExterno);
    const base = {
      placeId: lugar.idExterno,
      nombre: lugar.nombre,
      lat: lugar.lat,
      lng: lugar.lng,
      categoria: categoriaDelInteres(lugar, interes),
      direccion: lugar.direccion,
      interes,
      rango,
      lugar,
      tipoEntorno: lugar.tipo_entorno,
    };
    if (horario?.estado === "disponible") {
      return { ...base, horario, horarioEstimado: false };
    }
    const { apertura, cierre } = horarioTipico(lugar.categorias);
    return { ...base, horaApertura: apertura, horaCierre: cierre, horarioEstimado: true };
  });
  return { candidatos, centro };
}

// El lugar más importante del área; a igual importancia, el más cercano a su centro geográfico.
function lugarCentral(lugares: { lugar: LugarDeFuente; importancia: number }[], destino: Coordenada): Coordenada {
  const [principal] = [...lugares].sort(
    (a, b) => b.importancia - a.importancia || distanciaMetros(destino, a.lugar) - distanciaMetros(destino, b.lugar),
  );
  return { lat: principal.lugar.lat, lng: principal.lugar.lng };
}
