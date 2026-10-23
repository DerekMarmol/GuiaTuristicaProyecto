import type { Viaje } from "../../../shared/types";

// GUI-116: navegación guiada dentro de la app. La ruta por calles y sus indicaciones en español vienen de
// Mapbox Directions, con el mismo token público que ya carga el mapa (si el mapa funciona, la ruta también).
// Aquí se decide, con cada posición del GPS, cuál es la siguiente indicación, cuánto falta, si el usuario se
// salió de la ruta y si ya llegó.

const URL_DIRECCIONES = "https://api.mapbox.com/directions/v5/mapbox";

export type PerfilRuta = "driving-traffic" | "walking";
export type Punto = { lat: number; lng: number };

export interface PasoRuta {
  instruccion: string;
  tipo: string; // depart, turn, fork, roundabout, arrive…
  modificador: string | null; // left, slight right, uturn…
  calle: string | null;
  distanciaMetros: number; // del tramo que empieza en esta maniobra
}

export interface RutaNavegacion {
  coordenadas: [number, number][]; // [lng, lat], como las devuelve Mapbox
  distanciaMetros: number;
  duracionSegundos: number;
  pasos: PasoRuta[];
  // Distancia acumulada a lo largo de la ruta hasta cada coordenada y hasta cada maniobra.
  acumulada: number[];
  posicionPasos: number[];
}

export interface Progreso {
  indicePaso: number; // la siguiente maniobra
  distanciaAlPaso: number;
  distanciaRestante: number;
  segundosRestantes: number;
  distanciaALaRuta: number;
  fueraDeRuta: boolean;
  llego: boolean;
}

// Más allá de esto de la línea de la ruta, el usuario se salió (con un mínimo por el error del GPS).
const DESVIO_MINIMO_METROS = 40;
// Lo que el usuario puede alejarse de la ruta más allá de donde empezó (su casa puede estar lejos de la calle).
const MARGEN_SOBRE_DESVIO_INICIAL = 25;
const LLEGADA_METROS = 25;

export function perfilPorTransporte(transporte: Viaje["transporte"] | undefined): PerfilRuta {
  return transporte === "A pie" ? "walking" : "driving-traffic";
}

// Distancias cortas en metros proyectados sobre un plano local: suficiente para tramos de ciudad.
function aMetros(origen: Punto, punto: Punto): { x: number; y: number } {
  const metrosPorGrado = 111_320;
  return {
    x: (punto.lng - origen.lng) * metrosPorGrado * Math.cos((origen.lat * Math.PI) / 180),
    y: (punto.lat - origen.lat) * metrosPorGrado,
  };
}

function distancia(a: Punto, b: Punto): number {
  const { x, y } = aMetros(a, b);
  return Math.hypot(x, y);
}

const comoPunto = ([lng, lat]: [number, number]): Punto => ({ lat, lng });

// Punto de la ruta más cercano a `posicion`: a qué distancia está, cuánto se lleva recorrido hasta él, en
// qué tramo cae (`segmento`) y dónde (`punto`, [lng, lat]).
function proyectar(coordenadas: [number, number][], acumulada: number[], posicion: Punto) {
  let mejor = { distancia: Infinity, recorrido: 0, segmento: 0, punto: coordenadas[0] };
  for (let i = 0; i < coordenadas.length - 1; i++) {
    const a = comoPunto(coordenadas[i]);
    const b = aMetros(a, comoPunto(coordenadas[i + 1]));
    const p = aMetros(a, posicion);
    const largo2 = b.x * b.x + b.y * b.y;
    const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / largo2));
    const d = Math.hypot(p.x - t * b.x, p.y - t * b.y);
    if (d < mejor.distancia) {
      const [lngA, latA] = coordenadas[i];
      const [lngB, latB] = coordenadas[i + 1];
      mejor = {
        distancia: d,
        recorrido: acumulada[i] + t * (acumulada[i + 1] - acumulada[i]),
        segmento: i,
        punto: [lngA + t * (lngB - lngA), latA + t * (latB - latA)],
      };
    }
  }
  return mejor;
}

interface RespuestaMapbox {
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
    legs: { steps: { distance: number; name?: string; maneuver: { instruction: string; type: string; modifier?: string; location: [number, number] } }[] }[];
  }[];
  message?: string;
}

