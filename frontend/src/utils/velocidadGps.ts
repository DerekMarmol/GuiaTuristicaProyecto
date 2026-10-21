// GUI-108: velocidad a partir de lecturas del GPS cuando coords.speed no viene (muchos navegadores y
// teléfonos lo devuelven en null). Se calcula con la distancia y el tiempo entre lecturas de una ventana
// corta, descontando el margen de error de cada lectura para que el «temblor» del GPS estando quieto no
// cuente como movimiento.

export interface LecturaGps {
  lat: number;
  lng: number;
  precisionMetros: number | null;
  tiempoMs: number;
  velocidadMs: number | null; // coords.speed, en m/s
}

export interface VelocidadEstimada {
  velocidadKmh: number | null;
  fuente: "gps" | "calculada" | null;
}

export const VENTANA_MS = 20_000;
// Con menos tiempo entre la primera y la última lectura, el error del GPS pesa más que el movimiento.
export const TIEMPO_MINIMO_MS = 4_000;
// Lecturas peores que esto (ubicación por Wi-Fi o antenas) no sirven para medir movimiento.
export const PRECISION_MAXIMA_METROS = 50;
// Si pasa más tiempo sin lecturas, lo anterior ya no describe el movimiento actual.
const PAUSA_MAXIMA_MS = 60_000;
const LECTURAS_PARA_PROMEDIO = 5;

function distanciaMetros(a: LecturaGps, b: LecturaGps): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const promedio = (valores: number[]) => valores.reduce((suma, v) => suma + v, 0) / valores.length;

export function crearEstimadorVelocidad() {
  let lecturas: LecturaGps[] = [];
  let velocidadesGps: number[] = [];

  return {
    agregar(lectura: LecturaGps): VelocidadEstimada {
      const anterior = lecturas[lecturas.length - 1];
      if (anterior && lectura.tiempoMs - anterior.tiempoMs > PAUSA_MAXIMA_MS) {
        lecturas = [];
        velocidadesGps = [];
      }

      // El propio GPS informa la velocidad: se usa, promediando las últimas lecturas.
      if (lectura.velocidadMs !== null && Number.isFinite(lectura.velocidadMs) && lectura.velocidadMs >= 0) {
        velocidadesGps = [...velocidadesGps, lectura.velocidadMs].slice(-LECTURAS_PARA_PROMEDIO);
        return { velocidadKmh: promedio(velocidadesGps) * 3.6, fuente: "gps" };
      }

      const precisa = lectura.precisionMetros === null || lectura.precisionMetros <= PRECISION_MAXIMA_METROS;
      if (precisa) {
        lecturas = [...lecturas, lectura].filter((l) => lectura.tiempoMs - l.tiempoMs <= VENTANA_MS);
      }

      const primera = lecturas[0];
      const ultima = lecturas[lecturas.length - 1];
      if (!primera || !ultima || ultima.tiempoMs - primera.tiempoMs < TIEMPO_MINIMO_MS) {
        return { velocidadKmh: null, fuente: null };
      }

      const ruido = ((primera.precisionMetros ?? 0) + (ultima.precisionMetros ?? 0)) / 2;
      const recorrido = Math.max(0, distanciaMetros(primera, ultima) - ruido);
      const segundos = (ultima.tiempoMs - primera.tiempoMs) / 1000;
      return { velocidadKmh: (recorrido / segundos) * 3.6, fuente: "calculada" };
    },

    reiniciar() {
      lecturas = [];
      velocidadesGps = [];
    },
  };
}
