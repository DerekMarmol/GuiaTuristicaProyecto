import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { LugarAbiertoAhora, Parada, PronosticoDiario } from "../../../shared/types";
import type { RespuestaEta } from "../services/eta";
import { formatearDistancia, horaDelLugar } from "../services/abiertosAhora";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOURCE_RUTA = "ruta-itinerario";
const LAYER_BORDE_RUTA = "ruta-itinerario-borde";
const LAYER_GRADIENTE_RUTA = "ruta-itinerario-gradiente";
const SOURCE_PARTIDA = "tramo-partida";
const LAYER_PARTIDA = "tramo-partida-linea";

export interface ReferenciaMapa {
  lat: number;
  lng: number;
  etiqueta: string;
}

export interface CapaAbiertosAhora {
  lugares: LugarAbiertoAhora[];
  referencia: ReferenciaMapa | null;
  seleccionadoId: string | null;
  onSeleccionar: (idExterno: string) => void;
}

// GUI-107: desde dónde sale el usuario (su ubicación o un punto que marcó en el mapa).
export interface PartidaMapa {
  lat: number;
  lng: number;
  etiqueta: string;
}

interface MapaProps {
  paradas?: Parada[];
  paradasCompletadas?: string[];
  pronostico?: PronosticoDiario;
  eta?: RespuestaEta | null;
  abiertos?: CapaAbiertosAhora | null;
  partida?: PartidaMapa | null;
  // GUI-115: posición del usuario en tiempo real («Tú estás aquí»).
  posicionActual?: { lat: number; lng: number; precisionMetros: number | null } | null;
  // Mientras es true, tocar el mapa elige el punto de partida.
  eligiendoPartida?: boolean;
  onElegirPartida?: (punto: { lat: number; lng: number }) => void;
}

function crearIconoAbierto(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "marcador-svg");
  svg.setAttribute("viewBox", "0 0 36 44");
  svg.setAttribute("aria-hidden", "true");

  const pin = document.createElementNS(svg.namespaceURI, "path");
  pin.setAttribute("class", "marcador-abierto-pin");
  pin.setAttribute("d", "M18 1C8.6 1 1 8.5 1 17.7c0 12 17 25.2 17 25.2s17-13.2 17-25.2C35 8.5 27.4 1 18 1Z");

  const esfera = document.createElementNS(svg.namespaceURI, "circle");
  esfera.setAttribute("class", "marcador-svg-centro");
  esfera.setAttribute("cx", "18");
  esfera.setAttribute("cy", "18");
  esfera.setAttribute("r", "10");

  const agujas = document.createElementNS(svg.namespaceURI, "path");
  agujas.setAttribute("class", "marcador-abierto-agujas");
  agujas.setAttribute("d", "M18 12v6l4 2.5");

  svg.append(pin, esfera, agujas);
  return svg;
}

function crearPopupAbierto(lugar: LugarAbiertoAhora) {
  const contenido = document.createElement("section");
  contenido.className = "popup-parada";

  const titulo = document.createElement("h3");
  titulo.textContent = lugar.nombre;
  contenido.append(titulo);

  const cierre = horaDelLugar(lugar.cierreEstimado);
  const estado = document.createElement("p");
  estado.textContent = `Abierto ahora${cierre ? ` · cierra a las ${cierre}` : ""} · a ${formatearDistancia(lugar.distanciaMetros)}`;
  contenido.append(estado);

  if (lugar.direccion) {
    const direccion = document.createElement("p");
    direccion.textContent = lugar.direccion;
    contenido.append(direccion);
  }

  const nota = document.createElement("small");
  nota.textContent = "Según el horario publicado; no se agrega a tu itinerario.";
  contenido.append(nota);
  return contenido;
}

function encuadrar(mapa: mapboxgl.Map, puntos: { lat: number; lng: number }[]) {
  if (puntos.length === 0) return;
  if (puntos.length === 1) {
    mapa.easeTo({ center: [puntos[0].lng, puntos[0].lat], zoom: 14, duration: 500 });
    return;
  }
  const bounds = new mapboxgl.LngLatBounds();
  puntos.forEach(({ lat, lng }) => bounds.extend([lng, lat]));
  mapa.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 500 });
}

