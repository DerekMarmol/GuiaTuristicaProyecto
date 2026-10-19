export interface UbicacionActual {
  lat: number;
  lng: number;
  precisionMetros: number | null;
  obtenidaEn: string;
}

export type MotivoSinUbicacion =
  | "no_soportada"
  | "permiso_denegado"
  | "no_disponible"
  | "tiempo_agotado"
  | "coordenadas_invalidas"
  | "ubicacion_antigua";

const MENSAJES: Record<MotivoSinUbicacion, string> = {
  no_soportada: "Este navegador no permite obtener la ubicación actual.",
  permiso_denegado: "No diste permiso para usar tu ubicación. Puedes habilitarlo en la configuración del sitio de tu navegador.",
  no_disponible: "No se pudo determinar tu ubicación en este momento.",
  tiempo_agotado: "Obtener tu ubicación tardó demasiado.",
  coordenadas_invalidas: "El navegador devolvió una ubicación no válida.",
  ubicacion_antigua: "La ubicación disponible es demasiado antigua.",
};

export class ErrorUbicacion extends Error {
  motivo: MotivoSinUbicacion;

  constructor(motivo: MotivoSinUbicacion) {
    super(MENSAJES[motivo]);
    this.name = "ErrorUbicacion";
    this.motivo = motivo;
  }
}

export const TIEMPO_ESPERA_UBICACION_MS = 15_000;
// El navegador puede devolver una lectura guardada; no se aceptan las de más de 5 minutos.
export const ANTIGUEDAD_MAXIMA_UBICACION_MS = 5 * 60_000;

type Geolocalizacion = Pick<Geolocation, "getCurrentPosition">;

export interface OpcionesUbicacion {
  geolocalizacion?: Geolocalizacion | null;
  ahora?: () => number;
  tiempoEsperaMs?: number;
  antiguedadMaximaMs?: number;
}

function geolocalizacionDelNavegador(): Geolocalizacion | null {
  return typeof navigator !== "undefined" && "geolocation" in navigator ? navigator.geolocation : null;
}

// Pide la posición una vez; si el navegador devuelve una lectura guardada demasiado antigua, pide una nueva una sola vez más.
// El navegador muestra el permiso la primera vez que se llama.
export async function obtenerUbicacionActual(opciones: OpcionesUbicacion = {}): Promise<UbicacionActual> {
  try {
    return await leerPosicion(opciones, 60_000);
  } catch (error) {
    if (error instanceof ErrorUbicacion && error.motivo === "ubicacion_antigua") return leerPosicion(opciones, 0);
    throw error;
  }
}

function leerPosicion(
  {
    geolocalizacion = geolocalizacionDelNavegador(),
    ahora = Date.now,
    tiempoEsperaMs = TIEMPO_ESPERA_UBICACION_MS,
    antiguedadMaximaMs = ANTIGUEDAD_MAXIMA_UBICACION_MS,
  }: OpcionesUbicacion,
  maximumAge: number,
): Promise<UbicacionActual> {
  if (!geolocalizacion) {
    return Promise.reject(new ErrorUbicacion("no_soportada"));
  }

  return new Promise((resolve, reject) => {
    geolocalizacion.getCurrentPosition(
      ({ coords, timestamp }) => {
        const { latitude: lat, longitude: lng, accuracy } = coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          reject(new ErrorUbicacion("coordenadas_invalidas"));
          return;
        }
        if (!Number.isFinite(timestamp) || ahora() - timestamp > antiguedadMaximaMs) {
          reject(new ErrorUbicacion("ubicacion_antigua"));
          return;
        }
        resolve({
          lat,
          lng,
          precisionMetros: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
          obtenidaEn: new Date(timestamp).toISOString(),
        });
      },
      (error) => {
        // Códigos de GeolocationPositionError: 1 permiso denegado, 2 no disponible, 3 tiempo agotado.
        reject(new ErrorUbicacion(error.code === 1 ? "permiso_denegado" : error.code === 3 ? "tiempo_agotado" : "no_disponible"));
      },
      { enableHighAccuracy: false, maximumAge, timeout: tiempoEsperaMs },
    );
  });
}