export function convertirRuta(respuesta: RespuestaMapbox): RutaNavegacion {
  const ruta = respuesta.routes?.[0];
  if (!ruta || ruta.geometry.coordinates.length < 2) {
    throw new Error("No encontramos una ruta por calles hasta esa parada.");
  }
  const coordenadas = ruta.geometry.coordinates;
  const acumulada = [0];
  for (let i = 1; i < coordenadas.length; i++) {
    acumulada.push(acumulada[i - 1] + distancia(comoPunto(coordenadas[i - 1]), comoPunto(coordenadas[i])));
  }
  const pasosMapbox = ruta.legs.flatMap((tramo) => tramo.steps);
  return {
    coordenadas,
    distanciaMetros: ruta.distance,
    duracionSegundos: ruta.duration,
    pasos: pasosMapbox.map((s) => ({
      instruccion: s.maneuver.instruction,
      tipo: s.maneuver.type,
      modificador: s.maneuver.modifier ?? null,
      calle: s.name?.trim() ? s.name : null,
      distanciaMetros: s.distance,
    })),
    acumulada,
    posicionPasos: pasosMapbox.map((s) => proyectar(coordenadas, acumulada, comoPunto(s.maneuver.location)).recorrido),
  };
}

export async function pedirRuta(origen: Punto, destino: Punto, perfil: PerfilRuta, token: string, signal?: AbortSignal): Promise<RutaNavegacion> {
  const puntos = `${origen.lng},${origen.lat};${destino.lng},${destino.lat}`;
  const parametros = new URLSearchParams({ steps: "true", geometries: "geojson", overview: "full", language: "es", access_token: token });
  let respuesta: Response;
  try {
    respuesta = await fetch(`${URL_DIRECCIONES}/${perfil}/${puntos}?${parametros}`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("No se pudo calcular la ruta: revisa tu conexión.");
  }
  const datos = (await respuesta.json().catch(() => null)) as RespuestaMapbox | null;
  if (!respuesta.ok || !datos) {
    throw new Error("No se pudo calcular la ruta hasta esa parada.");
  }
  return convertirRuta(datos);
}

// `desvioInicial`: distancia a la ruta desde donde se pidió. La ruta empieza en la calle más cercana, así
// que si el usuario salió de una casa a 80 m de la calle, estar a 80 m de la línea no es salirse de la ruta.
export function calcularProgreso(ruta: RutaNavegacion, posicion: Punto, precisionMetros: number | null, desvioInicial = 0): Progreso {
  const { distancia: distanciaALaRuta, recorrido } = proyectar(ruta.coordenadas, ruta.acumulada, posicion);
  const total = ruta.acumulada[ruta.acumulada.length - 1];
  const distanciaRestante = Math.max(0, total - recorrido);
  const fin = comoPunto(ruta.coordenadas[ruta.coordenadas.length - 1]);
  const llego = distancia(posicion, fin) <= LLEGADA_METROS || (distanciaRestante <= LLEGADA_METROS && distanciaALaRuta <= DESVIO_MINIMO_METROS);
  // La siguiente maniobra es la primera que queda por delante (la 0 es la salida).
  let indicePaso = ruta.pasos.length - 1;
  for (let i = 1; i < ruta.pasos.length; i++) {
    if (ruta.posicionPasos[i] > recorrido + 3) {
      indicePaso = i;
      break;
    }
  }
  const umbralDesvio = Math.max(DESVIO_MINIMO_METROS, (precisionMetros ?? 0) * 1.5, desvioInicial + MARGEN_SOBRE_DESVIO_INICIAL);
  return {
    indicePaso,
    distanciaAlPaso: Math.max(0, ruta.posicionPasos[indicePaso] - recorrido),
    distanciaRestante,
    segundosRestantes: total > 0 ? Math.round((ruta.duracionSegundos * distanciaRestante) / total) : 0,
    distanciaALaRuta,
    fueraDeRuta: !llego && distanciaALaRuta > umbralDesvio,
    llego,
  };
}

// Lo que queda de la ruta desde la posición del usuario: el tramo ya recorrido deja de dibujarse en el mapa.
export function tramoPendiente(ruta: RutaNavegacion, posicion: Punto | null): [number, number][] {
  if (!posicion) return ruta.coordenadas;
  const { segmento, punto } = proyectar(ruta.coordenadas, ruta.acumulada, posicion);
  const resto = ruta.coordenadas.slice(segmento + 1);
  return resto.length > 0 ? [punto, ...resto] : [punto, ruta.coordenadas[ruta.coordenadas.length - 1]];
}

export function formatearDistancia(metros: number): string {
  if (metros < 1000) return `${Math.max(10, Math.round(metros / 10) * 10)} m`;
  return `${(metros / 1000).toFixed(1)} km`;
}

export function formatearDuracion(segundos: number): string {
  const minutos = Math.max(1, Math.round(segundos / 60));
  return minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
}

// Ángulo de la flecha para cada tipo de giro (0 = seguir recto).
export function anguloManiobra(modificador: string | null): number {
  const angulos: Record<string, number> = {
    straight: 0, "slight right": 45, right: 90, "sharp right": 135, uturn: 180,
    "sharp left": -135, left: -90, "slight left": -45,
  };
  return modificador ? (angulos[modificador] ?? 0) : 0;
}