function crearIconoParada(numero: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "marcador-svg");
  svg.setAttribute("viewBox", "0 0 36 44");
  svg.setAttribute("aria-hidden", "true");

  const pin = document.createElementNS(svg.namespaceURI, "path");
  pin.setAttribute("class", "marcador-svg-pin");
  pin.setAttribute("d", "M18 1C8.6 1 1 8.5 1 17.7c0 12 17 25.2 17 25.2s17-13.2 17-25.2C35 8.5 27.4 1 18 1Z");

  const centro = document.createElementNS(svg.namespaceURI, "circle");
  centro.setAttribute("class", "marcador-svg-centro");
  centro.setAttribute("cx", "18");
  centro.setAttribute("cy", "18");
  centro.setAttribute("r", "11");

  const texto = document.createElementNS(svg.namespaceURI, "text");
  texto.setAttribute("class", "marcador-svg-numero");
  texto.setAttribute("x", "18");
  texto.setAttribute("y", "22");
  texto.setAttribute("text-anchor", "middle");
  texto.textContent = String(numero);

  svg.append(pin, centro, texto);
  return svg;
}

function textoClima(dia?: PronosticoDiario): string {
  if (!dia) return "Pronóstico no disponible";
  if (dia.estado === "fuera_de_cobertura") return "Fecha fuera de cobertura del pronóstico";
  if (dia.estado !== "disponible" && dia.estado !== "parcial") return "Pronóstico no disponible";
  const lluvia = dia.lluviaMm === 0 ? "sin lluvia" : `${dia.lluviaMm} mm de lluvia`;
  return `${Math.round(dia.temperaturaMinimaC)}–${Math.round(dia.temperaturaMaximaC)} °C · ${lluvia}${dia.estado === "parcial" ? " · datos parciales" : ""}`;
}

function crearPopupParada(parada: Parada, numero: number, diaClima: PronosticoDiario | undefined, eta: RespuestaEta | null) {
  const contenido = document.createElement("section");
  contenido.className = "popup-parada";

  const titulo = document.createElement("h3");
  titulo.textContent = `${numero}. ${parada.nombre}`;
  contenido.append(titulo);

  const horario = document.createElement("p");
  horario.textContent = `Horario: ${parada.horaApertura}–${parada.horaCierre}`;
  contenido.append(horario);

  const clima = document.createElement("p");
  clima.textContent = `Clima del día: ${textoClima(diaClima)}`;
  contenido.append(clima);

  const estadoTrafico = !eta
    ? "Sin datos de ETA; actualiza el cálculo de llegada"
    : eta.retrasoMinutos > 0
      ? `Retraso estimado: ${eta.retrasoMinutos} min`
      : "Sin retraso estimado";
  const trafico = document.createElement("p");
  trafico.textContent = `Tráfico / ETA: ${estadoTrafico}`;
  contenido.append(trafico);

  const llegada = eta?.proximasParadas.find((proxima) => proxima.paradaId === parada.id);
  if (llegada) {
    const horaLlegada = document.createElement("p");
    horaLlegada.textContent = `Llegada estimada: ${new Date(llegada.llegadaEstimada).toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" })}`;
    contenido.append(horaLlegada);
  }

  const nota = document.createElement("small");
  nota.textContent = "El estado de tráfico se estima mediante la ETA; no es una medición vial en vivo.";
  contenido.append(nota);
  return contenido;
}

function crearGeoJsonRuta(paradas: Parada[]) {
  if (paradas.length < 2) {
    return { type: "FeatureCollection" as const, features: [] };
  }

  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: paradas.map((parada) => [parada.lng, parada.lat] as [number, number]),
      },
    }],
  };
}

