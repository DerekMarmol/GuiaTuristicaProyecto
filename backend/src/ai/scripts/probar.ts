import "dotenv/config";
import { crearClienteGemini, generarItinerarios, type ClienteLLM } from "../index";
import { LUGARES_PRUEBA, VIAJE_PRUEBA } from "./lugaresPrueba";

function clienteSimulado(): ClienteLLM {
  let n = 0;
  return {
    async generarPlan() {
      n++;
      if (n === 1) return { dias: [{ numeroDia: 1, paradas: [{ placeId: "ChIJ_lugar_inventado", tiempoEstanciaMinutos: 60 }] }] };
      return {
        dias: [
          { numeroDia: 1, paradas: [{ placeId: "test_catedral", tiempoEstanciaMinutos: 45 }, { placeId: "test_palacio", tiempoEstanciaMinutos: 60 }] },
          { numeroDia: 2, paradas: [{ placeId: "test_popolvuh", tiempoEstanciaMinutos: 90 }, { placeId: "test_fonda", tiempoEstanciaMinutos: 60 }] },
        ],
      };
    },
  };
}

(async () => {
  const real = !!process.env.GEMINI_API_KEY;
  console.log(real ? "Usando Gemini real\n" : "Sin GEMINI_API_KEY: usando simulador\n");
  const res = await generarItinerarios({
    viaje: VIAJE_PRUEBA,
    candidatos: LUGARES_PRUEBA,
    cliente: real ? crearClienteGemini() : clienteSimulado(),
  });
  console.log(`Intentos: ${res.intentos}`);
  if (res.advertencias.length) console.log("Advertencias:", res.advertencias);
  for (const it of res.itinerarios) {
    console.log(`\nDía ${it.numeroDia} (${it.fecha})`);
    for (const p of it.paradas) console.log(`  - ${p.nombre} [${p.horaApertura}-${p.horaCierre}] ${p.tiempoEstanciaMinutos} min${p.motivo ? ` · ${p.motivo}` : ""}`);
  }
})().catch((e) => { console.error("ERROR:", e.message, e.detalles ?? ""); process.exit(1); });
