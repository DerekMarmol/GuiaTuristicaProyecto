import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export function Mapa() {
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contenedorRef.current) return;

    const mapa = new mapboxgl.Map({
      container: contenedorRef.current,
      style: import.meta.env.VITE_MAPBOX_STYLE_URL,
      center: [-90.5069, 14.6349],
      zoom: 12,
    });

    return () => mapa.remove();
  }, []);

  return <div ref={contenedorRef} style={{ width: "100%", height: "500px" }} />;
}