function progresoDeRuta(paradas: Parada[], completadas: Set<string>): number {
  if (paradas.length < 2) return 0;

  // Solo colorea como recorrido hecho el tramo que termina en la última parada
  // completada en secuencia; una parada marcada más adelante no salta el trayecto.
  let ultimaCompletada = -1;
  while (ultimaCompletada + 1 < paradas.length && completadas.has(paradas[ultimaCompletada + 1].id)) {
    ultimaCompletada += 1;
  }
  if (ultimaCompletada < 1) return 0;

  const distancias = paradas.slice(1).map((parada, indice) => {
    const anterior = paradas[indice];
    const lat1 = anterior.lat * Math.PI / 180;
    const lat2 = parada.lat * Math.PI / 180;
    const deltaLat = lat2 - lat1;
    const deltaLng = (parada.lng - anterior.lng) * Math.PI / 180;
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    const aLimitado = Math.min(1, Math.max(0, a));
    return 6371 * 2 * Math.atan2(Math.sqrt(aLimitado), Math.sqrt(1 - aLimitado));
  });
  const distanciaTotal = distancias.reduce((suma, distancia) => suma + distancia, 0);
  const distanciaHecha = distancias.slice(0, ultimaCompletada).reduce((suma, distancia) => suma + distancia, 0);
  return distanciaTotal > 0 ? distanciaHecha / distanciaTotal : 0;
}

function gradienteRuta(progreso: number) {
  const verde = "#43b581";
  if (progreso >= 0.999) {
    return ["interpolate", ["linear"], ["line-progress"], 0, verde, 1, verde];
  }

  const limite = Math.max(0.001, Math.min(0.94, progreso));
  return [
    "interpolate", ["linear"], ["line-progress"],
    0, verde,
    limite, verde,
    Math.min(1, limite + 0.05), "#f2a541",
    1, "#2786a8",
  ];
}

// Zoom al que se acerca el mapa al seguir al usuario (nivel de calle).
const ZOOM_SEGUIMIENTO = 16;

// Tramo punteado desde donde está (o sale) el usuario hasta la próxima parada pendiente.
function crearGeoJsonPartida(partida: { lat: number; lng: number } | null, primera: Parada | undefined) {
  if (!partida || !primera) {
    return { type: "FeatureCollection" as const, features: [] };
  }
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: [[partida.lng, partida.lat], [primera.lng, primera.lat]] as [number, number][],
      },
    }],
  };
}

