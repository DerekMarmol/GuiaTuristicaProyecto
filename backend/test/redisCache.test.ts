import { redis, cacheService } from "../src/lib/redis";

async function probarCapaCaching() {
  console.log("--- Probando Conexión y Capa de Caching con Redis (GUI-69) ---\n");

  try {
    // 1. Conectar explícitamente
    await redis.connect();

    // 2. Probar PING
    const responderPing = await cacheService.ping();
    console.log(`1. Prueba de PING -> Responde: ${responderPing ? "PONG (Éxito)" : "Fallo"}`);

    // 3. Probar SET y GET de datos estructurados
    const clavePrueba = "cache:test:viaje-demo";
    const valorPrueba = {
      destino: "Antigua Guatemala",
      lugaresVisitados: 5,
      actualizadoEn: new Date().toISOString(),
    };

    console.log("2. Guardando objeto en caché (TTL 60s)...");
    await cacheService.set(clavePrueba, valorPrueba, 60);

    const valorRecuperado = await cacheService.get<typeof valorPrueba>(clavePrueba);
    console.log("-> Objeto recuperado de Redis:", valorRecuperado);

    const esValido =
      valorRecuperado !== null &&
      valorRecuperado.destino === valorPrueba.destino &&
      valorRecuperado.lugaresVisitados === 5;

    // 4. Probar eliminación de clave
    await cacheService.del(clavePrueba);
    const valorPostEliminar = await cacheService.get(clavePrueba);
    console.log(`3. Clave eliminada -> Valor actual: ${valorPostEliminar} (esperado: null)`);

    if (responderPing && esValido && valorPostEliminar === null) {
      console.log("\n✅ Capa de caching con Redis configurada y funcionando correctamente.");
    } else {
      console.error("\n❌ Fallaron algunas operaciones con Redis.");
    }
  } catch (error) {
    console.error("❌ Error conectando a Redis:", error);
  } finally {
    await redis.quit();
  }
}

probarCapaCaching();