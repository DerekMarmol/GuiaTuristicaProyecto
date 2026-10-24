import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
import { crearClienteGeoapify } from "../../geoapify/cliente";
import { crearClienteDetalles } from "../../geoapify/detalles";
import { crearEnriquecedorHorarios } from "../../geoapify/enriquecer";
import { crearGeocodificador } from "../../geoapify/geocodificacion";
import { crearBuscadorFoursquare } from "../../foursquare/cliente";
import { buscarCandidatos } from "../../itinerarios/candidatos";

// Uso: npx tsx src/ai/scripts/candidatosReales.ts "Petén" Historia,Naturaleza [dias]
async function main() {
  const [destinoTexto, intereses = "Historia", dias = "3"] = process.argv.slice(2);
  const apiKey = process.env.GEOAPIFY_API_KEY;
  const buscarReal = crearClienteGeoapify({ apiKey, cache: null });
  const destino = await crearGeocodificador({ apiKey })(destinoTexto);
  if (!destino) throw new Error("Destino no encontrado");
  console.log("Destino:", destino);
  const { candidatos, centro } = await buscarCandidatos({
    destino,
    intereses: intereses.split(","),
    dias: Number(dias),
    transporte: "Automovil",
    buscarLugares: async (c) => { const t = Date.now(); try { return await buscarReal(c); } finally { if (process.env.TRAZA) console.log("  places", c.categorias.join(","), c.radio, c.limite, Date.now() - t, "ms"); } },
    enriquecerHorarios: crearEnriquecedorHorarios({ consultarDetalles: crearClienteDetalles({ apiKey }) }),
    buscarEnFoursquare: crearBuscadorFoursquare({ apiKey: process.env.FOURSQUARE_API_KEY, cache: null }),
  });
  console.log("Centro:", centro);
  for (const c of candidatos) {
    console.log(`${c.interes.padEnd(11)} ${String(c.rango).padStart(2)} ${c.lugar.proveedor.padEnd(10)} ${c.nombre} | ${c.categoria} | imp ${c.lugar.proveedor === "geoapify" ? c.lugar.importancia : "-"} | ${(Math.hypot(c.lat - centro.lat, (c.lng - centro.lng) * 0.96) * 111).toFixed(1)} km`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
