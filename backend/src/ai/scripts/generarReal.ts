import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
import { crearClienteGeoapify } from "../../geoapify/cliente";
import { crearClienteDetalles } from "../../geoapify/detalles";
import { crearEnriquecedorHorarios } from "../../geoapify/enriquecer";
import { crearGeocodificador } from "../../geoapify/geocodificacion";
import { crearBuscadorFoursquare } from "../../foursquare/cliente";
import { crearGeneradorItinerario } from "../../itinerarios/generacion";

// Uso: npx tsx src/ai/scripts/generarReal.ts "Petén" Historia,Naturaleza 2026-11-10 2026-11-12
// Genera con el planificador sin IA (no gasta cuota de Gemini) y muestra los días.
async function main() {
  const [destino, intereses = "Historia", fechaInicio = "2026-11-10", fechaFin = "2026-11-12"] = process.argv.slice(2);
  const apiKey = process.env.GEOAPIFY_API_KEY;
  const generar = crearGeneradorItinerario({
    geocodificar: crearGeocodificador({ apiKey }),
    buscarLugares: crearClienteGeoapify({ apiKey, cache: null }),
    enriquecerHorarios: crearEnriquecedorHorarios({ consultarDetalles: crearClienteDetalles({ apiKey }) }),
    buscarEnFoursquare: crearBuscadorFoursquare({ apiKey: process.env.FOURSQUARE_API_KEY, cache: null }),
  });
  const plan = await generar({ destino, intereses: intereses.split(","), fechaInicio, fechaFin, tipoViaje: "solo", transporte: "Automovil" } as never);
  console.log(plan.destino.nombre, plan.destino.lat.toFixed(3), plan.destino.lng.toFixed(3), "|", plan.generadoCon);
  for (const dia of plan.itinerarios) console.log(`Día ${dia.numeroDia}:`, dia.paradas.map((p) => p.nombre).join(" → "));
  for (const a of plan.advertencias) console.log("  aviso:", a);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
