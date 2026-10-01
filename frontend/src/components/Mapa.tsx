import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Parada } from "../../../shared/types";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

interface MapaProps {
  paradas?: Parada[];
}

export function Mapa({ paradas = [] }: MapaProps) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<mapboxgl.Map | null>(null);
  const marcadoresRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!contenedorRef.current) return;

    const mapa = new mapboxgl.Map({
      container: contenedorRef.current,
      style: import.meta.env.VITE_MAPBOX_STYLE_URL,
      center: [-90.5069, 14.6349],
      zoom: 12,
    });
    mapaRef.current = mapa;

    return () => mapa.remove();
  }, []);

  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    marcadoresRef.current.forEach((m) => m.remove());
    marcadoresRef.current = [];

    if (paradas.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();

    paradas.forEach((parada) => {
      const popup = new mapboxgl.Popup({ offset: 24 }).setHTML(
        `<strong>${parada.nombre}</strong><br/>Abre ${parada.horaApertura} · Cierra ${parada.horaCierre}`
      );

      const marcador = new mapboxgl.Marker({ color: "#ff4fd8" })
        .setLngLat([parada.lng, parada.lat])
        .setPopup(popup)
        .addTo(mapa);

      marcadoresRef.current.push(marcador);
      bounds.extend([parada.lng, parada.lat]);
    });

    mapa.fitBounds(bounds, { padding: 60, maxZoom: 15 });
  }, [paradas]);

  return <div ref={contenedorRef} style={{ width: "100%", height: "500px" }} />;
}