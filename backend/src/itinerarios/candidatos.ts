import type { Viaje } from "../../../shared/types";
import type { LugarReal } from "../ai/tipos";
import { CATEGORIAS_POR_INTERES } from "../config/intereses";
import type { BuscarLugares } from "../geoapify/cliente";
import type { EnriquecerHorarios } from "../geoapify/enriquecer";
import type { DestinoGeocodificado } from "../geoapify/geocodificacion";
import type { Lugar } from "../geoapify/transformar";
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

// Radio de búsqueda en metros. Si un interés trae pocos lugares se vuelve a buscar con el radio ampliado
// (por ejemplo, playas o parques que quedan a las afueras del casco urbano).
const RADIO_A_PIE = { inicial: 3000, ampliado: 6000 };
const RADIO_CON_VEHICULO = { inicial: 15000, ampliado: 30000 };

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

export interface Candidato extends LugarReal {
  interes: string;
  // Posición dentro de su interés: 0 es el lugar más representativo (ver buscarCandidatos).
  rango: number;
  lugar: Lugar;
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
function categoriaDelInteres(lugar: Lugar, interes: string): string {
  const delInteres = CATEGORIAS_POR_INTERES[interes] ?? [];
  return lugar.categorias.find((categoria) => delInteres.some((prefijo) => coincide(categoria, prefijo))) ?? lugar.categorias[0];
}

function limitePorInteres(dias: number, intereses: number): number {
  const necesarios = Math.ceil((dias * PARADAS_OBJETIVO_POR_DIA * 1.5) / intereses);
  return Math.min(MAX_POR_INTERES, Math.max(MIN_POR_INTERES, necesarios));
}

function nombreNormalizado(nombre: string): string {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// OpenStreetMap suele tener el mismo lugar dos o más veces (un punto y un edificio, o capturas repetidas)
// con ids distintos: se tratan como uno si se llaman igual y están a menos de DISTANCIA_DUPLICADO_METROS.
function esElMismoLugar(a: Lugar, b: Lugar): boolean {
  return (
    a.idExterno === b.idExterno ||
    (nombreNormalizado(a.nombre) === nombreNormalizado(b.nombre) && distanciaMetros(a, b) < DISTANCIA_DUPLICADO_METROS)
  );
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
}: {
  destino: DestinoGeocodificado;
  intereses: string[];
  dias: number;
  transporte: Viaje["transporte"];
  buscarLugares: BuscarLugares;
  enriquecerHorarios: EnriquecerHorarios;
}): Promise<Candidato[]> {
  const radios = transporte === "A pie" ? RADIO_A_PIE : RADIO_CON_VEHICULO;
  const limite = limitePorInteres(dias, intereses.length);

  // Una consulta por categoría, no una por interés: Geoapify ordena por cercanía, y con todas las categorías
  // juntas las más abundantes cerca del centro (plazas como leisure.park) desplazan a las representativas
  // (natural, national_park). Las listas se intercalan en el orden de CATEGORIAS_POR_INTERES.
  const consultas = intereses.flatMap((interes) => {
    const categorias = CATEGORIAS_POR_INTERES[interes] ?? [];
    const porCategoria = Math.max(MIN_POR_CATEGORIA, Math.ceil(limite / categorias.length));
    return categorias.map((categoria) => ({ interes, categoria, porCategoria }));
  });
  const resultados = await enParalelo(consultas, CONSULTAS_SIMULTANEAS, async ({ categoria, porCategoria }) => {
    const consulta = { lat: destino.lat, lng: destino.lng, categorias: [categoria], limite: porCategoria };
    const lugares = await buscarLugares({ ...consulta, radio: radios.inicial });
    return lugares.length >= porCategoria / 2 ? lugares : buscarLugares({ ...consulta, radio: radios.ampliado });
  });
  const grupos = intereses.map((interes) =>
    intercalar(resultados.filter((_, i) => consultas[i].interes === interes)).map((lugar) => ({ interes, lugar })),
  );

  // Un lugar que aparece en varias categorías o intereses se queda en la primera aparición.
  const rangos = new Map<string, number>();
  const encontrados: { interes: string; rango: number; lugar: Lugar }[] = [];
  for (const { interes, lugar } of intercalar(grupos)) {
    const rango = rangos.get(interes) ?? 0;
    if (rango >= limite || encontrados.some((e) => esElMismoLugar(e.lugar, lugar))) {
      continue;
    }
    rangos.set(interes, rango + 1);
    encontrados.push({ interes, rango, lugar });
  }

  // Cada candidato cuesta una consulta de horario (espaciadas 250 ms), así que se piden las que el viaje necesita.
  const maxCandidatos = Math.min(MAX_CANDIDATOS, Math.max(MIN_CANDIDATOS, dias * PARADAS_OBJETIVO_POR_DIA * 2));
  const conHorario = await enriquecerHorarios(
    encontrados.slice(0, maxCandidatos).map(({ interes, rango, lugar }) => ({ ...lugar, interes, rango })),
  );

  return conHorario.map(({ horario, interes, rango, ...lugar }) => {
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
    };
    if (horario.estado === "disponible") {
      return { ...base, horario, horarioEstimado: false };
    }
    const { apertura, cierre } = horarioTipico(lugar.categorias);
    return { ...base, horaApertura: apertura, horaCierre: cierre, horarioEstimado: true };
  });
}
