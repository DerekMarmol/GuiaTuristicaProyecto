import { useEffect, useMemo, useRef, useState } from "react";
import type { Viaje } from "../../../shared/types";
import {
  calcularProgreso,
  pedirRuta,
  perfilPorTransporte,
  tramoPendiente,
  type Progreso,
  type Punto,
  type RutaNavegacion,
} from "../services/navegacion";

// Un salto suelto del GPS no recalcula: hacen falta varias lecturas seguidas fuera de la ruta, y entre un
// recálculo y otro pasa un mínimo de tiempo (cada uno es una consulta a Mapbox).
const LECTURAS_FUERA_PARA_RECALCULAR = 2;
const ESPERA_ENTRE_RECALCULOS_MS = 8_000;
// A esta distancia de la línea el usuario ya está sobre la ruta: desde ahí deja de contar el margen de salida.
const SOBRE_LA_RUTA_METROS = 20;

export interface DestinoNavegacion extends Punto {
  id: string;
  nombre: string;
}

// GUI-116: navega desde la posición en vivo hasta `destino`. Con destino null no hace nada.
export function useNavegacion({
  destino,
  posicion,
  transporte,
}: {
  destino: DestinoNavegacion | null;
  posicion: (Punto & { precisionMetros: number | null }) | null;
  transporte: Viaje["transporte"] | undefined;
}) {
  const [ruta, setRuta] = useState<RutaNavegacion | null>(null);
  const [desvioInicial, setDesvioInicial] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [recalculos, setRecalculos] = useState(0);
  const lecturasFuera = useRef(0);
  const ultimoCalculo = useRef(0);
  const posicionRef = useRef(posicion);
  posicionRef.current = posicion;
  const hayPosicion = posicion !== null;
  const destinoAnterior = useRef<string | null>(null);

  // Se pide la ruta al elegir destino (en cuanto hay posición) y cada vez que hay que recalcularla.
  useEffect(() => {
    // Al recalcular hacia el mismo destino se deja la ruta anterior en pantalla hasta que llegue la nueva.
    const mismoDestino = destino !== null && destinoAnterior.current === destino.id;
    destinoAnterior.current = destino?.id ?? null;
    if (!mismoDestino) setRuta(null);
    setError(null);
    lecturasFuera.current = 0;
    const desde = posicionRef.current;
    if (!destino || !desde) return;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) {
      setError("Falta configurar el mapa para calcular rutas.");
      return;
    }
    const controlador = new AbortController();
    setCargando(true);
    ultimoCalculo.current = Date.now();
    pedirRuta(desde, destino, perfilPorTransporte(transporte), token, controlador.signal)
      .then((nueva) => {
        if (controlador.signal.aborted) return;
        setDesvioInicial(calcularProgreso(nueva, desde, null).distanciaALaRuta);
        setRuta(nueva);
      })
      .catch((err) => !controlador.signal.aborted && setError(err instanceof Error ? err.message : "No se pudo calcular la ruta."))
      .finally(() => !controlador.signal.aborted && setCargando(false));
    return () => controlador.abort();
  }, [destino?.id, destino?.lat, destino?.lng, hayPosicion, transporte, recalculos]);

  // El margen por haber salido lejos de la calle solo vale hasta que el usuario se sube a la ruta; si no,
  // tras salir de una casa a 80 m podría irse por una paralela sin que la app lo notara.
  useEffect(() => {
    if (!ruta || !posicion || desvioInicial === 0) return;
    if (calcularProgreso(ruta, posicion, null).distanciaALaRuta <= SOBRE_LA_RUTA_METROS) setDesvioInicial(0);
  }, [ruta, posicion, desvioInicial]);

  const progreso: Progreso | null = useMemo(
    () => (ruta && posicion ? calcularProgreso(ruta, posicion, posicion.precisionMetros, desvioInicial) : null),
    [ruta, posicion, desvioInicial]
  );

  useEffect(() => {
    if (!progreso) return;
    lecturasFuera.current = progreso.fueraDeRuta ? lecturasFuera.current + 1 : 0;
    if (
      lecturasFuera.current >= LECTURAS_FUERA_PARA_RECALCULAR &&
      Date.now() - ultimoCalculo.current >= ESPERA_ENTRE_RECALCULOS_MS
    ) {
      setRecalculos((n) => n + 1);
    }
  }, [progreso]);

  // Solo se dibuja lo que falta por recorrer.
  const pendiente = useMemo(() => (ruta ? tramoPendiente(ruta, posicion) : null), [ruta, posicion]);

  return { ruta, pendiente, progreso, error, cargando, recalculando: cargando && recalculos > 0 };
}
