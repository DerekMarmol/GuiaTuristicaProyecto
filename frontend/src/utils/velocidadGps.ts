// GUI-108: velocidad a partir de lecturas del GPS cuando coords.speed no viene (muchos navegadores y
// teléfonos lo devuelven en null). Se calcula con la distancia y el tiempo entre la lectura actual y una
// anterior.
//
// GUI-119: el margen de error del GPS ya no se resta de la distancia (eso daba 12 km/h yendo a 20). Se usa
// para decidir si hubo movimiento: se busca, desde la lectura más reciente hacia atrás, la primera lectura
// que quedó a más del doble del margen de error. Con ella se mide la velocidad con la distancia completa.
// En carro alcanza con unos segundos (responde rápido); caminando se usa más tiempo, hasta VENTANA_MS. Si
// ninguna lectura de la ventana supera el margen, el «temblor» del GPS no cuenta como movimiento.

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
// Con menos tiempo entre dos lecturas, el error del GPS pesa más que el movimiento.
export const TIEMPO_MINIMO_MS = 3_000;
// En movimiento se mide sobre al menos este tiempo: más distancia diluye el ruido de cada posición, y
// sigue siendo poco para reflejar rápido una aceleración.
const TIEMPO_PREFERIDO_MS = 6_000;
// Lecturas peores que esto (ubicación por Wi-Fi o antenas) no sirven para medir movimiento.
export const PRECISION_MAXIMA_METROS = 50;
// Para contar como movimiento, la distancia debe superar este múltiplo del margen de error.
const VECES_EL_MARGEN = 2;
// Peso de la lectura nueva en el suavizado: más alto responde más rápido, más bajo salta menos.
const SUAVIZADO = 0.6;
// Si pasa más tiempo sin lecturas, lo anterior ya no describe el movimiento actual.
const PAUSA_MAXIMA_MS = 60_000;
const LECTURAS_PARA_PROMEDIO_GPS = 3;

function distanciaMetros(a: LecturaGps, b: LecturaGps): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const promedio = (valores: number[]) => valores.reduce((suma, v) => suma + v, 0) / valores.length;

// Velocidad en m/s entre la última lectura y una anterior que se separó de ella más que el margen de
// error (de preferencia con TIEMPO_PREFERIDO_MS de diferencia); 0 si ninguna lo hizo en la ventana; null si
// todavía no hay suficiente tiempo de lecturas.
function velocidadCalculada(lecturas: LecturaGps[]): number | null {
  const ultima = lecturas[lecturas.length - 1];
  if (!ultima || ultima.tiempoMs - lecturas[0].tiempoMs < TIEMPO_MINIMO_MS) {
    return null;
  }
  // Al empezar, mientras no hay TIEMPO_PREFERIDO_MS de lecturas, se acepta el mínimo.
  const minimo = ultima.tiempoMs - lecturas[0].tiempoMs >= TIEMPO_PREFERIDO_MS ? TIEMPO_PREFERIDO_MS : TIEMPO_MINIMO_MS;
  for (let i = lecturas.length - 2; i >= 0; i--) {
    const previa = lecturas[i];
    const milisegundos = ultima.tiempoMs - previa.tiempoMs;
    if (milisegundos < minimo) {
      continue;
    }
    const margen = Math.max(previa.precisionMetros ?? 0, ultima.precisionMetros ?? 0) * VECES_EL_MARGEN;
    const distancia = distanciaMetros(previa, ultima);
    if (distancia > margen) {
      return distancia / (milisegundos / 1000);
    }
  }
  return 0;
}

export function crearEstimadorVelocidad() {
  let lecturas: LecturaGps[] = [];
  let velocidadesGps: number[] = [];
  let suavizada: number | null = null;

  return {
    agregar(lectura: LecturaGps): VelocidadEstimada {
      const anterior = lecturas[lecturas.length - 1];
      if (anterior && lectura.tiempoMs - anterior.tiempoMs > PAUSA_MAXIMA_MS) {
        lecturas = [];
        velocidadesGps = [];
        suavizada = null;
      }

      // El propio GPS informa la velocidad: se usa, promediando solo las últimas lecturas para no atrasarse.
      if (lectura.velocidadMs !== null && Number.isFinite(lectura.velocidadMs) && lectura.velocidadMs >= 0) {
        velocidadesGps = [...velocidadesGps, lectura.velocidadMs].slice(-LECTURAS_PARA_PROMEDIO_GPS);
        return { velocidadKmh: promedio(velocidadesGps) * 3.6, fuente: "gps" };
      }

      const precisa = lectura.precisionMetros === null || lectura.precisionMetros <= PRECISION_MAXIMA_METROS;
      if (precisa) {
        lecturas = [...lecturas, lectura].filter((l) => lectura.tiempoMs - l.tiempoMs <= VENTANA_MS);
      }

      const actual = velocidadCalculada(lecturas);
      if (actual === null) {
        return { velocidadKmh: null, fuente: null };
      }
      // Detenido se refleja de inmediato; en movimiento se suaviza para que el número no salte.
      suavizada = actual === 0 || suavizada === null ? actual : SUAVIZADO * actual + (1 - SUAVIZADO) * suavizada;
      return { velocidadKmh: suavizada * 3.6, fuente: "calculada" };
    },

    reiniciar() {
      lecturas = [];
      velocidadesGps = [];
      suavizada = null;
    },
  };
}