export function Mapa({
  paradas = [],
  paradasCompletadas = [],
  pronostico,
  eta = null,
  abiertos = null,
  partida = null,
  posicionActual = null,
  eligiendoPartida = false,
  onElegirPartida,
}: MapaProps) {
  const [seguir, setSeguir] = useState(false);
  const marcadorVivoRef = useRef<mapboxgl.Marker | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<mapboxgl.Map | null>(null);
  const marcadoresRef = useRef<mapboxgl.Marker[]>([]);
  const paradasRef = useRef(paradas);
  const completadasRef = useRef(paradasCompletadas);
  const pronosticoRef = useRef(pronostico);
  const etaRef = useRef(eta);
  paradasRef.current = paradas;
  completadasRef.current = paradasCompletadas;
  pronosticoRef.current = pronostico;
  etaRef.current = eta;
  const partidaRef = useRef(partida);
  partidaRef.current = partida;
  const marcadorPartidaRef = useRef<mapboxgl.Marker | null>(null);
  const elegirPartidaRef = useRef(onElegirPartida);
  elegirPartidaRef.current = onElegirPartida;
  const marcadoresAbiertosRef = useRef(new Map<string, mapboxgl.Marker>());
  const marcadorReferenciaRef = useRef<mapboxgl.Marker | null>(null);
  const mostrabaAbiertosRef = useRef(false);
  const seleccionarRef = useRef(abiertos?.onSeleccionar);
  seleccionarRef.current = abiertos?.onSeleccionar;
  const lugaresAbiertos = abiertos?.lugares;
  const referenciaAbiertos = abiertos?.referencia ?? null;
  const seleccionadoId = abiertos?.seleccionadoId ?? null;

  useEffect(() => {
    if (!contenedorRef.current) return;

    const mapa = new mapboxgl.Map({
      container: contenedorRef.current,
      style: import.meta.env.VITE_MAPBOX_STYLE_URL,
      center: [-90.5069, 14.6349],
      zoom: 12,
    });
    mapaRef.current = mapa;
    // Si el usuario mueve el mapa con el dedo, deja de seguirlo (como en las apps de mapas).
    mapa.on("dragstart", () => setSeguir(false));

    return () => {
      marcadoresRef.current.forEach((marcador) => marcador.remove());
      marcadoresRef.current = [];
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    const actualizarMapa = () => {
      const actuales = paradasRef.current;
      const completadas = new Set(completadasRef.current);
      const climaActual = pronosticoRef.current;
      const etaActual = etaRef.current;
      const fuente = mapa.getSource(SOURCE_RUTA) as mapboxgl.GeoJSONSource | undefined;

      if (!fuente) {
        mapa.addSource(SOURCE_RUTA, {
          type: "geojson",
          lineMetrics: true,
          data: crearGeoJsonRuta(actuales),
        });

        const primeraCapaDeEtiquetas = mapa.getStyle().layers?.find((capa) => capa.type === "symbol")?.id;
        mapa.addLayer({
          id: LAYER_BORDE_RUTA,
          type: "line",
          source: SOURCE_RUTA,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#fff7e8", "line-width": 10, "line-opacity": 0.9 },
        }, primeraCapaDeEtiquetas);
        mapa.addLayer({
          id: LAYER_GRADIENTE_RUTA,
          type: "line",
          source: SOURCE_RUTA,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-width": 6,
            "line-opacity": 0.95,
            "line-gradient": gradienteRuta(progresoDeRuta(actuales, completadas)) as never,
          },
        }, primeraCapaDeEtiquetas);
      } else {
        fuente.setData(crearGeoJsonRuta(actuales));
        mapa.setPaintProperty(LAYER_GRADIENTE_RUTA, "line-gradient", gradienteRuta(progresoDeRuta(actuales, completadas)) as never);
      }

      marcadoresRef.current.forEach((marcador) => marcador.remove());
      marcadoresRef.current = [];
      if (actuales.length === 0) return;

      const bounds = new mapboxgl.LngLatBounds();
      const indiceActivo = actuales.findIndex((parada) => !completadas.has(parada.id));

      actuales.forEach((parada, index) => {
        const popup = new mapboxgl.Popup({ offset: 28 }).setDOMContent(
          crearPopupParada(parada, index + 1, climaActual, etaActual)
        );

        const elemento = document.createElement("div");
        elemento.className = `marcador-parada${index === indiceActivo ? " marcador-parada-activa" : ""}${completadas.has(parada.id) ? " marcador-parada-completada" : ""}`;
        elemento.append(crearIconoParada(index + 1));
        elemento.setAttribute("role", "button");
        elemento.tabIndex = 0;
        elemento.setAttribute("aria-label", `Parada ${index + 1}: ${parada.nombre}${completadas.has(parada.id) ? ", completada" : ""}`);

        const marcador = new mapboxgl.Marker({ element: elemento, anchor: "center" })
          .setLngLat([parada.lng, parada.lat])
          .setPopup(popup)
          .addTo(mapa);

        marcadoresRef.current.push(marcador);
        bounds.extend([parada.lng, parada.lat]);
      });

      encuadrar(mapa, partidaRef.current ? [...actuales, partidaRef.current] : actuales);
    };

    if (mapa.isStyleLoaded()) {
      actualizarMapa();
      return;
    }

    mapa.once("load", actualizarMapa);
    return () => { mapa.off("load", actualizarMapa); };
  }, [paradas, paradasCompletadas, pronostico, eta]);

  // GUI-107: marcador del punto de partida y tramo punteado hasta la primera parada.
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    const actualizarPartida = () => {
      marcadorPartidaRef.current?.remove();
      marcadorPartidaRef.current = null;
      if (!partida) return;

      const elemento = document.createElement("div");
      elemento.className = "marcador-partida";
      elemento.setAttribute("role", "img");
      elemento.setAttribute("aria-label", partida.etiqueta);
      marcadorPartidaRef.current = new mapboxgl.Marker({ element: elemento, anchor: "center" })
        .setLngLat([partida.lng, partida.lat])
        .setPopup(new mapboxgl.Popup({ offset: 14 }).setText(partida.etiqueta))
        .addTo(mapa);
      encuadrar(mapa, [...paradasRef.current, partida]);
    };

    if (mapa.isStyleLoaded()) {
      actualizarPartida();
      return;
    }
    mapa.once("load", actualizarPartida);
    return () => { mapa.off("load", actualizarPartida); };
  }, [partida?.lat, partida?.lng, partida?.etiqueta, paradas]);

  // GUI-115: marcador «Tú estás aquí» que se mueve con cada lectura del GPS, tramo punteado hasta la
  // próxima parada pendiente y, si el usuario lo pidió, el mapa centrado en él.
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    const actualizarEnVivo = () => {
      const completadas = new Set(completadasRef.current);
      const proxima = paradasRef.current.find((p) => !completadas.has(p.id));
      const datos = crearGeoJsonPartida(posicionActual ?? partida, proxima);
      const fuente = mapa.getSource(SOURCE_PARTIDA) as mapboxgl.GeoJSONSource | undefined;
      if (fuente) {
        fuente.setData(datos);
      } else {
        mapa.addSource(SOURCE_PARTIDA, { type: "geojson", data: datos });
        mapa.addLayer({
          id: LAYER_PARTIDA,
          type: "line",
          source: SOURCE_PARTIDA,
          layout: { "line-cap": "round" },
          paint: { "line-color": "#2786a8", "line-width": 3, "line-dasharray": [1.5, 1.5], "line-opacity": 0.9 },
        });
      }

      if (!posicionActual) {
        marcadorVivoRef.current?.remove();
        marcadorVivoRef.current = null;
        return;
      }
      if (!marcadorVivoRef.current) {
        const elemento = document.createElement("div");
        elemento.className = "marcador-vivo";
        elemento.setAttribute("role", "img");
        elemento.setAttribute("aria-label", "Tú estás aquí");
        marcadorVivoRef.current = new mapboxgl.Marker({ element: elemento, anchor: "center" })
          .setPopup(new mapboxgl.Popup({ offset: 14 }).setText("Tú estás aquí"))
          .setLngLat([posicionActual.lng, posicionActual.lat])
          .addTo(mapa);
      } else {
        marcadorVivoRef.current.setLngLat([posicionActual.lng, posicionActual.lat]);
      }
      if (seguir) {
        mapa.easeTo({
          center: [posicionActual.lng, posicionActual.lat],
          zoom: Math.max(mapa.getZoom(), ZOOM_SEGUIMIENTO),
          duration: 600,
        });
      }
    };

    if (mapa.isStyleLoaded()) {
      actualizarEnVivo();
      return;
    }
    mapa.once("load", actualizarEnVivo);
    return () => { mapa.off("load", actualizarEnVivo); };
  }, [posicionActual?.lat, posicionActual?.lng, partida?.lat, partida?.lng, paradas, paradasCompletadas, seguir]);

  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !eligiendoPartida) return;

    const alTocar = (evento: mapboxgl.MapMouseEvent) => elegirPartidaRef.current?.({ lat: evento.lngLat.lat, lng: evento.lngLat.lng });
    const lienzo = mapa.getCanvas();
    lienzo.style.cursor = "crosshair";
    mapa.on("click", alTocar);
    return () => {
      mapa.off("click", alTocar);
      lienzo.style.cursor = "";
    };
  }, [eligiendoPartida]);

  // Modo «Abierto ahora»: capa propia de marcadores; las paradas del itinerario no se tocan.
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    const actualizarAbiertos = () => {
      marcadoresAbiertosRef.current.forEach((marcador) => marcador.remove());
      marcadoresAbiertosRef.current.clear();
      marcadorReferenciaRef.current?.remove();
      marcadorReferenciaRef.current = null;

      const lugares = lugaresAbiertos ?? [];
      const puntos: { lat: number; lng: number }[] = [];

      if (referenciaAbiertos) {
        const elemento = document.createElement("div");
        elemento.className = "marcador-referencia";
        elemento.setAttribute("role", "img");
        elemento.setAttribute("aria-label", `Punto de búsqueda: ${referenciaAbiertos.etiqueta}`);
        marcadorReferenciaRef.current = new mapboxgl.Marker({ element: elemento, anchor: "center" })
          .setLngLat([referenciaAbiertos.lng, referenciaAbiertos.lat])
          .setPopup(new mapboxgl.Popup({ offset: 14 }).setText(`Búsqueda desde ${referenciaAbiertos.etiqueta}`))
          .addTo(mapa);
        puntos.push(referenciaAbiertos);
      }

      for (const lugar of lugares) {
        const elemento = document.createElement("div");
        elemento.className = "marcador-parada marcador-abierto";
        elemento.append(crearIconoAbierto());
        elemento.setAttribute("role", "button");
        elemento.tabIndex = 0;
        elemento.setAttribute("aria-label", `Abierto ahora: ${lugar.nombre}`);
        elemento.addEventListener("click", () => seleccionarRef.current?.(lugar.idExterno));
        elemento.addEventListener("keydown", (evento) => {
          if (evento.key !== "Enter" && evento.key !== " ") return;
          evento.preventDefault();
          seleccionarRef.current?.(lugar.idExterno);
        });

        const marcador = new mapboxgl.Marker({ element: elemento, anchor: "center" })
          .setLngLat([lugar.lng, lugar.lat])
          .setPopup(new mapboxgl.Popup({ offset: 28 }).setDOMContent(crearPopupAbierto(lugar)))
          .addTo(mapa);
        marcadoresAbiertosRef.current.set(lugar.idExterno, marcador);
        puntos.push(lugar);
      }

      if (puntos.length > 0) {
        mostrabaAbiertosRef.current = true;
        encuadrar(mapa, puntos);
      } else if (mostrabaAbiertosRef.current) {
        // Al desactivar el modo se vuelve a encuadrar el recorrido del día.
        mostrabaAbiertosRef.current = false;
        encuadrar(mapa, paradasRef.current);
      }
    };

    if (mapa.isStyleLoaded()) {
      actualizarAbiertos();
      return;
    }
    mapa.once("load", actualizarAbiertos);
    return () => { mapa.off("load", actualizarAbiertos); };
  }, [lugaresAbiertos, referenciaAbiertos]);

  useEffect(() => {
    const mapa = mapaRef.current;
    marcadoresAbiertosRef.current.forEach((marcador, idExterno) => {
      const seleccionado = idExterno === seleccionadoId;
      marcador.getElement().classList.toggle("marcador-abierto-seleccionado", seleccionado);
      const popup = marcador.getPopup();
      if (seleccionado && popup && !popup.isOpen()) marcador.togglePopup();
      if (!seleccionado && popup?.isOpen()) marcador.togglePopup();
    });
    const marcador = seleccionadoId ? marcadoresAbiertosRef.current.get(seleccionadoId) : undefined;
    if (mapa && marcador) mapa.easeTo({ center: marcador.getLngLat(), duration: 400 });
  }, [seleccionadoId, lugaresAbiertos]);

  return (
    <div className="mapa-contenedor">
      <div ref={contenedorRef} className="mapa" />
      <button
        type="button"
        className="mapa-seguir"
        aria-pressed={seguir}
        disabled={!posicionActual}
        onClick={() => setSeguir((actual) => !actual)}
        title={posicionActual ? undefined : "Esperando tu ubicación"}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        </svg>
        {seguir ? "Siguiéndote" : "Seguirme"}
      </button>
    </div>
  );
}
