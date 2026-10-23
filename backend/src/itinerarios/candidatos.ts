import type { Viaje } from "../../../shared/types";
import type { LugarReal } from "../ai/tipos";
import { CATEGORIAS_POR_INTERES } from "../config/intereses";
import type { BuscarLugares } from "../geoapify/cliente";
import type { EnriquecerHorarios } from "../geoapify/enriquecer";
import type { DestinoGeocodificado } from "../geoapify/geocodificacion";
import type { Lugar } from "../geoapify/transformar";
import type { BuscarEnFoursquare, LugarFoursquare } from "../foursquare/cliente";
import { distanciaMetros } from "../hoteles/geografia";

export const PARADAS_OBJETIVO_POR_DIA = 3;
export const MAX_CANDIDATOS = 40;
const MIN_CANDIDATOS = 15;
const MIN_POR_INTERES = 6;
const MAX_POR_INTERES = 15;
const MIN_POR_CATEGORIA = 3;
// El plan gratuito de Geoapify admite 5 solicitudes por segundo.
const CONSULTAS_SIMULTANEAS = 3;
const DISTANCIA_DUPLICADO_METROS = 200;

// Radio de búsqueda en metros. Los intereses de naturaleza amplían la búsqueda si traen pocos lugares
// (playas, parques o miradores a las afueras). Los urbanos (compras, comida, cultura…) se quedan en el
// pueblo: nadie va de compras al municipio vecino porque en el suyo hay pocas tiendas en el mapa.
const INTERESES_DE_NATURALEZA = new Set(["Naturaleza", "Playa", "Aventura", "Fotografía"]);
const RADIOS = {
  naturaleza: { "A pie": { inicial: 3000, ampliado: 6000 }, vehiculo: { inicial: 15000, ampliado: 30000 } },
  urbano: { "A pie": { inicial: 2000, ampliado: 2000 }, vehiculo: { inicial: 5000, ampliado: 5000 } },
};

export function radiosDeBusqueda(interes: string, transporte: Viaje["transporte"]): { inicial: number; ampliado: number } {
  const grupo = INTERESES_DE_NATURALEZA.has(interes) ? RADIOS.naturaleza : RADIOS.urbano;
  return transporte === "A pie" ? grupo["A pie"] : grupo.vehiculo;
}

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
  return interes !== "Compras" || !NOMBRES_QUE_NO_SON_COMPRAS.test(nombre);
}

// Un lugar de OpenStreetMap (Geoapify) o de Foursquare (GUI-117).
export type LugarDeFuente = Lugar | LugarFoursquare;

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
// tratan como uno si están a menos de DISTANCIA_DUPLICADO_METROS y todas las palabras de un nombre están en
// el otro.
function esElMismoLugar(a: LugarDeFuente, b: LugarDeFuente): boolean {
  if (a.idExterno === b.idExterno) return true;
  if (distanciaMetros(a, b) >= DISTANCIA_DUPLICADO_METROS) return false;
  const [corto, largo] = [palabrasDelNombre(a.nombre), palabrasDelNombre(b.nombre)].sort((x, y) => x.length - y.length);
  return corto.length > 0 && corto.every((palabra) => largo.includes(palabra));
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
}): Promise<Candidato[]> {
  const limite = limitePorInteres(dias, intereses.length);

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
    const consulta = { lat: destino.lat, lng: destino.lng, categorias: [categoria], limite: porCategoria };
    const lugares = await buscarLugares({ ...consulta, radio: radios.inicial });
    return lugares.length >= porCategoria / 2 || radios.ampliado === radios.inicial
      ? lugares
      : buscarLugares({ ...consulta, radio: radios.ampliado });
  });
  // GUI-117: Foursquare, una consulta por interés, como una lista más que se intercala con las de Geoapify.
  // OpenStreetMap va primero: sus lugares suelen traer horario publicado; los duplicados se descartan abajo.
  const deFoursquare: LugarDeFuente[][] = buscarEnFoursquare
    ? await enParalelo(intereses, CONSULTAS_SIMULTANEAS, (interes) =>
        buscarEnFoursquare({ lat: destino.lat, lng: destino.lng, radio: radiosDeBusqueda(interes, transporte).ampliado, limite, interes }),
      )
    : intereses.map(() => []);
  const grupos = intereses.map((interes, indice) =>
    intercalar<LugarDeFuente>([
      ...resultados.filter((_, i) => consultas[i].interes === interes),
      deFoursquare[indice],
    ]).map((lugar) => ({ interes, lugar })),
  );

  // Un lugar que aparece en varias categorías, intereses o fuentes se queda en la primera aparición.
  const rangos = new Map<string, number>();
  const encontrados: { interes: string; rango: number; lugar: LugarDeFuente }[] = [];
  for (const { interes, lugar } of intercalar(grupos)) {
    const rango = rangos.get(interes) ?? 0;
    if (rango >= limite || !encajaConElInteres(lugar, interes) || encontrados.some((e) => esElMismoLugar(e.lugar, lugar))) {
      continue;
    }
    rangos.set(interes, rango + 1);
    encontrados.push({ interes, rango, lugar });
  }

  // Cada candidato de Geoapify cuesta una consulta de horario (espaciadas 250 ms), así que se piden las que
  // el viaje necesita. Los de Foursquare no la necesitan: usan el horario típico de su tipo.
  const maxCandidatos = Math.min(MAX_CANDIDATOS, Math.max(MIN_CANDIDATOS, dias * PARADAS_OBJETIVO_POR_DIA * 2));
  const elegidos = encontrados.slice(0, maxCandidatos);
  const conHorario = await enriquecerHorarios(
    elegidos.flatMap(({ lugar }) => (lugar.proveedor === "geoapify" ? [lugar] : [])),
  );
  const horarios = new Map(conHorario.map((l) => [l.idExterno, l.horario]));

  return elegidos.map(({ interes, rango, lugar }) => {
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
}
