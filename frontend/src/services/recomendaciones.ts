import type {
  Itinerario,
  RespuestaRecomendacionesHoteles,
  RespuestaRecomendacionesRestaurantes,
  Viaje,
} from "../../../shared/types";
import type { ViajeBorrador } from "../context/ViajeContext";
import type { HotelRecomendacion, RecomendacionesHoteles, RecomendacionesRestaurantes, RestauranteRecomendacion } from "../types/recomendacion";

const PRESUPUESTO_DIARIO_POR_DEFECTO = 500;
// El backend acepta hasta 25 paradas para ubicar el centro de los hoteles.
const MAX_PARADAS_HOTELES = 25;

// Personas por habitación (hoteles) y por mesa (restaurantes) según con quién viaja.
const PERSONAS_POR_TIPO: Record<Viaje["tipoViaje"], number> = { solo: 1, pareja: 2, familia: 4, amigos: 3 };

export function personasDelViaje(tipoViaje: ViajeBorrador["tipoViaje"]): number {
  return tipoViaje ? PERSONAS_POR_TIPO[tipoViaje] : 1;
}

function presupuestoDiario(viaje: ViajeBorrador): number {
  return viaje.presupuestoDiario && viaje.presupuestoDiario > 0 ? viaje.presupuestoDiario : PRESUPUESTO_DIARIO_POR_DEFECTO;
}

async function consultar<T>(ruta: string, cuerpo: unknown, signal: AbortSignal | undefined, errorPorDefecto: string): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("No se pudo conectar con el servidor. Inténtalo de nuevo en unos segundos.");
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error(datos?.error?.mensaje ?? errorPorDefecto);
  }
  return datos as T;
}

const aKm = (metros: number) => Math.round(metros / 100) / 10;

// El backend explica con términos técnicos por qué no hay hoteles; aquí se dice qué puede hacer el usuario.
function mensajeSinHoteles(respuesta: RespuestaRecomendacionesHoteles): string | null {
  switch (respuesta.motivo) {
    case null:
      return null;
    case "sin_hoteles_en_presupuesto":
      return `Ningún hotel cercano baja de Q ${respuesta.presupuestoHospedaje.toLocaleString("es-GT")} por noche. Puedes subir tu presupuesto diario en el paso 3.`;
    case "sin_hoteles_encontrados":
    case "sin_hoteles_con_precio":
    case "sin_hoteles_en_radio":
      return "No encontramos hoteles con precio publicado cerca de tu ruta.";
    default:
      return respuesta.mensaje;
  }
}

// Hoteles cerca del centro de todo el itinerario para la primera noche. El backend ya filtra por el
// 40 % del presupuesto diario, así que todo lo que devuelve entra en el presupuesto.
export async function buscarHoteles(
  viaje: ViajeBorrador,
  itinerarios: Itinerario[],
  signal?: AbortSignal
): Promise<RecomendacionesHoteles> {
  const respuesta = await consultar<RespuestaRecomendacionesHoteles>(
    "/api/hoteles/recomendaciones",
    {
      fecha: itinerarios[0]?.fecha ?? viaje.fechaInicio,
      destino: viaje.destino,
      paradas: itinerarios.flatMap((it) => it.paradas).slice(0, MAX_PARADAS_HOTELES).map(({ lat, lng }) => ({ lat, lng })),
      presupuestoDiario: presupuestoDiario(viaje),
      moneda: "GTQ",
      ocupacion: personasDelViaje(viaje.tipoViaje),
      hospedaje: viaje.hospedaje ?? false,
      sinHotel: viaje.sinHotel ?? false,
    },
    signal,
    "No se pudieron consultar los hoteles."
  );

  const hoteles: HotelRecomendacion[] = respuesta.hoteles.map((h) => ({
    id: h.idExterno,
    nombre: h.nombre,
    lat: h.lat,
    lng: h.lng,
    precio: Math.round(h.tarifa.importe),
    distanciaKm: aKm(h.distanciaLineaRectaMetros),
  }));
  return {
    hoteles: hoteles.sort((a, b) => a.distanciaKm - b.distanciaKm),
    presupuestoHospedaje: respuesta.presupuestoHospedaje,
    personas: respuesta.ocupacion,
    mensaje: mensajeSinHoteles(respuesta),
  };
}

// Restaurantes cerca de las paradas de un día. Un mismo restaurante puede quedar cerca de varias
// paradas: se muestra una vez, con la parada más cercana.
export async function buscarRestaurantes(
  viaje: ViajeBorrador,
  dia: Itinerario,
  signal?: AbortSignal
): Promise<RecomendacionesRestaurantes> {
  const respuesta = await consultar<RespuestaRecomendacionesRestaurantes>(
    "/api/restaurantes/recomendaciones",
    {
      fecha: dia.fecha,
      paradas: dia.paradas.map(({ id, lat, lng }) => ({ id, lat, lng })),
      presupuestoDiario: presupuestoDiario(viaje),
      moneda: "GTQ",
      comensales: personasDelViaje(viaje.tipoViaje),
    },
    signal,
    "No se pudieron consultar los restaurantes."
  );

  const nombreParada = new Map(dia.paradas.map((p) => [p.id, p.nombre]));
  const porId = new Map<string, RestauranteRecomendacion>();
  for (const parada of respuesta.paradas) {
    for (const r of parada.restaurantes) {
      const candidato: RestauranteRecomendacion = {
        id: r.idExterno,
        nombre: r.nombre,
        lat: r.lat,
        lng: r.lng,
        precioMinimo: r.tarifaReferencial.minimo,
        precioMaximo: r.tarifaReferencial.maximo,
        distanciaKm: aKm(r.distanciaLineaRectaMetros),
        cercaDe: nombreParada.get(parada.id) ?? null,
      };
      const actual = porId.get(r.idExterno);
      if (!actual || candidato.distanciaKm < actual.distanciaKm) {
        porId.set(r.idExterno, candidato);
      }
    }
  }

  const fallidas = respuesta.paradas.filter((p) => p.estado === "fallida").length;
  const sinResultados = respuesta.paradas.find((p) => p.mensaje)?.mensaje ?? null;
  return {
    restaurantes: [...porId.values()].sort((a, b) => a.distanciaKm - b.distanciaKm),
    presupuestoPorPersona: respuesta.presupuestoPorPersona,
    personas: respuesta.comensales,
    mensaje: respuesta.mensaje ?? (porId.size === 0 ? sinResultados : null),
    incompleto: fallidas > 0,
  };
}
