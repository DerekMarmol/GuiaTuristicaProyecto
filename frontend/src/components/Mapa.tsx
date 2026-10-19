import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Parada, PronosticoDiario } from "../../../shared/types";
import type { RespuestaEta } from "../services/eta";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOURCE_RUTA = "ruta-itinerario";
const LAYER_BORDE_RUTA = "ruta-itinerario-borde";
const LAYER_GRADIENTE_RUTA = "ruta-itinerario-gradiente";

interface MapaProps {
  paradas?: Parada[];
  paradasCompletadas?: string[];
  pronostico?: PronosticoDiario;
  eta?: RespuestaEta | null;
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

export function Mapa({ paradas = [], paradasCompletadas = [], pronostico, eta = null }: MapaProps) {
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

  useEffect(() => {
    if (!contenedorRef.current) return;

    const mapa = new mapboxgl.Map({
      container: contenedorRef.current,
      style: import.meta.env.VITE_MAPBOX_STYLE_URL,
      center: [-90.5069, 14.6349],
      zoom: 12,
    });
    mapaRef.current = mapa;

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

      if (actuales.length === 1) {
        mapa.easeTo({ center: [actuales[0].lng, actuales[0].lat], zoom: 14, duration: 500 });
      } else {
        mapa.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 500 });
      }
    };

    if (mapa.isStyleLoaded()) {
      actualizarMapa();
      return;
    }

    mapa.once("load", actualizarMapa);
    return () => { mapa.off("load", actualizarMapa); };
  }, [paradas, paradasCompletadas, pronostico, eta]);

  return <div ref={contenedorRef} className="mapa" />;
}
