import assert from "node:assert/strict";
import { validarSalida } from "./validator";
import { generarItinerarios, ErrorGeneracionIA } from "./generarItinerario";
import { LUGARES_PRUEBA as L, VIAJE_PRUEBA as V } from "./scripts/lugaresPrueba";

const buena = {
  dias: [
    { numeroDia: 1, paradas: [{ placeId: "test_catedral", tiempoEstanciaMinutos: 45 }, { placeId: "test_palacio", tiempoEstanciaMinutos: 60 }] },
    { numeroDia: 2, paradas: [{ placeId: "test_popolvuh", tiempoEstanciaMinutos: 90 }] },
  ],
};
let n = 0;
const t = (nombre: string, fn: () => void | Promise<void>) => (async () => fn())().then(() => console.log(`  ✓ ${nombre}`), (e) => { console.error(`  ✗ ${nombre}\n   `, e.message); process.exitCode = 1; }).finally(() => n++);

(async () => {
  console.log("Validador anti-alucinaciones");
  await t("acepta una respuesta correcta", () => {
    const r = validarSalida(buena, L, V);
    assert.equal(r.errores.length, 0);
    assert.equal(r.itinerarios.length, 2);
  });
  await t("rellena nombre/coords/horarios con datos REALES", () => {
    const r = validarSalida(buena, L, V);
    const p = r.itinerarios[0].paradas[0];
    assert.equal(p.nombre, "Catedral Metropolitana");
    assert.equal(p.lat, 14.6414);
    assert.equal(p.horaCierre, "18:00");
  });
  await t("ignora nombre/coords que la IA intente inyectar", () => {
    const raw = { dias: [{ numeroDia: 1, paradas: [{ placeId: "test_catedral", tiempoEstanciaMinutos: 30, nombre: "Lugar falso", lat: 0, lng: 0 }] }, buena.dias[1]] };
    const r = validarSalida(raw, L, V);
    assert.equal(r.itinerarios[0].paradas[0].nombre, "Catedral Metropolitana");
    assert.equal(r.itinerarios[0].paradas[0].lat, 14.6414);
  });
  await t("detecta un placeId inventado y lo descarta", () => {
    const raw = { dias: [{ numeroDia: 1, paradas: [{ placeId: "ChIJ_inventado", tiempoEstanciaMinutos: 60 }, { placeId: "test_catedral", tiempoEstanciaMinutos: 30 }] }, buena.dias[1]] };
    const r = validarSalida(raw, L, V);
    assert.ok(r.errores.some((e) => e.includes("ChIJ_inventado")));
    assert.equal(r.itinerarios[0].paradas.length, 1);
    assert.ok(r.viable);
  });
  await t("detecta lugares repetidos", () => {
    const raw = { dias: [{ numeroDia: 1, paradas: [{ placeId: "test_catedral", tiempoEstanciaMinutos: 30 }] }, { numeroDia: 2, paradas: [{ placeId: "test_catedral", tiempoEstanciaMinutos: 30 }] }] };
    const r = validarSalida(raw, L, V);
    assert.ok(r.errores.some((e) => e.includes("ya está en otro punto")));
    assert.equal(r.viable, false); // el día 2 se quedó vacío
  });
  await t("detecta estancia que no cabe en el horario", () => {
    const corto = { placeId: "test_corto", nombre: "Mirador corto", lat: 14.6, lng: -90.5, horaApertura: "10:00", horaCierre: "11:00", categoria: "Fotografía" };
    const raw = { dias: [{ numeroDia: 1, paradas: [{ placeId: "test_corto", tiempoEstanciaMinutos: 120 }] }, buena.dias[1]] };
    const r = validarSalida(raw, [...L, corto], V);
    assert.ok(r.errores.some((e) => e.includes("no cabe")));
  });
  await t("detecta días faltantes y días de más", () => {
    const r1 = validarSalida({ dias: [buena.dias[0]] }, L, V);
    assert.ok(r1.errores.some((e) => e.includes("Falta el día 2")));
    const r2 = validarSalida({ dias: [...buena.dias, { numeroDia: 3, paradas: [{ placeId: "test_cafe", tiempoEstanciaMinutos: 30 }] }] }, L, V);
    assert.ok(r2.errores.some((e) => e.includes("día 3 no existe")));
  });
  await t("rechaza formato inválido sin lanzar excepción", () => {
    assert.equal(validarSalida({ dias: "hola" }, L, V).viable, false);
    assert.equal(validarSalida(null, L, V).viable, false);
  });

  console.log("Orquestador");
  await t("reintenta con feedback y termina bien", async () => {
    const prompts: string[] = [];
    const malo = { dias: [{ numeroDia: 1, paradas: [{ placeId: "FALSO", tiempoEstanciaMinutos: 60 }] }] };
    const cliente = { async generarPlan({ prompt }: { prompt: string }) { prompts.push(prompt); return prompts.length === 1 ? malo : buena; } };
    const r = await generarItinerarios({ viaje: V, candidatos: L, cliente });
    assert.equal(r.intentos, 2);
    assert.ok(prompts[1].includes("FUE RECHAZADO") && prompts[1].includes("FALSO"));
  });
  await t("falla con ErrorGeneracionIA si nunca hay plan viable", async () => {
    const cliente = { async generarPlan() { return { dias: [{ numeroDia: 1, paradas: [{ placeId: "X", tiempoEstanciaMinutos: 60 }] }] }; } };
    await assert.rejects(generarItinerarios({ viaje: V, candidatos: L, cliente }), ErrorGeneracionIA);
  });
  await t("sobrevive a errores de red del modelo", async () => {
    let k = 0;
    const cliente = { async generarPlan() { if (k++ === 0) throw new Error("503"); return buena; } };
    assert.equal((await generarItinerarios({ viaje: V, candidatos: L, cliente })).intentos, 2);
  });
  await t("sin candidatos no llama al modelo", async () => {
    let llamado = false;
    const cliente = { async generarPlan() { llamado = true; return buena; } };
    await assert.rejects(generarItinerarios({ viaje: V, candidatos: [], cliente }), ErrorGeneracionIA);
    assert.equal(llamado, false);
  });
  console.log(process.exitCode ? "\nHay pruebas fallidas." : `\nTodas las pruebas pasaron (${n}).`);
})();
