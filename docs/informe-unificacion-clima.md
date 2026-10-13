# Informe de cambios: unificación del clima en OpenWeather y mantenimiento del backend

Rama: `aolivac4/mantenimiento-backend` (basada en `main` después del PR #30).
Fecha: 12 de octubre de 2026.

## Resumen

El proyecto tenía dos endpoints de clima que hacían cosas parecidas con proveedores distintos:

| Endpoint | Proveedor | Granularidad | Quién lo usaba |
| --- | --- | --- | --- |
| `GET /api/clima` | Open-Meteo | Una hora concreta | El frontend (una petición por cada parada) |
| `GET /api/clima/pronostico` | OpenWeather | Resumen por día del viaje | Nadie |

El equipo había acordado usar OpenWeather, así que se eliminó `GET /api/clima` (Open-Meteo) y se conectó el frontend a `GET /api/clima/pronostico`. Ahora hay un solo endpoint de clima, un solo proveedor y una sola clave de API (`OPENWEATHER_API_KEY`).

## 1. Cambios en el backend

### Archivos eliminados

| Archivo | Motivo |
| --- | --- |
| `src/routes/clima.js` | Ruta `GET /api/clima` de Open-Meteo, reemplazada por `/api/clima/pronostico`. |
| `src/clima/climaService.js` | Cliente de Open-Meteo con caché en memoria. Solo lo usaban la ruta anterior y `prepararParadasClima.js`. |
| `src/clima/prepararParadasClima.js` | Agregaba `probabilidad_lluvia` a las paradas con Open-Meteo. Ningún archivo lo importaba, y además tenía un error: importaba el módulo completo y lo llamaba como función, así que siempre fallaba sin avisar. |

Se conservan `src/clima/servicio.js` y `src/clima/fechas.js`, que usa el endpoint de OpenWeather.

### Archivos modificados

- **`src/app.js`:** se quitó el registro de la ruta `/api/clima`. Una petición a esa ruta ahora devuelve `404 RUTA_NO_ENCONTRADA`, con el formato de error común de la API.
- **`test/clima.test.js`:** la prueba que comprobaba que `/api/clima` seguía existiendo se reemplazó por una que comprueba que ya no existe y que no llama al proveedor.
- **`README.md` (raíz) y `backend/README.md`:** se quitó la documentación de `/api/clima`, y se indica que `/api/clima/pronostico` es el único endpoint de clima y el que consume el frontend.

## 2. Cambios en el frontend

### `src/services/clima.ts` (reescrito)

- `consultarPronostico({ lat, lng, fechaInicio, fechaFin })` llama a `/api/clima/pronostico` y devuelve la respuesta tipada con `RespuestaClima` de `shared/types/clima.ts`, el contrato que ya existía para OpenWeather. Si el backend responde con error (por ejemplo `503` porque falta la clave) o la red falla, devuelve `null` y la interfaz muestra "Pronóstico no disponible".
- Las coordenadas se envían con 6 decimales (`toFixed(6)`), porque el backend rechaza la notación exponencial (por ejemplo `1e-7`).
- `coordenadasDelViaje(viaje, itinerarios)` decide qué ubicación consultar. Usa las coordenadas del destino si existen; como el paso 1 todavía no geocodifica el destino, normalmente usa el centro de las paradas del itinerario.
- `hayLluviaSignificativa(dia)` marca un día como lluvioso si la lluvia acumulada es de **10 mm o más** (`UMBRAL_LLUVIA_MM`). OpenWeather (plan gratuito, pronóstico de 5 días cada 3 horas) entrega milímetros de lluvia, no la probabilidad de lluvia que daba Open-Meteo, así que la advertencia ahora se basa en la cantidad. 10 mm diarios suele considerarse lluvia moderada; el valor está en una sola constante para ajustarlo si el equipo lo decide.

### `src/components/IndicadorClima.tsx` (reescrito)

Antes recibía coordenadas, fecha y hora, y hacía su propia petición. Ahora solo recibe el estado de la consulta y el resumen del día, y muestra:

- Temperatura mínima y máxima, promedio y lluvia esperada en mm.
- Una nota si el resumen es parcial (el día tiene menos de 8 intervalos de 3 horas).
- Un aviso si la fecha está fuera de cobertura: OpenWeather solo pronostica unos 5 días hacia adelante.
- La advertencia de lluvia, que sugiere priorizar lugares bajo techo cuando se supera el umbral.

Reutiliza las clases CSS existentes (`indicador-clima`, `clima-normal`, `clima-alerta`, `clima-advertencia`, `sin-datos`), así que no hubo cambios de estilos.

### `src/pages/Paso4Generacion.tsx`

- Cuando el itinerario está listo, se hace **una sola** consulta al pronóstico para todo el rango, desde la fecha del primer día hasta la del último. La consulta se cancela si el itinerario cambia o se regenera.
- El indicador se muestra **una vez por día**, debajo del selector de días, en lugar de una vez por parada.

Por qué cambia de "por parada" a "por día":

1. OpenWeather entrega un resumen diario. Repetir el mismo dato en cada parada sería redundante y confuso.
2. Antes se hacía una petición por parada. Con 5 paradas al día y un viaje de 4 días eran 20 peticiones; ahora es una por viaje, lo que también cuida la cuota gratuita de OpenWeather.

### `vite.config.ts`

El proxy de desarrollo pasó de `/api/clima` a `/api`. Así cubre `/api/clima/pronostico` y cualquier endpoint futuro (por ejemplo `/api/lugares`) sin tener que volver a tocar la configuración.

## 3. Verificación

| Prueba | Resultado |
| --- | --- |
| `npm test` en `backend` | 216 pruebas, 0 fallos |
| `npm run ai:test` en `backend` | 12 + 7 pruebas, 0 fallos |
| `npm run build` en `frontend` (TypeScript estricto y Vite) | Correcta |
| Prueba de punta a punta (backend y Vite levantados, clave real de OpenWeather, petición a través del proxy de Vite) | Llegaron los resúmenes diarios de 5 días; las fechas fuera del pronóstico se marcaron `fuera_de_cobertura` y `/api/clima` respondió `404` |

## 4. Mantenimiento previo incluido en la misma rama

Estos cambios se hicieron antes de la unificación del clima y van en el mismo PR:

- **Prisma:** se restauró `output = "../generated/prisma"` en el generador. Sin esa línea, `npx prisma generate` y `npx prisma migrate dev` fallaban.
- **Migraciones:** se restauró la migración inicial y la tabla `Usuario` pasó a una migración nueva, `20261013045400_agregar_usuario`. Editar una migración ya publicada hace que Prisma detecte el cambio y pida reiniciar la base de datos.
- **Script `ai:test`:** ahora también ejecuta las pruebas de validación de estancias.
- **README raíz:** se limpiaron restos de un conflicto de merge mal resuelto.
- **`backendGUIATURISTICA.zip`:** se eliminó; era una copia obsoleta de la configuración de Prisma.

## 5. Pendientes y recomendaciones

- **Geocodificación del destino:** el paso 1 no guarda la latitud y longitud del destino. El clima usa el centro de las paradas, que hoy son datos de ejemplo alrededor de la Ciudad de Guatemala. Cuando el itinerario use lugares reales o se geocodifique el destino, el pronóstico corresponderá al destino real sin cambiar el código del clima.
- **Optimizador (`optimizer/`):** acepta `probabilidad_lluvia` por parada para reordenar la ruta, pero ningún componente le envía ese dato (antes solo lo preparaba `prepararParadasClima.js`, que no se usaba). Si se quiere reordenar por clima con OpenWeather, se puede leer el campo `pop` (probabilidad de precipitación) de cada intervalo de 3 horas y agregarlo al resumen diario de `/api/clima/pronostico`.
- **Bases de datos locales:** quien haya aplicado la migración inicial modificada debe ejecutar `npx prisma migrate reset` una vez (borra los datos locales).
