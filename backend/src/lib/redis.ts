import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Instancia única del cliente de Redis
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    // Reintentos automáticos con retroceso exponencial (máx 2s)
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true, // Permite controlar el momento exacto de la conexión
});

// Eventos de monitoreo de conexión
redis.on("connect", () => {
  console.log("🟢 Conexión a Redis establecida con éxito.");
});

redis.on("error", (err) => {
  console.error("🔴 Error en el cliente de Redis:", err.message);
});

/**
 * Utilidades para interactuar con la caché de Redis
 */
export const cacheService = {
  /**
   * Guarda un valor en caché con tiempo de expiración opcional (en segundos).
   */
  async set<T>(clave: string, valor: T, ttlSegundos?: number): Promise<void> {
    const valorSerializado = JSON.stringify(valor);
    if (ttlSegundos && ttlSegundos > 0) {
      await redis.set(clave, valorSerializado, "EX", ttlSegundos);
    } else {
      await redis.set(clave, valorSerializado);
    }
  },

  /**
   * Obtiene un valor parseado desde la caché.
   */
  async get<T>(clave: string): Promise<T | null> {
    const data = await redis.get(clave);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  },

  /**
   * Elimina una clave o conjunto de claves de la caché.
   */
  async del(clave: string): Promise<void> {
    await redis.del(clave);
  },

  /**
   * Verifica la latencia y disponibilidad mediante un PING.
   */
  async ping(): Promise<boolean> {
    const respuesta = await redis.ping();
    return respuesta === "PONG";
  },
};