# Backend

API HTTP con Node.js, Fastify y TypeScript (CommonJS). Expone la consulta de lugares de interés mediante [Geoapify Places API](https://apidocs.geoapify.com/docs/places/), enriquecida con los horarios publicados que devuelve [Geoapify Place Details API](https://apidocs.geoapify.com/docs/place-details/), la validación de una propuesta de itinerario contra esos horarios (`POST /api/itinerarios/validar`), el pronóstico del clima para las fechas de un viaje mediante [OpenWeather 5 Day / 3 Hour Forecast](https://openweathermap.org/forecast5) y la priorización de las paradas según la lluvia pronosticada (`POST /api/itinerarios/priorizar-clima`) y las recomendaciones de hoteles cercanos al itinerario de un día con precios referenciales de [SerpApi Google Hotels](https://serpapi.com/google-hotels-api) convertidos a quetzales con [ExchangeRate-API](https://www.exchangerate-api.com/docs/standard-requests) dentro del presupuesto de hospedaje (`POST /api/hoteles/recomendaciones`) y las recomendaciones de restaurantes cercanos a cada parada del día, filtradas con tarifas referenciales en quetzales contra el presupuesto de alimentación (`POST /api/restaurantes/recomendaciones`). La configuración de Prisma se mantiene sin cambios.

## Requisitos

- Node.js 20 o superior (se usan `fetch`, `AbortController` y `node --test` nativos).
- Una clave de Geoapify, que se obtiene en [myprojects.geoapify.com](https://myprojects.geoapify.com/).
- Una clave de OpenWeather para `GET /api/clima/pronostico` (opcional para iniciar el servidor). Consulta [Clave de OpenWeather](#clave-de-openweather).
- Claves de SerpApi y ExchangeRate-API para `POST /api/hoteles/recomendaciones` (opcionales para iniciar el servidor). Consulta [Claves de SerpApi y ExchangeRate-API](#claves-de-serpapi-y-exchangerate-api).

## Instalación y configuración

```powershell
cd backend
npm install
Copy-Item .env.example .env   # solo si todavía no existe backend/.env
```

Edita `backend/.env` y asigna tu clave:

| Variable | Uso |
| --- | --- |
| `GEOAPIFY_API_KEY` | Clave de Geoapify. Obligatoria para iniciar el servidor. |
| `OPENWEATHER_API_KEY` | Clave de OpenWeather. Si falta, el servidor inicia, muestra un aviso y `GET /api/clima/pronostico` responde `503`; `POST /api/itinerarios/priorizar-clima` responde `200` con el orden original e informa la consulta fallida. El resto de las rutas funciona igual. |
| `SERPAPI_API_KEY` | Clave de SerpApi (Google Hotels). Si falta, el servidor inicia, muestra un aviso y `POST /api/hoteles/recomendaciones` responde `503` cuando necesita consultar hoteles. El resto de las rutas funciona igual. |
| `EXCHANGERATE_API_KEY` | Clave de ExchangeRate-API (plan gratuito). Mismo comportamiento que `SERPAPI_API_KEY` si falta. |
| `PORT` | Puerto HTTP del backend. Valor por defecto: `3000`. |
| `OPTIMIZER_URL` | URL base del optimizador FastAPI. Por defecto `http://localhost:8000`; el backend llama a `/reoptimize` y a `/reoptimize-clima`. |
| `CLIMA_REACTIVO_SECRETO` | Opcional. Clave para firmar las propuestas del [reordenamiento reactivo por clima](#reordenamiento-reactivo-por-clima-gui-72). Si falta, se genera una aleatoria por proceso: las propuestas pendientes dejan de valer al reiniciar el servidor. Defínela si hay varias instancias. |
| `CLIMA_REACTIVO_*` | Opcionales. Umbrales e intervalos del monitoreo del clima; consulta [Configuración](#configuración-del-monitoreo). |
| `HOST` | Dirección en la que escucha el servidor. Valor por defecto: `::` (todas las interfaces, IPv6 e IPv4). Usa `127.0.0.1` para aceptar solo conexiones locales. |
| `DATABASE_URL` | Conexión de Prisma a PostgreSQL (no se usa en los endpoints de lugares ni de clima). |

El servidor carga `backend/.env` sin sobrescribir variables que ya estén definidas en el entorno. El archivo `.env` está excluido de Git; solo se versiona `.env.example`. Las claves se usan únicamente en el servidor: no deben definirse como variables `VITE_` ni enviarse al frontend.

### Reoptimización de una ruta en curso

`POST /api/itinerarios/reoptimizar` recibe `tipo` (`clima`, `retraso` o `parada_cancelada`), las paradas pendientes del día, `horaActualMinutos` (minutos desde medianoche), opcionalmente `modoTransporte` (`auto` o `pedestrian`; `auto` si se omite), opcionalmente `origen` (`{ lat, lng }` del punto desde el que se reanuda el recorrido; si se omite, la primera parada pendiente es el punto de partida, como antes) y, para cancelaciones, `paradaCanceladaId`. El backend elimina la parada cancelada, convierte los campos al contrato del optimizador (`modo_transporte`) y llama `POST {OPTIMIZER_URL}/reoptimize`. El optimizador calcula los traslados con [Valhalla](../docs/valhalla.md). La respuesta devuelve el nuevo orden y las paradas reordenadas.

El paso 4 del frontend envía `pedestrian` cuando el viaje se planificó «A pie» y `auto` para los demás medios del selector.

| Estado | Código | Cuándo |
| --- | --- | --- |
| `400` | `PARAMETRO_INVALIDO` | Datos inválidos, incluido un `modoTransporte` distinto de `auto` o `pedestrian`. No se llama al optimizador. |
| `409` | `REOPTIMIZACION_NO_DISPONIBLE` | El optimizador respondió `422`: no hay un orden viable con los horarios y las rutas disponibles, o una parada está fuera del mapa de Valhalla. |
| `502` | `OPTIMIZADOR_NO_DISPONIBLE` | No fue posible conectar con el optimizador. |
| `502` | `REOPTIMIZACION_NO_DISPONIBLE` / `RESPUESTA_OPTIMIZADOR_INVALIDA` | El optimizador falló o devolvió un orden inválido. |
| `503` | `SERVICIO_RUTAS_NO_DISPONIBLE` | El optimizador respondió `503` porque Valhalla no está disponible o no respondió a tiempo. |

En el paso 4, la lluvia significativa del pronóstico dispara el evento de clima automáticamente. Los botones “Reportar retraso y recalcular” y “Cancelar parada y recalcular” envían los otros eventos; la lista y el mapa se actualizan desde el estado compartido del itinerario.

## Comandos

```powershell
npm run build  # compila TypeScript a dist/ (el servidor queda en dist/backend/src/server.js)
npm start      # inicia el servidor compilado (requiere npm run build)
npm run dev    # inicia el servidor con tsx y lo reinicia al detectar cambios
npm run typecheck  # verifica los tipos de src/ y test/
npm test       # ejecuta todas las pruebas de test/ con Geoapify, OpenWeather, SerpApi y ExchangeRate-API simulados (no requiere claves ni consume cuotas), incluidas las de clasificación y priorización climática, las de recomendaciones de hoteles y de restaurantes y las del reordenamiento reactivo por clima
npm run ai:test   # pruebas del módulo de IA (validador, orquestador, validación de estancias y de apertura)
npm run ai:tipos  # comprobación de tipos estricta del módulo de IA
```

El módulo de itinerarios (`src/ai/`) se compila junto con el resto del servidor. Como importa tipos de `shared/types`, `tsconfig.build.json` usa `rootDir: ".."` y la salida conserva la estructura del repositorio: el servidor compilado queda en `dist/backend/src/server.js`.

Si falta `GEOAPIFY_API_KEY`, `npm start` termina con un mensaje que indica la variable faltante.

### Prueba inestable conocida: «espacia el inicio de las consultas»

La prueba `crearEnriquecedorHorarios › espacia el inicio de las consultas` (`test/horarios.test.ts`) falla de forma intermitente, sobre todo en Windows, con un mensaje como `separación 26 ms`. No indica un error del backend: si se vuelve a ejecutar `npm test`, normalmente pasa. Se reproduce igual en `main` sin otros cambios (en una muestra, 2 de 15 ejecuciones aisladas fallaron con separaciones de 26 y 28 ms).

**Causa.** La prueba lanza 4 consultas con `intervaloMs: 40` y exige que entre dos inicios seguidos pasen al menos 30 ms. `crearEnriquecedorHorarios` asigna a cada consulta su hora de inicio por adelantado (0, 40, 80 y 120 ms) y espera con un `setTimeout` por consulta. Node nunca dispara un temporizador antes de tiempo, pero sí puede dispararlo tarde: en Windows la resolución del reloj ronda los 15 ms y `npm test` ejecuta varios archivos de prueba en paralelo. Si el temporizador de los 40 ms se dispara en el ms 54 y el de los 80 ms llega puntual, entre esos dos inicios pasan 26 ms y la prueba falla.

**Por qué no afecta el uso real.** Ninguna consulta empieza antes de su hora asignada; solo se acorta la separación entre dos inicios seguidos cuando un temporizador se retrasa. Con el intervalo real de 250 ms (`INTERVALO_DETALLES_MS`), un retraso de 10 a 15 ms es pequeño y el ritmo promedio se mantiene en 4 consultas por segundo, por debajo del límite de 5 por segundo del plan gratuito de Geoapify.

**Posibles correcciones (pendientes, fuera del alcance de esta historia).**

- Dar más margen a la prueba, por ejemplo `intervaloMs: 100` y una separación mínima de 70 ms.
- Comprobar lo que realmente importa: que cada consulta empiece en su hora asignada o después (`inicios[i] - inicios[0] >= i * intervaloMs - 2`), en lugar de medir la separación entre dos inicios seguidos.
- Cambiar el código para medir la espera desde el inicio real anterior. Esto garantiza la separación mínima entre dos inicios seguidos, pero cambia el comportamiento y no aporta una mejora práctica con 250 ms de intervalo.

## Base de datos (Prisma)

El esquema está en `prisma/schema.prisma` y las migraciones en `prisma/migrations/`. El cliente se genera en `generated/prisma` (excluido de Git).

```powershell
docker compose up -d postgres   # desde la raíz del repositorio
npx prisma migrate dev          # aplica las migraciones pendientes y genera el cliente
```

Para cambiar el esquema, edita `schema.prisma` y crea una migración nueva con `npx prisma migrate dev --name <descripcion>`. No edites migraciones que ya están en `main`: Prisma detecta el cambio de checksum y pide reiniciar la base de datos. Si tu base local quedó en ese estado, ejecuta `npx prisma migrate reset` (borra los datos locales).

## Endpoint `GET /api/lugares`

Recibe una ubicación en coordenadas. Todavía no hace geocodificación del destino, no reemplaza los datos de ejemplo del frontend y no genera itinerarios.

| Parámetro | Obligatorio | Regla |
| --- | --- | --- |
| `lat` | Sí | Número decimal entre -90 y 90 |
| `lng` | Sí | Número decimal entre -180 y 180 |
| `categoria` | Al menos uno de los dos | Una de las categorías admitidas |
| `intereses` | Al menos uno de los dos | Lista de intereses admitidos separados por comas |
| `radio` | No | Entero de 1 a 50000 metros. Por defecto `5000` |
| `limite` | No | Entero de 1 a 100. Por defecto `20` |

Los números deben escribirse en notación decimal simple (por ejemplo `-90.5069`). Se rechazan valores vacíos, repetidos, parciales (`14abc`), `NaN`, `Infinity` y notación exponencial.

Si se envían `categoria` e `intereses`, se consulta la unión de la categoría explícita y las categorías de cada interés, sin duplicados, en una sola petición a Geoapify. Geoapify devuelve lugares que pertenecen a cualquiera de esas categorías. `limite` se aplica al total de la respuesta, no a cada interés, y no se garantiza que aparezcan resultados de todos los intereses: puede no haber lugares de alguna categoría dentro del radio.

### Intereses admitidos

Son los mismos que ofrece el frontend en el paso 3. Se aceptan sin distinguir mayúsculas, con espacios exteriores y con o sin tildes (`vida nocturna`, `GASTRONOMIA`, ` Fotografía `). Se rechazan intereses desconocidos, elementos vacíos (`Cultura,`) y el parámetro repetido. La correspondencia está en `src/config/intereses.ts` y es una decisión del proyecto:

| Interés | Categorías de Geoapify | Qué representa |
| --- | --- | --- |
| Cultura | `entertainment.culture`, `entertainment.museum` | Centros culturales, teatros, galerías y museos |
| Historia | `tourism.sights`, `heritage` | Monumentos, sitios arqueológicos, edificios históricos y patrimonio |
| Gastronomía | `catering.restaurant`, `catering.cafe` | Restaurantes y cafeterías |
| Naturaleza | `natural`, `national_park`, `leisure.park` | Espacios naturales, parques nacionales y parques |
| Aventura | `entertainment.activity_park`, `entertainment.theme_park`, `entertainment.water_park`, `natural.mountain` | Parques de actividades, temáticos y acuáticos, y montañas. No indica que el lugar sea apto para una actividad concreta |
| Compras | `commercial.shopping_mall`, `commercial.marketplace`, `commercial.department_store`, `commercial.gift_and_souvenir` | Centros comerciales, mercados, tiendas departamentales y de recuerdos |
| Vida nocturna | `catering.bar`, `catering.pub`, `adult.nightclub` | Bares, pubs y discotecas |
| Playa | `beach` | Playas |
| Fotografía | `tourism.attraction`, `tourism.sights` | Atracciones turísticas (incluye miradores, arte público y fuentes) y lugares emblemáticos. Geoapify no evalúa su valor fotográfico |
| Arte | `entertainment.culture.gallery`, `entertainment.culture.arts_centre`, `tourism.attraction.artwork`, `commercial.art` | Galerías, centros de arte, obras de arte públicas y tiendas de arte |

### Categorías admitidas en `categoria`

Definidas en `src/config/categorias.ts`:

- `entertainment.museum`
- `entertainment.culture`
- `catering.restaurant`
- `catering.cafe`
- `accommodation.hotel`
- `tourism.attraction`
- `tourism.sights`
- `leisure.park`

### Respuesta exitosa (200)

```json
{
  "lugares": [
    {
      "idExterno": "51f0a6...",
      "proveedor": "geoapify",
      "nombre": "Museo Nacional de Arqueología y Etnología",
      "direccion": "Zona 13, Ciudad de Guatemala, Guatemala",
      "lat": 14.5907,
      "lng": -90.5242,
      "categorias": ["entertainment", "entertainment.museum"],
      "tipo_entorno": "indoor",
      "sensibilidad_clima": "baja",
      "regla_clima": "entertainment.museum",
      "horario": {
        "estado": "disponible",
        "valorOriginal": "Tu-Fr 09:00-16:00; Sa,Su 09:00-12:00,13:30-16:00; Mo off",
        "fuente": "geoapify"
      }
    }
  ]
}
```

Este ejemplo y los de la sección de horarios ilustran el formato; no son datos obtenidos de Geoapify.

Cada lugar entregado tiene `idExterno` y `nombre` no vacíos, coordenadas válidas y al menos una categoría del proveedor. `categorias` contiene todas las categorías que informa Geoapify, aunque no se hayan pedido (por ejemplo `building`). `direccion` es `null` cuando el proveedor no la informa. Los registros sin identificador, nombre, coordenadas o categorías válidas se descartan sin completar datos. Si no hay coincidencias, o si todos los registros se descartan, la respuesta es `200` con `lugares` vacío; una respuesta del proveedor con estructura inválida produce `502`. Cada lugar incluye siempre el objeto `horario` descrito a continuación y su clasificación climática (`tipo_entorno`, `sensibilidad_clima` y `regla_clima`), descrita en [Clasificación climática de lugares](#clasificación-climática-de-lugares). El contrato TypeScript está en `shared/types/lugarInteres.ts` (`LugarInteres`, `HorarioLugar`, `EstadoHorario` y `RespuestaLugares`) y `shared/types/entornoClima.ts` (`ClasificacionClima`, `TipoEntorno`, `SensibilidadClima`).

### Horarios de apertura (`horario`)

Después de obtener, validar, deduplicar y limitar los lugares de la búsqueda, el backend consulta `GET https://api.geoapify.com/v2/place-details` para cada lugar con `id` igual a su `idExterno` y `features=details`. Del resultado toma únicamente `opening_hours` del registro con `feature_type: "details"`. Se ignoran edificios, lugares cercanos y cualquier otra entidad. El `place_id` de ese registro puede no ser idéntico al de la búsqueda: Geoapify incluye coordenadas en el identificador y, en una prueba real, el registro de detalles traía un `place_id` con otra codificación aunque correspondía al mismo objeto de OpenStreetMap. Por eso, si hay un único registro `details`, se acepta como el del lugar consultado. Si hay varios, solo se acepta el que tenga exactamente el mismo `place_id`; si no hay ninguno o la coincidencia es ambigua, el resultado es `error_consulta`. El resto de los datos del lugar (identificador, nombre, coordenadas, dirección, proveedor y categorías) se conserva tal como llegó en la búsqueda; los detalles solo aportan el horario.

| Campo | Tipo | Significado |
| --- | --- | --- |
| `estado` | `"disponible"`, `"no_publicado"`, `"no_interpretable"` o `"error_consulta"` | Resultado de la obtención y validación |
| `valorOriginal` | `string` o `null` | Texto publicado por el proveedor, sin modificar |
| `fuente` | `"geoapify"` | Proveedor del dato |

| Estado | Cuándo | `valorOriginal` |
| --- | --- | --- |
| `disponible` | El proveedor publicó un horario y la sintaxis `opening_hours` de OpenStreetMap se validó sin advertencias | El texto publicado |
| `no_publicado` | Se recibieron detalles válidos del lugar, pero `opening_hours` está ausente, es `null` o es un texto vacío | `null` |
| `no_interpretable` | Hay un valor de horario, pero es de un tipo inesperado, tiene una sintaxis inválida o ambigua, o depende de un contexto que no se conoce | El texto publicado, o `null` si no es texto |
| `error_consulta` | No se obtuvieron detalles válidos: error HTTP, fallo de red, tiempo agotado, JSON inválido, estructura inesperada, sin el registro del lugar o presupuesto agotado | `null` |

Nunca se asigna un horario por defecto ni se descartan lugares por no tener horario. El orden, la cantidad y los identificadores de los lugares no cambian por el enriquecimiento.

**No publicado frente a consulta fallida.** `no_publicado` significa que Geoapify respondió correctamente con los detalles del lugar y estos no incluyen horario. `error_consulta` significa que no se sabe: la consulta de detalles no se completó o su respuesta no permitía identificar el registro del lugar, así que el lugar podría tener un horario publicado. Volver a consultar más tarde puede producir otro resultado.

#### Validación

El texto se valida con la biblioteca [`opening_hours`](https://github.com/opening-hours/opening_hours.js), el intérprete de referencia de la sintaxis `opening_hours` de OpenStreetMap. Admite horarios distintos por día (`Mo-Fr 09:00-17:00; Sa 10:00-14:00`), varios intervalos en un día (`Mo-Fr 08:00-12:00,14:00-18:00`), turnos que cruzan la medianoche (`Fr-Sa 22:00-03:00`), `24/7`, días cerrados (`Su off`), temporadas, comentarios y horas solares (`sunrise-sunset`). Un día marcado como cerrado (`off`) es un horario publicado y se devuelve como `disponible`; no equivale a un horario ausente.

- La validación comprueba la estructura del texto publicado; no certifica que el establecimiento mantenga actualizado su horario.
- `GET /api/lugares` no calcula si un lugar está abierto en un momento dado; esa evaluación se hace para la llegada estimada de cada parada en [`POST /api/itinerarios/validar`](#endpoint-post-apiitinerariosvalidar) y para el momento actual en [`GET /api/lugares/abiertos-ahora`](#endpoint-get-apilugaresabiertos-ahora). `valorOriginal` conserva todas las reglas y excepciones; no se reduce a una pareja de apertura y cierre ni a una tabla semanal.
- No se inventan ubicación administrativa, festivos ni zona horaria. Las reglas de festivos (`PH`) o vacaciones escolares (`SH`) requieren el país y la región, que no se conocen, por lo que se marcan `no_interpretable` conservando el texto.
- Si la biblioteca emite advertencias (por ejemplo, formato de 12 horas `9am-5pm`, nombres de días en otro idioma o un `;` final), la biblioteca tuvo que suponer la intención, así que el valor se marca `no_interpretable`.

#### Ejemplos de `horario`

```json
{ "estado": "disponible", "valorOriginal": "Mo-Sa 09:00-18:00; Su off", "fuente": "geoapify" }
{ "estado": "no_publicado", "valorOriginal": null, "fuente": "geoapify" }
{ "estado": "no_interpretable", "valorOriginal": "Mo-Fr 09:00-17:00; PH off", "fuente": "geoapify" }
{ "estado": "error_consulta", "valorOriginal": null, "fuente": "geoapify" }
```

#### Límites, tiempos de espera y consumo

| Límite | Valor | Constante |
| --- | --- | --- |
| Consultas de detalles simultáneas | 4 | `CONCURRENCIA_DETALLES` en `src/geoapify/enriquecer.ts` |
| Separación mínima entre inicios de consultas | 250 ms (como máximo 4 por segundo) | `INTERVALO_DETALLES_MS` |
| Tiempo de espera por consulta de detalles | 5 segundos | `TIEMPO_ESPERA_DETALLE_MS` en `src/geoapify/detalles.ts` |
| Presupuesto total del enriquecimiento | 10 segundos | `PRESUPUESTO_DETALLES_MS` |

- La separación entre inicios mantiene el ritmo por debajo de las 5 solicitudes por segundo que garantiza el plan gratuito de Geoapify.
- Al agotarse el presupuesto se cancelan las consultas en curso, no se inician las pendientes y esos lugares quedan con `error_consulta`. La respuesta tarda como máximo el tiempo de la búsqueda (10 s) más el presupuesto (10 s).
- No hay reintentos automáticos ni caché. Cada identificador se consulta una sola vez por solicitud.
- Si la búsqueda principal falla, se mantienen sus códigos de error y no se consultan detalles. Si no hay lugares, la respuesta es `200` con `lugares: []` sin consultas adicionales.
- **Consumo:** cada lugar devuelto genera una consulta a Place Details con `features=details`, que cuesta 1 crédito. Una solicitud con `limite=20` puede consumir hasta 21 créditos (1 de búsqueda y 20 de detalles); con `limite=100`, hasta 101. Con el ritmo indicado, el presupuesto alcanza para unos 40 lugares, por lo que con límites altos varios lugares pueden quedar con `error_consulta`. Conviene usar límites pequeños.

#### Limitaciones de los datos del proveedor

Geoapify entrega los horarios de OpenStreetMap tal como los aportan sus colaboradores, después de una limpieza. Muchos lugares no tienen horario publicado y algunos pueden estar incorrectos o desactualizados. `opening_hours` describe la hora local del lugar, pero esta API no informa la zona horaria.

### Errores

Todos los errores tienen la forma `{ "error": { "codigo": "...", "mensaje": "..." } }`.

| HTTP | Código | Situación |
| --- | --- | --- |
| 400 | `PARAMETRO_INVALIDO` | Parámetros inválidos (incluye `detalles` por parámetro) |
| 502 | `PROVEEDOR_NO_DISPONIBLE` | Fallo de red al contactar a Geoapify |
| 502 | `PROVEEDOR_ERROR` | Geoapify respondió con un error |
| 502 | `PROVEEDOR_RESPUESTA_INVALIDA` | Respuesta no JSON o con estructura inesperada |
| 502 | `PROVEEDOR_CREDENCIALES_INVALIDAS` | Geoapify rechazó la clave configurada en el servidor |
| 503 | `PROVEEDOR_LIMITE_SOLICITUDES` | Se alcanzó el límite de solicitudes de Geoapify |
| 504 | `PROVEEDOR_TIEMPO_AGOTADO` | Geoapify no respondió en 10 segundos |
| 500 | `SERVICIO_NO_CONFIGURADO` | La aplicación se creó sin clave |

Estos errores corresponden a la búsqueda principal. Los fallos al consultar los detalles de un lugar no producen un error HTTP: el lugar se devuelve con `horario.estado` igual a `error_consulta`.

### Ejemplos en PowerShell

Con el servidor iniciado (la clave no se envía en la petición; el servidor la carga desde `.env`).

Por categoría:

```powershell
$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/lugares?lat=14.6349&lng=-90.5069&categoria=entertainment.museum&radio=3000&limite=10"
$respuesta.lugares | Format-Table nombre, direccion, lat, lng
```

Por intereses con espacios y tildes, codificando cada valor:

```powershell
$parametros = [ordered]@{
  lat       = "14.6349"
  lng       = "-90.5069"
  intereses = "Gastronomía,Vida nocturna,Historia"
  radio     = "3000"
  limite    = "15"
}
$consulta = ($parametros.GetEnumerator() | ForEach-Object { "$($_.Key)=$([uri]::EscapeDataString($_.Value))" }) -join "&"
$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/lugares?$consulta"
$respuesta.lugares | Format-Table nombre, @{ n = "categorias"; e = { $_.categorias -join ", " } }, lat, lng
```

Comprobación manual de horarios con un límite pequeño (consume hasta 6 créditos: 1 de búsqueda y 5 de detalles). La clave no se solicita ni se imprime:

```powershell
$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/lugares?lat=14.6349&lng=-90.5069&categoria=catering.restaurant&radio=2000&limite=5"
$respuesta.lugares | Format-Table nombre, @{ n = "estado"; e = { $_.horario.estado } }, @{ n = "horario"; e = { $_.horario.valorOriginal } } -Wrap
```

## Endpoint `GET /api/lugares/abiertos-ahora`

Base del modo «Abierto ahora» (GUI-73). Devuelve los lugares cercanos a unas coordenadas cuyo horario publicado en Geoapify indica que están abiertos en el momento de la consulta. Es un endpoint independiente: `GET /api/lugares` conserva sus parámetros, valores por defecto y contrato, y sigue sin calcular la apertura.

`open_now` es una evaluación del horario publicado (`opening_hours` de OpenStreetMap a través de Geoapify), no una confirmación en tiempo real de que el establecimiento esté atendiendo. Cada respuesta indica el instante evaluado (`evaluadoEn`) y el criterio (`criterio: "horarios_publicados"`).

| Parámetro | Obligatorio | Regla |
| --- | --- | --- |
| `lat` | Sí | Número decimal entre -90 y 90 |
| `lng` | Sí | Número decimal entre -180 y 180 |
| `radio` | No | Entero de 1 a 10000 metros. Por defecto `2000` |
| `limite` | No | Entero de 1 a 20. Máximo de lugares abiertos devueltos. Por defecto `10` |
| `categoria` | No | Una de las [categorías admitidas](#categorías-admitidas-en-categoria) |
| `intereses` | No | Lista de [intereses admitidos](#intereses-admitidos) separados por comas |

Los parámetros se validan con Zod (`src/validacion/abiertosAhora.ts`) con las mismas reglas de formato que `/api/lugares`: notación decimal simple, sin valores vacíos, repetidos, `NaN`, `Infinity` ni exponentes. Además, se rechaza cualquier parámetro no admitido. `categoria` e `intereses` se normalizan y combinan con las mismas funciones de `/api/lugares`. Ante un parámetro inválido se responde `400` sin consultar a Geoapify.

**Búsqueda general.** Si no se envían `categoria` ni `intereses`, se consulta un conjunto acotado de categorías turísticas definido en `CATEGORIAS_TURISTICAS_PREDETERMINADAS` (`src/config/abiertosAhora.ts`): `tourism.attraction`, `tourism.sights`, `entertainment.museum`, `entertainment.culture` y `leisure.park`. Se excluyen hospedaje y gastronomía; para incluirlos, envía `categoria` o `intereses` (por ejemplo `intereses=Gastronomía`). La respuesta indica `categoriasPredeterminadas: true`.

### Proceso

1. Se busca en Geoapify Places con el cliente existente (`crearClienteGeoapify`), centrado en `lat`/`lng` con `filter=circle` y `bias=proximity`. Se piden hasta `min(limite × 3, 30)` candidatos (`limiteCandidatos` en `src/config/abiertosAhora.ts`), porque varios pueden estar cerrados o sin horario.
2. Se descartan los duplicados y los lugares cuya distancia en línea recta (haversine, `distanciaMetros` de `src/hoteles/geografia.ts`) supera `radio`, y se ordenan por cercanía (empate por `idExterno`). No se usa Valhalla: la distancia es geográfica, no una duración de traslado.
3. Para cada candidato se obtienen de Place Details el horario (`opening_hours`, validado con `interpretarHorario`) y la zona horaria IANA (`timezone.name`, validada con `esZonaHorariaValida`). Se usa `crearConsultaApertura` (`src/geoapify/enriquecer.ts`), con los mismos límites de concurrencia, ritmo, tiempo de espera y presupuesto que `/api/lugares`.
4. Se evalúa la apertura con `evaluarAperturaActual` (`src/lugares/aperturaActual.ts`), que traduce el instante actual a la hora local del lugar y aplica `evaluarApertura` de `src/geoapify/horario.ts`.
5. Se devuelven solo los lugares con `open_now === true`, en orden de cercanía y hasta `limite`.

| Estado de apertura | `open_now` | Se devuelve |
| --- | --- | --- |
| `abierto` | `true` | Sí |
| `cerrado` | `false` | No |
| `desconocido` | `null` | No |

Un lugar queda como `desconocido` si su horario es `no_publicado`, `no_interpretable` o `error_consulta`, si la biblioteca no puede determinar el estado (`estado_desconocido`: `unknown`, comentarios, horas solares, aperturas abiertas como `10:00+`) o si Place Details no informó una zona IANA válida (`zona_horaria_desconocida`). Nunca se supone que un lugar sin horario está abierto. El contrato TypeScript está en `shared/types/lugaresAbiertos.ts` (`RespuestaLugaresAbiertosAhora`, `LugarAbiertoAhora`, `AperturaActual`, `CoberturaAbiertosAhora`).

### Zona horaria

`opening_hours` describe la hora local del establecimiento. El instante de la consulta (`ahora`, inyectable en `crearApp({ abiertosAhora: { ahora } })`) se convierte a la zona IANA que informa Place Details mediante `Intl.DateTimeFormat`, con las funciones de `src/ai/zonaHoraria.ts`. El resultado no depende de la zona horaria del servidor y respeta el horario de verano de la zona del lugar. Los turnos que cruzan la medianoche, `24/7` y los días `off` se interpretan con la biblioteca `opening_hours`, como en la validación de itinerarios. `cierreEstimado` es el próximo cambio a cerrado dentro de las 48 horas siguientes, en hora local con desplazamiento (`2026-10-19T16:00-06:00`); es `null` si no hay cierre en ese plazo (por ejemplo `24/7`). La búsqueda de Places no informa la zona horaria, por eso se obtiene de Place Details, en la misma consulta que el horario y sin costo adicional.

### Respuesta (200)

```json
{
  "evaluadoEn": "2026-10-19T21:02:43.145Z",
  "criterio": "horarios_publicados",
  "origen": { "lat": 14.6431, "lng": -90.5133 },
  "radioMetros": 2000,
  "limite": 2,
  "categorias": ["tourism.attraction", "tourism.sights", "entertainment.museum", "entertainment.culture", "leisure.park"],
  "categoriasPredeterminadas": true,
  "total": 1,
  "cobertura": {
    "candidatosEvaluados": 3,
    "limiteCandidatos": 6,
    "busquedaLimitada": false,
    "abiertos": 1,
    "cerrados": 0,
    "desconocidos": 2,
    "desconocidosPorMotivo": { "no_publicado": 2 }
  },
  "lugares": [
    {
      "idExterno": "51...",
      "proveedor": "geoapify",
      "nombre": "Palacio Nacional de la Cultura",
      "direccion": "Palacio Nacional de la Cultura, 6a Calle, Zona 1, Guatemala",
      "lat": 14.6433,
      "lng": -90.5131,
      "categorias": ["building", "building.historic", "tourism", "tourism.sights"],
      "tipo_entorno": "outdoor",
      "sensibilidad_clima": "alta",
      "regla_clima": null,
      "horario": { "estado": "disponible", "valorOriginal": "Mo-Fr 08:00-16:00; Sa-Su 09:00-16:00", "fuente": "geoapify" },
      "open_now": true,
      "estadoApertura": "abierto",
      "evaluadoEn": "2026-10-19T21:02:43.145Z",
      "zonaHoraria": "America/Guatemala",
      "horaLocalEvaluacion": "2026-10-19T15:02-06:00",
      "cierreEstimado": "2026-10-19T16:00-06:00",
      "distanciaMetros": 32
    }
  ]
}
```

Los valores de horario, zona, hora local, cierre, distancia y cobertura provienen de una consulta real; el identificador, la dirección, las coordenadas y las categorías se abreviaron o completaron como ilustración.

Cada lugar conserva todos los campos de `LugarInteres` de `/api/lugares`, incluido el objeto `horario`, y agrega `open_now`, `estadoApertura`, `evaluadoEn`, `zonaHoraria`, `horaLocalEvaluacion`, `cierreEstimado` y `distanciaMetros` (redondeada al metro).

**Cobertura.** El resultado se limita a los candidatos consultados. `candidatosEvaluados` cuenta los candidatos dentro del radio; `abiertos`, `cerrados` y `desconocidos` los clasifican (`abiertos` puede superar `total` cuando se recorta por `limite`). `busquedaLimitada: true` indica que Geoapify llenó el cupo de candidatos (`limiteCandidatos`) y puede haber más lugares en el radio que no se evaluaron. Por eso, una lista vacía no significa que no haya ningún lugar abierto en la zona.

### Errores y respuestas vacías

| HTTP | Código | Situación |
| --- | --- | --- |
| 400 | `PARAMETRO_INVALIDO` | Parámetros inválidos, repetidos o no admitidos (incluye `detalles` por parámetro) |
| 502 | `PROVEEDOR_DETALLES_NO_DISPONIBLES` | Había candidatos, pero no se pudo obtener el horario de ninguno (todos con `error_consulta`) |
| 500, 502, 503, 504 | Los de [`GET /api/lugares`](#errores) | Fallos de la búsqueda principal de Geoapify (sin clave, credenciales, límite de solicitudes, red, respuesta inválida, tiempo agotado) |

- Sin candidatos en el radio, o sin ningún lugar confirmado como abierto, la respuesta es `200` con `lugares: []`, `total: 0` y la cobertura correspondiente.
- Si fallan los detalles de solo algunos lugares (error HTTP, red o tiempo agotado de 5 s), esos lugares se excluyen y se cuentan en `desconocidosPorMotivo.error_consulta`. Si fallan todos, se responde `502` para no confundir un fallo técnico con «no hay lugares abiertos».
- Nunca se completan horarios ni se inventan lugares.

### Caché y consumo

- Se guardan en memoria, por `idExterno`, el horario publicado y la zona horaria durante 30 minutos (`VIGENCIA_CACHE_APERTURA_MS`, como máximo 1000 entradas). **No se guarda `open_now`**: se recalcula en cada consulta con el reloj actual, así que un lugar deja de aparecer en cuanto llega su hora de cierre aunque su horario siga en caché. Los fallos de consulta (`error_consulta`) no se guardan. La caché es por proceso y se vacía al reiniciar.
- Cada solicitud consume 1 crédito de búsqueda más 1 por candidato sin caché: con `limite=10`, hasta 31 créditos la primera vez. Con el ritmo de 4 consultas de detalles por segundo, 30 candidatos tardan unos 7,5 s, dentro del presupuesto de 10 s.

### Ejemplos en PowerShell

Con el servidor iniciado (`npm run dev`). Búsqueda general alrededor del Centro Histórico (consume hasta 7 créditos):

```powershell
$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/lugares/abiertos-ahora?lat=14.6431&lng=-90.5133&radio=2000&limite=2"
$respuesta | Select-Object evaluadoEn, criterio, radioMetros, total
$respuesta.cobertura | ConvertTo-Json
$respuesta.lugares | Format-Table nombre, distanciaMetros, horaLocalEvaluacion, cierreEstimado, @{ n = "horario"; e = { $_.horario.valorOriginal } } -Wrap
```

Por intereses, codificando los valores:

```powershell
$parametros = [ordered]@{ lat = "14.6349"; lng = "-90.5069"; intereses = "Cultura,Gastronomía"; radio = "3000"; limite = "5" }
$consulta = ($parametros.GetEnumerator() | ForEach-Object { "$($_.Key)=$([uri]::EscapeDataString($_.Value))" }) -join "&"
$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/lugares/abiertos-ahora?$consulta"
$respuesta.lugares | Format-Table nombre, distanciaMetros, cierreEstimado
```

Solicitud inválida (responde `400` sin consultar a Geoapify):

```powershell
try {
  Invoke-RestMethod -Uri "http://localhost:3000/api/lugares/abiertos-ahora?lat=abc&lng=-90.5&radio=0"
} catch {
  $_.ErrorDetails.Message | ConvertFrom-Json | ConvertTo-Json -Depth 4
}
```

### Limitaciones

- La apertura depende de la calidad de los datos de OpenStreetMap: muchos lugares no publican horario y algunos horarios pueden estar desactualizados.
- Los festivos (`PH`) y las vacaciones escolares (`SH`) no se evalúan (el horario queda `no_interpretable`), así que un lugar cerrado por un feriado no indicado en su horario puede aparecer como abierto.
- `evaluarApertura` construye la fecha local del lugar con un `Date` del servidor. Si esa hora local no existe en la zona del servidor (el salto de horario de verano del servidor), el estado queda `desconocido` en ese minuto; en el cambio de hora del servidor, `cierreEstimado` puede diferir una hora. No afecta a servidores en UTC o en zonas sin horario de verano.
- El resultado se limita a los candidatos evaluados (como máximo 30 por solicitud); consulta `cobertura.busquedaLimitada`.
- El frontend lo consume con el botón «Abierto ahora» del paso 4; consulta [Frontend: botón «Abierto ahora»](#frontend-botón-abierto-ahora).

### Frontend: botón «Abierto ahora»

El paso 4 (`frontend/src/pages/Paso4Generacion.tsx`) muestra el botón «Abierto ahora» encima del mapa del día. Al activarlo:

1. Pide la ubicación al navegador una sola vez (`src/services/ubicacionActual.ts`). El navegador muestra el permiso la primera vez. Si devuelve una lectura guardada de más de 5 minutos, se pide una nueva una vez más. No se consulta la ubicación de forma continua ni se guarda fuera del estado del modo; al desactivarlo se descarta.
2. Consulta `GET /api/lugares/abiertos-ahora` con `lat`, `lng`, `radio=2000` y `limite=10` (`src/services/abiertosAhora.ts`), con un tiempo máximo de espera de 25 s. Con el filtro «Mis intereses» agrega `intereses` con los intereses elegidos en el paso 3; por defecto usa la búsqueda general del backend.
3. Muestra debajo del mapa las tarjetas de los lugares con `open_now === true` (nombre, dirección, categoría, distancia en línea recta, hora de cierre en la hora local del lugar y horario publicado) y los dibuja en el mapa con un marcador verde propio. «Ver en el mapa» y el clic en un marcador seleccionan el mismo lugar en ambos.

Si no se obtiene la ubicación (permiso denegado, navegador sin soporte, tiempo agotado, coordenadas inválidas), se explica el motivo y se puede buscar cerca de una parada del itinerario. Ese punto se identifica siempre como «punto elegido, no es tu ubicación actual».

El estado del modo vive en un controlador separado del itinerario (`src/services/abiertosAhoraEstado.ts`, usado por `src/hooks/useAbiertosAhora.ts`). Ignora los clics repetidos mientras busca, cancela con `AbortController` la consulta en curso al desactivar el modo o al iniciar otra búsqueda, y descarta cualquier respuesta tardía. El modo nunca agrega, quita ni reordena paradas. Al desactivarlo se retiran sus marcadores y el mapa vuelve a encuadrar el recorrido del día. No se integra con la reoptimización: el flujo actual de `POST /api/itinerarios/reoptimizar` solo reordena paradas existentes, así que agregar un lugar abierto al itinerario queda como integración pendiente de GUI-73.

Pruebas: `cd frontend; npm test` ejecuta `test/abiertosAhora.test.ts` (servicio HTTP, geolocalización, controlador del modo y marcado de los componentes con `react-dom/server`). El script de pruebas usa `tsx --test`, que ya estaba en `devDependencies`, para poder importar los componentes `.tsx`.

Prueba manual en el navegador:

```powershell
cd backend; npm run dev          # terminal 1
cd frontend; npm run dev         # terminal 2, abre http://localhost:5173
```

Completa los pasos 1 a 3, pulsa «Abierto ahora» en el paso 4 y acepta el permiso de ubicación. Para probar sin GPS, deniega el permiso y usa «Buscar cerca de una parada del itinerario». Los resultados dependen de la hora: fuera del horario habitual (por ejemplo, de noche) lo normal es la lista vacía con el mensaje «No se encontraron lugares con apertura confirmada cerca de esta ubicación.». Sin `VITE_MAPBOX_TOKEN` el mapa muestra su aviso, pero el botón y las tarjetas funcionan igual.

## Clasificación climática de lugares

Cada lugar real que devuelve el backend incluye tres campos:

| Campo | Valores | Significado |
| --- | --- | --- |
| `tipo_entorno` | `"indoor"` o `"outdoor"` | Si la visita transcurre principalmente bajo techo o al aire libre |
| `sensibilidad_clima` | `"baja"`, `"media"` o `"alta"` | Cuánto puede afectar el clima a la visita |
| `regla_clima` | Clave de categoría o `null` | Categoría de la regla aplicada; `null` indica que se usó la política por defecto |

La clasificación es una **regla del proyecto** aplicada a las categorías reales que Geoapify informa para el lugar. Geoapify no publica si un lugar es interior o exterior: estos campos no son una característica del establecimiento confirmada por el proveedor. No se usa el nombre del lugar, ningún dato ficticio ni la respuesta de un modelo.

Aparece en los resultados de `GET /api/lugares`, en los lugares resueltos con Place Details y en las paradas de `POST /api/itinerarios/priorizar-clima`. Las tres rutas usan la misma función pura (`clasificarEntorno` en `src/clima/clasificacion.ts`), invocada al transformar el registro de Geoapify (`src/geoapify/transformar.ts`), y la misma tabla de reglas (`REGLAS_ENTORNO_CLIMA` en `src/config/entornoClima.ts`). No se guarda en la base de datos ni modifica `Restriccion`.

### Reglas iniciales

Los identificadores se verificaron contra la [lista oficial de categorías de Geoapify Places API](https://apidocs.geoapify.com/docs/places/). Una regla cubre su categoría y todas sus subcategorías (`leisure.park` cubre `leisure.park.garden`).

| Categorías | `tipo_entorno` | `sensibilidad_clima` |
| --- | --- | --- |
| `entertainment.museum`, `entertainment.culture` (galerías, teatros, centros de arte), `entertainment.aquarium`, `entertainment.planetarium`, `entertainment.cinema`, `entertainment.bowling_alley`, `entertainment.escape_game`, `entertainment.amusement_arcade` | indoor | baja |
| `catering`, `catering.restaurant`, `catering.cafe` | indoor | baja |
| `commercial.shopping_mall`, `commercial.department_store`, `accommodation`, `adult.nightclub` | indoor | baja |
| `religion.place_of_worship`, `tourism.sights.place_of_worship` | indoor | baja |
| `commercial.marketplace`, `tourism.sights.castle`, `tourism.sights.fort`, `beach.beach_resort` | outdoor | media |
| `leisure.park`, `leisure.picnic`, `leisure.playground`, `natural`, `national_park`, `beach` | outdoor | alta |
| `entertainment.zoo`, `entertainment.theme_park`, `entertainment.water_park`, `entertainment.activity_park`, `entertainment.miniature_golf`, `entertainment.flying_fox` | outdoor | alta |
| `tourism.sights.archaeological_site`, `tourism.sights.ruines`, `tourism.attraction.viewpoint`, `catering.biergarten` | outdoor | alta |

Clasificar restaurantes y cafeterías como `indoor` con sensibilidad baja es una inferencia del proyecto: puede no representar terrazas ni espacios mixtos. La sensibilidad `media` se usa para lugares que suelen combinar zonas cubiertas y descubiertas (mercados, castillos, fuertes, complejos de playa).

### Precedencia

Se evalúan **todas** las categorías del lugar, no solo la primera:

1. Se buscan las reglas que cubren alguna de las categorías.
2. Gana la regla más específica, es decir, la de clave con más niveles (`catering.biergarten` prevalece sobre `catering`; `tourism.sights.place_of_worship` prevalece sobre cualquier regla de un nivel). Las categorías genéricas sin regla, como `building` o `building.tourism`, no intervienen y no anulan una regla más específica.
3. Si dos reglas igual de específicas se contradicen, gana la más conservadora: `outdoor` antes que `indoor` y, después, la sensibilidad más alta.
4. Si aún empatan, se elige por orden alfabético de la clave. El resultado no depende del orden en que Geoapify liste las categorías.

### Política por defecto

Si ninguna regla cubre las categorías del lugar (por ejemplo, solo `building`, `tourism.sights` o `commercial.supermarket`), se asigna `outdoor` con sensibilidad `alta` y `regla_clima: null`. Es una **política conservadora del proyecto**: con lluvia, un lugar desconocido no se adelanta a los lugares bajo techo. No afirma que el lugar sea exterior. Las paradas de `priorizar-clima` cuyo lugar no pudo resolverse reciben la misma clasificación por defecto antes de ser descartadas por la validación existente.

## Endpoint `POST /api/itinerarios/validar`

Recibe una propuesta de itinerario (los lugares de cada día, en orden, con su estancia), obtiene los datos reales de cada lugar en Geoapify, calcula la llegada estimada a cada parada y devuelve el plan validado: solo las visitas que pueden hacerse con el lugar abierto. Las paradas excluidas se informan aparte, con su motivo.

Usa el mismo validador que el flujo de generación con IA (`validarSalida` en `src/ai/validator.ts`), así que la propuesta tiene el formato que produce el modelo. No genera itinerarios, no reordena paradas ni guarda nada.

### Solicitud

```json
{
  "viaje": {
    "id": "viaje-123",
    "fechaInicio": "2026-10-13",
    "fechaFin": "2026-10-14",
    "zonaHoraria": "America/Guatemala",
    "horaInicio": "09:00"
  },
  "propuesta": {
    "dias": [
      { "numeroDia": 1, "paradas": [{ "placeId": "51e9d66b...", "tiempoEstanciaMinutos": 60, "motivo": "Opcional" }] }
    ]
  }
}
```

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `viaje.id` | Sí | Texto de 1 a 100 caracteres; se copia en `viajeId` |
| `viaje.fechaInicio`, `viaje.fechaFin` | Sí | Fechas reales `AAAA-MM-DD`; `fechaFin` igual o posterior; como máximo 14 días |
| `viaje.zonaHoraria` | Sí | Identificador IANA del destino (`America/Guatemala`, `Europe/Madrid`). Se rechazan desplazamientos como `-06:00` |
| `viaje.horaInicio` | No | `HH:MM`, hora local del destino en que empieza cada día. Por defecto `09:00`, la misma que usaba el validador |
| `propuesta.dias[].numeroDia` | Sí | Entero desde 1 |
| `propuesta.dias[].paradas[].placeId` | Sí | `idExterno` de Geoapify (el que devuelve `GET /api/lugares`). De 1 a 5 paradas por día y como máximo 20 lugares distintos por solicitud |
| `propuesta.dias[].paradas[].tiempoEstanciaMinutos` | Sí | Entero de 15 a 360 |

Cualquier otro campo de la parada (nombre, coordenadas, `opening_hours`, `horario`) se ignora: el horario enviado por el cliente nunca se usa como evidencia.

**Zona horaria.** El servidor no la deduce: Geoapify no la informa en estas APIs, y no se usa la zona del servidor ni se supone la de Guatemala. Por eso es obligatoria en el contrato. Las fechas y horas locales se convierten a instantes con `Intl` y la base de datos de zonas de Node, con sus cambios de horario de verano.

### Proceso

1. Se valida el cuerpo; si falla, responde `400` sin consultar a Geoapify.
2. Para cada `placeId` distinto se consulta Place Details **una sola vez**, con los mismos límites del enriquecimiento de `/api/lugares` (4 simultáneas, 250 ms entre inicios, 5 s por consulta, 10 s de presupuesto total). Del registro `details` se toman el nombre, las coordenadas, la dirección, las categorías y `opening_hours`, interpretado con `interpretarHorario`. La parada conserva el `placeId` solicitado aunque el `place_id` del registro de detalles tenga otra codificación.
3. Para cada día y en el orden recibido se calcula la llegada:
   - La primera parada empieza en `fecha` + `horaInicio`, en la zona del destino.
   - Cada parada siguiente llega en la salida de la **última parada conservada** más el traslado estimado desde ella. Una parada excluida no consume estancia ni desvío.
   - Las visitas no esperan: la estancia comienza a la hora de llegada.
4. Se evalúa la apertura en esa llegada con la biblioteca `opening_hours` (`evaluarApertura` en `src/geoapify/horario.ts`). La biblioteca lee la fecha con la hora local del proceso, así que se le entrega una `Date` construida explícitamente con la fecha y la hora de pared del destino. El intervalo abierto incluye su inicio y excluye su cierre.
5. Si el lugar está abierto, se aplica la validación de estancia existente (`validarEstancia`): la visita se acorta hasta el siguiente cierre o se descarta si quedan menos de 15 minutos.

**Traslados estimados.** No hay datos de rutas reales. El tiempo base se estima con la distancia en línea recta entre las coordenadas y 40 km/h (el optimizador, en cambio, usa los tiempos de [Valhalla](../docs/valhalla.md)); a ese tiempo se suma la holgura de `calcularTiempoTotalTraslado` (`tiempoService.ts`), con la regla existente de traslado a pie si el tiempo base es menor de 12 minutos. La llegada se valida con el tiempo **ya incluida la holgura**, y ese mismo traslado se publica en la parada (`traslado`, con `estimado: true`). La holgura ya no se añade después de validar.

**Orden.** Se valida el orden recibido. Si otro módulo (por ejemplo, el optimizador) cambia el orden, la propuesta reordenada debe enviarse de nuevo a este endpoint antes de mostrarla. Este endpoint no consulta el clima ni aplica la prioridad por lluvia; para eso existe [`POST /api/itinerarios/priorizar-clima`](#endpoint-post-apiitinerariospriorizar-clima), que valida los horarios sobre el orden ya priorizado.

### Política de exclusión

| `motivo` | Cuándo |
| --- | --- |
| `cerrado` | El horario publicado indica que el lugar está cerrado a la hora de llegada (antes de abrir, en un receso, en un día cerrado o justo en el instante de cierre) |
| `horario_no_publicado` | Geoapify no publica horario para el lugar |
| `horario_no_interpretable` | El horario publicado no se pudo interpretar o depende de festivos o vacaciones escolares (`PH`, `SH`) |
| `error_consulta` | No se pudieron obtener los detalles del lugar |
| `apertura_desconocida` | El horario se interpretó, pero no confirma la apertura a esa hora: la biblioteca devuelve estado desconocido (`unknown`, comentarios como `"con cita"`, cierres abiertos como `10:00+`), usa horas solares (`sunrise`, `sunset`, `dawn`, `dusk`) que requieren ubicación y zona, o la hora local no existe en la zona del servidor por un cambio de horario |
| `lugar_no_resuelto` | Los detalles llegaron, pero sin nombre, coordenadas o categorías válidas |
| `tiempo_insuficiente` | Está abierto, pero quedan menos de 15 minutos antes del siguiente cierre |

Solo `cerrado` es un cierre confirmado. **Decisión de implementación:** la historia solo exige excluir los lugares cerrados; como política conservadora también se excluyen del plan validado los lugares cuya apertura no puede verificarse, con un motivo distinto. Nunca se asigna un horario por defecto.

### Respuesta (200)

```json
{
  "zonaHoraria": "America/Guatemala",
  "horaInicio": "10:00",
  "viable": true,
  "itinerarios": [
    {
      "id": "it-1",
      "viajeId": "viaje-123",
      "numeroDia": 1,
      "fecha": "2026-10-13",
      "paradas": [
        {
          "id": "p1-1",
          "placeId": "51e9d66b...",
          "nombre": "Casa Mima",
          "lat": 14.63,
          "lng": -90.51,
          "direccion": "...",
          "horario": { "estado": "disponible", "valorOriginal": "Mo-Sa 10:00-17:00", "fuente": "geoapify" },
          "tiempoEstanciaMinutos": 360,
          "llegada": "2026-10-13T10:00-06:00",
          "salida": "2026-10-13T16:00-06:00",
          "estadoEstancia": "completa",
          "traslado": null
        }
      ]
    }
  ],
  "descartes": [
    {
      "numeroDia": 1,
      "fecha": "2026-10-13",
      "placeId": "511dc6d8...",
      "nombre": "Museo del Ferrocarril",
      "motivo": "cerrado",
      "mensaje": "Día 1: \"Museo del Ferrocarril\" fue descartado porque estaría cerrado a la hora estimada de llegada (llegada estimada 2026-10-13T16:20-06:00).",
      "llegada": "2026-10-13T16:20-06:00",
      "horario": { "estado": "disponible", "valorOriginal": "Tu-Fr 09:00-16:00; Sa-Su 10:00-16:00", "fuente": "geoapify" }
    }
  ],
  "diasSinParadas": [],
  "errores": [],
  "advertencias": ["Día 1: \"Museo del Ferrocarril\" fue descartado porque ..."]
}
```

Ejemplo ilustrativo del formato con identificadores recortados; el caso concreto se comprobó contra Geoapify (ver los comandos más abajo).

- `itinerarios[].paradas` contiene **solo** las visitas conservadas, en el orden de la propuesta. `id` es el identificador interno de la parada en el plan; `placeId` es el `idExterno` de Geoapify.
- `llegada` y `salida` son la hora local del destino con su desplazamiento UTC. `traslado` es `null` en la primera parada del día.
- `descartes` lista las paradas excluidas, con la llegada evaluada (`null` si el lugar no pudo resolverse) y el horario real usado.
- Si un día se queda sin paradas, no aparece en `itinerarios`, se incluye en `diasSinParadas`, `errores` lo indica y `viable` es `false`. No se rellena con otros lugares.
- `errores` también informa de problemas de la propuesta (días inexistentes o repetidos, lugares repetidos, más de 5 paradas por día).

### Errores

| HTTP | Código | Situación |
| --- | --- | --- |
| 400 | `PARAMETRO_INVALIDO` | JSON mal formado o de más de 100 KB, campos inválidos, zona horaria ausente o no IANA, más de 14 días o más de 20 lugares (incluye `detalles` por campo) |
| 404 | `RUTA_NO_ENCONTRADA` | Método o ruta distintos |

Los fallos al consultar los detalles de un lugar no producen un error HTTP: la parada se excluye con `error_consulta`.

### Consumo

Cada lugar distinto de la propuesta cuesta 1 crédito de Place Details por solicitud (como máximo 20). No hay caché entre solicitudes.

### Ejemplos en PowerShell

Con el servidor iniciado. Primero se obtiene un lugar real con horario publicado (consume hasta 6 créditos):

```powershell
$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/lugares?lat=14.6349&lng=-90.5069&categoria=entertainment.museum&radio=3000&limite=5"
$respuesta.lugares | Format-Table idExterno, nombre, @{ n = "estado"; e = { $_.horario.estado } }, @{ n = "horario"; e = { $_.horario.valorOriginal } } -Wrap
$lugar = $respuesta.lugares | Where-Object { $_.horario.estado -eq "disponible" } | Select-Object -First 1
"$($lugar.nombre): $($lugar.horario.valorOriginal)"
```

Luego se valida una propuesta con ese lugar. Ajusta `fecha` y `horaInicio` para que la llegada quede dentro o fuera del horario mostrado:

```powershell
function Test-Propuesta($idExterno, $fecha, $horaInicio) {
  $cuerpo = @{
    viaje = @{ id = "verificacion"; fechaInicio = $fecha; fechaFin = $fecha; zonaHoraria = "America/Guatemala"; horaInicio = $horaInicio }
    propuesta = @{ dias = @(@{ numeroDia = 1; paradas = @(@{ placeId = $idExterno; tiempoEstanciaMinutos = 60 }) }) }
  } | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/itinerarios/validar" -ContentType "application/json; charset=utf-8" -Body $cuerpo
}

$dentro = Test-Propuesta $lugar.idExterno "2026-10-13" "11:00"
$dentro.itinerarios.paradas | Format-List placeId, nombre, llegada, salida, @{ n = "horario"; e = { $_.horario.valorOriginal } }

$fuera = Test-Propuesta $lugar.idExterno "2026-10-13" "07:00"
"viable: $($fuera.viable)"
$fuera.descartes | Format-List placeId, nombre, motivo, llegada, @{ n = "horario"; e = { $_.horario.valorOriginal } }
```

### Limitaciones

- El frontend todavía genera lugares y horarios de ejemplo en `frontend/src/services/itinerario.ts` y no llama a este endpoint. El plan validado con horarios reales solo existe en el backend; la pantalla requiere una integración posterior.
- Los traslados son estimaciones en línea recta a 40 km/h con holgura, no rutas reales, y no dependen del medio de transporte del viaje.
- Los festivos, las vacaciones escolares y las horas solares no se evalúan; esos lugares se excluyen como no verificables.
- El optimizador no interpreta `opening_hours`; si reordena las paradas, hay que volver a validar.

## Endpoint `GET /api/clima/pronostico`

Devuelve, para cada fecha del viaje, un resumen de temperatura y lluvia calculado con el pronóstico de [OpenWeather 5 Day / 3 Hour Forecast](https://openweathermap.org/forecast5). Recibe las coordenadas reales del destino y las fechas; no consulta viajes guardados, no geocodifica el nombre del destino y no modifica el itinerario.

Es el endpoint de clima que consume el frontend: el paso 4 hace una sola consulta por viaje y muestra el resumen de cada día del itinerario. `POST /api/itinerarios/priorizar-clima` reutiliza internamente el mismo servicio y el mismo resumen diario.

### Clave de OpenWeather

1. Crea una cuenta gratuita en [home.openweathermap.org/users/sign_up](https://home.openweathermap.org/users/sign_up). El producto 5 Day / 3 Hour Forecast está incluido en el plan gratuito; no hace falta activar suscripciones de pago.
2. Copia la clave desde la pestaña [API keys](https://home.openweathermap.org/api_keys). Una clave nueva puede tardar un tiempo en activarse; mientras tanto OpenWeather responde `401` y este endpoint devuelve `PROVEEDOR_CREDENCIALES_INVALIDAS`.
3. Abre `backend/.env` con un editor y añade una línea nueva sin modificar las existentes:

   ```
   OPENWEATHER_API_KEY=tu_clave
   ```

   No uses la clave de Geoapify ni definas la variable con prefijo `VITE_`. Para comprobar que la variable tiene valor sin imprimirla:

   ```powershell
   Select-String -Path .env -Pattern '^OPENWEATHER_API_KEY=\S+' -Quiet
   ```

4. Reinicia el servidor. Si la variable falta, el servidor inicia igualmente, muestra un aviso y solo `GET /api/clima/pronostico` responde `503`.

### Parámetros

| Parámetro | Obligatorio | Regla |
| --- | --- | --- |
| `lat` | Sí | Número decimal entre -90 y 90 |
| `lng` | Sí | Número decimal entre -180 y 180 |
| `fechaInicio` | Sí | Fecha real del calendario con formato estricto `AAAA-MM-DD` |
| `fechaFin` | Sí | Igual que `fechaInicio`; debe ser igual o posterior |

- Las coordenadas siguen las mismas reglas que en `/api/lugares`: notación decimal simple, se aceptan `0` y los valores límite, y se rechazan valores vacíos, repetidos, parciales, `NaN`, `Infinity` y notación exponencial.
- Las fechas se validan sin depender de `Date`: se rechazan `2026-02-30`, `2026-04-31`, `2025-02-29`, `1900-02-29`, meses o días `00`, formatos como `2026-1-05`, `2026/10/12` o `12-10-2026`, horas añadidas y espacios. Se aceptan los 29 de febrero de años bisiestos (`2028-02-29`, `2000-02-29`).
- El rango incluye ambas fechas. Su máximo técnico es de **366 días** (`MAX_DIAS_RANGO` en `src/validacion/clima.ts`), para evitar respuestas desproporcionadas. Este límite no tiene relación con el horizonte meteorológico: un viaje de 14 o de 366 días es válido aunque el pronóstico solo cubra unos 5 días. Un rango mayor se rechaza con `400`; nunca se recorta en silencio.
- Las fechas pasadas son válidas y aparecen como `fuera_de_cobertura`: no se consultan datos históricos.
- Cualquier parámetro inválido produce `400` antes de consultar a OpenWeather.

### Consulta al proveedor

Cada solicitud hace **una sola** petición a `GET https://api.openweathermap.org/data/2.5/forecast` con `lat`, `lon` (nuestro `lng`), `appid`, `units=metric` y `lang=es`. No se envía `cnt` ni ninguna fecha: el proveedor devuelve toda la serie disponible (normalmente 40 intervalos de tres horas, unos 5 días a partir del momento de la consulta) y el rango del viaje se aplica después. No se dan por supuestos 40 registros, 5 fechas completas ni que la serie empiece en `fechaInicio`: la cobertura se calcula con los registros recibidos.

- Tiempo de espera de 10 segundos (`TIEMPO_ESPERA_MS` en `src/openweather/cliente.ts`) que cubre también la lectura del cuerpo; al agotarse, la petición se cancela.
- Sin reintentos automáticos ni caché.
- No se registran la clave, la URL autenticada ni el cuerpo de los errores del proveedor.

### Respuesta exitosa (200)

Ejemplo ilustrativo del formato (no son datos reales de OpenWeather), para un viaje del 11 al 18 de octubre consultado el 11 a las 09:00 hora de Guatemala:

```json
{
  "fuente": "openweathermap",
  "ubicacion": { "lat": 14.6349, "lng": -90.5069 },
  "rango": { "fechaInicio": "2026-10-11", "fechaFin": "2026-10-18", "totalDias": 8 },
  "consultadoEn": "2026-10-11T15:02:11.482Z",
  "desplazamientoUtcSegundos": -21600,
  "cobertura": {
    "desde": "2026-10-11",
    "hasta": "2026-10-16",
    "primerIntervalo": "2026-10-11T18:00:00.000Z",
    "ultimoIntervalo": "2026-10-16T15:00:00.000Z"
  },
  "dias": [
    { "fecha": "2026-10-11", "estado": "parcial", "temperaturaPromedioC": 21.4, "temperaturaMinimaC": 18.2, "temperaturaMaximaC": 24.9, "lluviaMm": 3.1, "intervalosDisponibles": 4 },
    { "fecha": "2026-10-12", "estado": "disponible", "temperaturaPromedioC": 19.86, "temperaturaMinimaC": 15.7, "temperaturaMaximaC": 25.3, "lluviaMm": 6.42, "intervalosDisponibles": 8 },
    { "fecha": "2026-10-16", "estado": "parcial", "temperaturaPromedioC": 17.1, "temperaturaMinimaC": 15.9, "temperaturaMaximaC": 19.4, "lluviaMm": 0, "intervalosDisponibles": 4 },
    { "fecha": "2026-10-17", "estado": "fuera_de_cobertura", "temperaturaPromedioC": null, "temperaturaMinimaC": null, "temperaturaMaximaC": null, "lluviaMm": null, "intervalosDisponibles": 0 },
    { "fecha": "2026-10-18", "estado": "fuera_de_cobertura", "temperaturaPromedioC": null, "temperaturaMinimaC": null, "temperaturaMaximaC": null, "lluviaMm": null, "intervalosDisponibles": 0 }
  ],
  "advertencias": [
    { "codigo": "FUERA_DE_COBERTURA", "mensaje": "Estas fechas están fuera del pronóstico disponible (2026-10-11 a 2026-10-16).", "fechas": ["2026-10-17", "2026-10-18"] },
    { "codigo": "COBERTURA_PARCIAL", "mensaje": "Estas fechas tienen menos de 8 intervalos de tres horas; su resumen es incompleto.", "fechas": ["2026-10-11", "2026-10-16"] }
  ]
}
```

En el ejemplo se omitieron los días 13 a 15 por brevedad; la respuesta real incluye **siempre un elemento por cada fecha solicitada**, en orden y sin duplicados, aunque el viaje exceda la cobertura. El contrato TypeScript está en `shared/types/clima.ts` (`RespuestaClima`, `PronosticoDiario`, `CoberturaClima`, `AdvertenciaClima`).

| Campo | Significado |
| --- | --- |
| `fuente` | Siempre `"openweathermap"` |
| `ubicacion`, `rango` | Coordenadas y fechas solicitadas; `totalDias` cuenta ambas fechas |
| `consultadoEn` | Fecha y hora (UTC, ISO 8601) en que se generó la respuesta |
| `desplazamientoUtcSegundos` | Desplazamiento respecto a UTC informado por OpenWeather (`city.timezone`) y usado para agrupar |
| `cobertura` | Fechas locales del primer y último intervalo recibidos, y sus instantes en UTC. `null` si la serie llegó vacía |
| `dias` | Un elemento por fecha solicitada |
| `advertencias` | Avisos de cobertura incompleta. Vacío si todas las fechas están `disponible` |

#### Estados de cada día

| Estado | Cuándo | Valores meteorológicos |
| --- | --- | --- |
| `disponible` | La fecha tiene los 8 intervalos de tres horas de un día | Números |
| `parcial` | La fecha tiene entre 1 y 7 intervalos (lo habitual en el primer y el último día de la serie, o si faltan registros) | Números calculados solo con los intervalos recibidos |
| `fuera_de_cobertura` | La fecha es anterior o posterior a la ventana recibida (`cobertura.desde` a `cobertura.hasta`) | `null`, `intervalosDisponibles: 0` |
| `sin_datos` | La fecha está dentro de la ventana pero no hay registros para ella, o el proveedor devolvió una serie válida vacía | `null`, `intervalosDisponibles: 0` |

Los tipos impiden combinaciones incoherentes: los estados `disponible` y `parcial` siempre llevan números y los otros dos siempre llevan `null`.

| Código de advertencia | Significado |
| --- | --- |
| `FUERA_DE_COBERTURA` | Algunas fechas quedan fuera del pronóstico disponible |
| `COBERTURA_PARCIAL` | Algunas fechas tienen un resumen incompleto |
| `SIN_DATOS` | Algunas fechas dentro de la ventana no tienen intervalos |
| `SERIE_VACIA` | El proveedor no devolvió ningún intervalo; todas las fechas están `sin_datos` |

Una consulta válida que excede total o parcialmente el horizonte responde `200` con estos estados: no es un fallo técnico.

### Reglas de agregación

**Pronóstico diario oficial frente a resumen calculado.** OpenWeather tiene productos de pronóstico diario con valores mínimos y máximos del día, pero este backend no los usa. Aquí cada día se resume a partir de los intervalos de tres horas del producto 5 Day / 3 Hour:

- `temperaturaPromedioC`: promedio de `main.temp` de los intervalos del día, redondeado a dos decimales.
- `temperaturaMinimaC` y `temperaturaMaximaC`: el menor y el mayor `main.temp` entre esos intervalos. No son los extremos diarios oficiales ni mediciones observadas: la temperatura real puede bajar o subir más entre dos muestras.
- `lluviaMm`: suma de `rain["3h"]` (volumen de lluvia pronosticado para el intervalo, en milímetros) de los intervalos del día, redondeada a dos decimales. Si un registro válido no trae `rain`, se cuenta como 0 mm, porque OpenWeather omite los fenómenos que no se pronostican. La probabilidad de precipitación (`pop`) no se usa ni se confunde con milímetros.
- `intervalosDisponibles`: número de intervalos distintos usados.

**Agrupación por fecha local.** Cada registro se asigna a la fecha local del destino calculada con su `dt` (instante UTC) más `city.timezone`. No se usa la zona horaria del servidor ni del navegador, ni se fija la de Guatemala. Los acumulados corresponden a la fecha local del timestamp del proveedor y solo a los intervalos recibidos: no se interpola, no se reparte la lluvia de un intervalo entre dos fechas y no se extrapolan temperaturas.

**Día parcialmente cubierto.** Un día tiene 8 intervalos posibles de tres horas. Como los registros válidos están separados al menos tres horas, cada uno ocupa una franja distinta; un día es `disponible` solo con sus 8 franjas cubiertas, y con 1 a 7 es `parcial`. El primer día de la serie suele empezar a media jornada y el último termina antes de la medianoche, así que normalmente son parciales. El resumen de un día parcial describe solo las horas recibidas (por ejemplo, un primer día que solo incluye la tarde y la noche).

**Fecha sin pronóstico.** `fuera_de_cobertura` y `sin_datos` no tienen ningún valor: nunca se rellenan con cero lluvia, con el último pronóstico ni con valores estimados.

**Validación de los datos del proveedor.** Antes de agregar, se exige que `list` sea un arreglo, que `city.timezone` sea un entero de segundos entre -43200 y 50400 (se acepta `0`), y que cada registro tenga `dt` entero y `main.temp` numérico finito. Si `rain` está presente, `rain["3h"]` debe ser un número finito no negativo. Los registros se ordenan por `dt` y los duplicados exactos de `dt` se descartan conservando el primero recibido, para no sumar dos veces la misma lluvia. Si dos registros distintos están a menos de tres horas, los acumulados podrían duplicarse, así que la respuesta se considera inválida. Cualquier incumplimiento produce `502`: una respuesta mal formada no se trata como una serie vacía ni como fechas fuera de cobertura, y nunca se devuelven `NaN` ni valores infinitos.

**Limitación de zona horaria.** OpenWeather informa un único desplazamiento UTC (`city.timezone`), vigente en el momento de la consulta, y no una zona IANA con sus reglas de horario de verano. Si el destino cambia de horario dentro de la ventana del pronóstico, los intervalos posteriores al cambio se agrupan con el desplazamiento anterior y pueden quedar una hora desplazados. No se usa otro proveedor para corregirlo.

### Errores

Mismo formato que el resto de la API: `{ "error": { "codigo": "...", "mensaje": "..." } }`. Los mensajes indican que el fallo es del servicio de clima.

| HTTP | Código | Situación |
| --- | --- | --- |
| 400 | `PARAMETRO_INVALIDO` | Parámetros inválidos, rango invertido o de más de 366 días (incluye `detalles` por parámetro) |
| 502 | `PROVEEDOR_CREDENCIALES_INVALIDAS` | OpenWeather rechazó la clave del servidor (401 o 403). Es un problema de configuración, no de la sesión del usuario |
| 502 | `PROVEEDOR_NO_DISPONIBLE` | Fallo de red al contactar a OpenWeather |
| 502 | `PROVEEDOR_ERROR` | OpenWeather respondió con otro error HTTP |
| 502 | `PROVEEDOR_RESPUESTA_INVALIDA` | Respuesta no JSON, con estructura inesperada o con valores inválidos |
| 503 | `SERVICIO_NO_CONFIGURADO` | Falta `OPENWEATHER_API_KEY` en el servidor |
| 503 | `PROVEEDOR_LIMITE_SOLICITUDES` | Se alcanzó el límite de solicitudes de OpenWeather (429) |
| 504 | `PROVEEDOR_TIEMPO_AGOTADO` | OpenWeather no respondió en 10 segundos |

Un fallo de OpenWeather produce estos errores solo en `/api/clima/pronostico`; `/api/lugares` sigue funcionando y `POST /api/itinerarios/priorizar-clima` continúa con el orden original e informa el fallo en `clima.consulta`.

### Ejemplos en PowerShell

Con el servidor iniciado. La clave no se escribe en la URL: el servidor la lee de `.env`. Las fechas se calculan al ejecutar el comando, y las coordenadas de la Ciudad de Guatemala son solo un ejemplo; en la aplicación deben usarse las del destino del viaje.

Rango cercano (hoy y los dos días siguientes), dentro de la cobertura habitual:

```powershell
$hoy = Get-Date
$formato = [Globalization.CultureInfo]::InvariantCulture
$inicio = $hoy.ToString("yyyy-MM-dd", $formato)
$fin = $hoy.AddDays(2).ToString("yyyy-MM-dd", $formato)
$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/clima/pronostico?lat=14.6349&lng=-90.5069&fechaInicio=$inicio&fechaFin=$fin"
$respuesta.cobertura
$respuesta.dias | Format-Table fecha, estado, temperaturaPromedioC, temperaturaMinimaC, temperaturaMaximaC, lluviaMm, intervalosDisponibles
```

Viaje de 14 días, que excede la cobertura y debe devolver 14 fechas:

```powershell
$hoy = Get-Date
$formato = [Globalization.CultureInfo]::InvariantCulture
$inicio = $hoy.ToString("yyyy-MM-dd", $formato)
$fin = $hoy.AddDays(13).ToString("yyyy-MM-dd", $formato)
$respuesta = Invoke-RestMethod -Uri "http://localhost:3000/api/clima/pronostico?lat=14.6349&lng=-90.5069&fechaInicio=$inicio&fechaFin=$fin"
"Fechas devueltas: $($respuesta.dias.Count)"
$respuesta.dias | Format-Table fecha, estado, temperaturaPromedioC, lluviaMm, intervalosDisponibles
$respuesta.advertencias | Format-List codigo, mensaje, @{ n = "fechas"; e = { $_.fechas -join ", " } }
```

Para ver el cuerpo de un error (por ejemplo, `503` sin clave), `Invoke-RestMethod` lanza una excepción; el cuerpo puede leerse con `$_.ErrorDetails.Message` dentro de un `try { ... } catch { ... }`.

## Endpoint `POST /api/itinerarios/priorizar-clima`

Recibe la misma propuesta que [`POST /api/itinerarios/validar`](#endpoint-post-apiitinerariosvalidar) más las coordenadas del destino. Clasifica cada lugar con las [reglas climáticas](#clasificación-climática-de-lugares), consulta el pronóstico de OpenWeather y, **en los días con lluvia pronosticada**, sugiere primero los lugares bajo techo. Después valida llegadas y horarios sobre ese orden con el validador existente.

El carácter predictivo proviene del pronóstico de OpenWeather; la decisión se toma con reglas explícitas y reproducibles, sin modelos entrenados. No genera itinerarios, no guarda nada y no está habilitado en otros flujos (ni en `/validar` ni en el generador con IA).

### Solicitud

```json
{
  "viaje": {
    "id": "viaje-123",
    "fechaInicio": "2026-10-14",
    "fechaFin": "2026-10-15",
    "zonaHoraria": "America/Guatemala",
    "horaInicio": "10:00"
  },
  "destino": { "lat": 14.6349, "lng": -90.5069 },
  "propuesta": {
    "dias": [
      { "numeroDia": 1, "paradas": [{ "placeId": "51a1...", "tiempoEstanciaMinutos": 60 }, { "placeId": "51c3...", "tiempoEstanciaMinutos": 60 }] }
    ]
  }
}
```

`viaje` y `propuesta` tienen exactamente las reglas de `/validar` (fechas reales, como máximo 14 días, zona IANA obligatoria, de 1 a 5 paradas por día, como máximo 20 lugares distintos, estancia de 15 a 360 minutos). El único campo nuevo es:

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `destino.lat` | Sí | Número JSON entre -90 y 90 |
| `destino.lng` | Sí | Número JSON entre -180 y 180 |

Son las coordenadas del destino para consultar el clima. No se geocodifican nombres ni se usan coordenadas fijas. El pronóstico se consulta para el rango `viaje.fechaInicio` a `viaje.fechaFin`.

Los datos de cada establecimiento (nombre, coordenadas, categorías, horario y clasificación) proceden solo de Geoapify. Cualquier otro campo que envíe el cliente se ignora: en las paradas (`tipo_entorno`, `sensibilidad_clima`, `nombre`, `lat`, `horario`…), en `destino` y en la raíz (`pronostico`, `clima`, `lluviaMm`…).

### Proceso

1. Se valida todo el cuerpo. Si algo falla, responde `400` sin consultar a Geoapify ni a OpenWeather.
2. Cada `placeId` distinto se resuelve **una sola vez** con Place Details, con los mismos límites que `/validar`. La clasificación sale del mismo registro, y estos lugares resueltos se reutilizan en la validación de horarios sin consultas adicionales.
3. En paralelo se hace **una sola** consulta a OpenWeather por operación, para `destino` y el rango del viaje, con el servicio de `/api/clima/pronostico` (`crearServicioClima`) y su resumen diario.
4. Para cada día de la propuesta se toma el resumen de su fecha local (`fechaInicio` + `numeroDia` - 1) y se aplica la regla de lluvia a sus paradas. Cada día se decide de forma independiente; las actividades nunca cambian de día.
5. La propuesta reordenada pasa por `validarSalida`, el mismo validador de `/validar`. Se conservan el cálculo de traslados y holguras, la política de descarte y el recálculo de la llegada desde la última parada conservada.
6. Se devuelve el plan validado, los descartes y la decisión climática de cada día. El plan **no se reordena** después de validar.

### Regla de lluvia

| Pronóstico del día | ¿Se prioriza? | `motivo` |
| --- | --- | --- |
| `disponible` o `parcial` con `lluviaMm > 0` | Sí | `lluvia_pronosticada` |
| `disponible` con `lluviaMm = 0` | No, se conserva el orden | `sin_lluvia_pronosticada` |
| `parcial` con `lluviaMm = 0` | No, se conserva el orden | `sin_lluvia_en_cobertura_parcial` (los intervalos recibidos no indican lluvia, pero no cubren el día completo; no se presenta como un día sin lluvia) |
| `fuera_de_cobertura` | No, se conserva el orden | `pronostico_fuera_de_cobertura` |
| `sin_datos` | No, se conserva el orden | `pronostico_sin_datos` |
| Fallo de la consulta a OpenWeather | No, se conserva el orden | `consulta_clima_fallida` |

- Basta con **cualquier** cantidad positiva de lluvia: 0.2 mm activa la regla. No se usa el umbral de 10 mm del frontend, que solo decide su aviso de lluvia significativa.
- `lluviaMm` es la suma diaria de `rain["3h"]` que ya calcula `/api/clima/pronostico`. No se convierte en probabilidad ni se usa `pop`.
- La falta de pronóstico nunca equivale a cero lluvia: en `fuera_de_cobertura`, `sin_datos` y en los fallos, `lluviaMm` es `null` y no se prioriza.

### Orden con lluvia

La función pura `priorizarPorClima` (`src/clima/priorizacion.ts`) ordena las paradas de un día así:

1. Primero las `indoor` y después las `outdoor`.
2. Dentro de cada grupo, por sensibilidad: `baja`, `media`, `alta`.
3. Ante un empate, se conserva el orden original.

El entorno prevalece sobre la sensibilidad: un lugar `outdoor` de sensibilidad baja nunca se adelanta a uno `indoor`. Sin lluvia, o si no hay pronóstico, se conserva exactamente el orden recibido. La función no modifica la entrada, no elimina ni duplica paradas y no cambia identificadores, coordenadas, horarios ni estancias.

### Relación con la validación de horarios

- **Prioridad climática:** solo cambia el orden.
- **Validación de apertura y estancia:** puede excluir paradas, con los mismos motivos que `/validar` (`cerrado`, `horario_no_publicado`, `tiempo_insuficiente`…).

La prioridad nunca incluye lugares cerrados: como las llegadas se calculan sobre el nuevo orden, adelantar un lugar puede hacer que otro llegue fuera de su horario y se descarte, o que uno que habría llegado tarde quepa. Los descartes van en `descartes`, separados de las paradas. Si un día queda vacío, aparece en `diasSinParadas` y no se rellena con otros lugares.

### Respuesta (200)

Contiene todos los campos de la respuesta de `/validar`, más la clasificación en cada parada y el objeto `clima`:

```json
{
  "zonaHoraria": "America/Guatemala",
  "horaInicio": "10:00",
  "viable": true,
  "itinerarios": [
    {
      "id": "it-1",
      "viajeId": "viaje-123",
      "numeroDia": 1,
      "fecha": "2026-10-14",
      "paradas": [
        {
          "id": "p1-1",
          "placeId": "51c3...",
          "nombre": "Casa Mima",
          "tipo_entorno": "indoor",
          "sensibilidad_clima": "baja",
          "regla_clima": "entertainment.museum",
          "llegada": "2026-10-14T10:00-06:00",
          "salida": "2026-10-14T11:00-06:00",
          "traslado": null
        },
        {
          "id": "p1-2",
          "placeId": "51a1...",
          "nombre": "Atrio El Sagrario",
          "tipo_entorno": "outdoor",
          "sensibilidad_clima": "alta",
          "regla_clima": "leisure.park",
          "llegada": "2026-10-14T11:21-06:00",
          "salida": "2026-10-14T12:21-06:00"
        }
      ]
    }
  ],
  "descartes": [],
  "diasSinParadas": [],
  "errores": [],
  "advertencias": [],
  "clima": {
    "fuente": "openweathermap",
    "ubicacion": { "lat": 14.6349, "lng": -90.5069 },
    "consulta": { "estado": "completada" },
    "dias": [
      {
        "numeroDia": 1,
        "fecha": "2026-10-14",
        "estadoPronostico": "disponible",
        "lluviaMm": 2.34,
        "prioridadAplicada": true,
        "ordenModificado": true,
        "motivo": "lluvia_pronosticada",
        "mensaje": "Se pronostica lluvia: se sugieren primero los lugares bajo techo y, dentro de cada grupo, los menos sensibles al clima."
      }
    ]
  }
}
```

Ejemplo recortado (se omiten coordenadas, dirección, horario y el detalle del traslado). Los valores corresponden a una comprobación manual contra Geoapify y OpenWeather: la propuesta se envió en orden Atrio El Sagrario y luego Casa Mima, y el pronóstico real indicaba lluvia ese día.

| Campo de `clima` | Significado |
| --- | --- |
| `consulta` | `{ "estado": "completada" }`, o `{ "estado": "fallida", "codigo": "...", "mensaje": "..." }` con el código de error del servicio de clima (`SERVICIO_NO_CONFIGURADO`, `PROVEEDOR_ERROR`, `PROVEEDOR_TIEMPO_AGOTADO`…) |
| `dias[].estadoPronostico` | Estado del resumen diario (`disponible`, `parcial`, `fuera_de_cobertura`, `sin_datos`) o `error_consulta` si falló la consulta |
| `dias[].lluviaMm` | Lluvia usada para decidir, o `null` si no hay pronóstico |
| `dias[].prioridadAplicada` | Si se activó la prioridad por lluvia |
| `dias[].ordenModificado` | Si el orden cambió de verdad (con lluvia, un solo lugar o lugares ya ordenados lo dejan igual) |
| `dias[].motivo`, `dias[].mensaje` | Motivo tipado y explicación legible |

`clima.dias` tiene un elemento por cada día de la propuesta que existe en el viaje. Los días inexistentes o repetidos se informan en `errores`, igual que en `/validar`. Los contratos TypeScript están en `shared/types/entornoClima.ts` (`DecisionClimaDia`, `ResumenPrioridadClima`, `MotivoPrioridadClima`) y `src/ai/prioridadClima.ts` (`PlanPriorizado`).

### Errores

| HTTP | Código | Situación |
| --- | --- | --- |
| 400 | `PARAMETRO_INVALIDO` | JSON mal formado o de más de 100 KB, los mismos errores de `/validar`, `destino` ausente, no numérico o fuera de rango (incluye `detalles` por campo) |

Los fallos de OpenWeather **no** producen un error HTTP: la respuesta es `200`, se conserva el orden original, se valida igual y `clima.consulta` informa el fallo. Los fallos al consultar un lugar en Geoapify se tratan como en `/validar`: la parada se descarta con `error_consulta` o `lugar_no_resuelto`.

### Consumo

Por solicitud: 1 crédito de Place Details por lugar distinto (como máximo 20) y una llamada a OpenWeather. No hay caché.

### Ejemplos en PowerShell

Con el servidor iniciado. Primero se buscan lugares reales con horario publicado, uno bajo techo y otro al aire libre (consume hasta 8 créditos de Geoapify):

```powershell
$base = "http://localhost:3000"
$museos = Invoke-RestMethod -Uri "$base/api/lugares?lat=14.6349&lng=-90.5069&categoria=entertainment.museum&radio=4000&limite=3"
$parques = Invoke-RestMethod -Uri "$base/api/lugares?lat=14.6349&lng=-90.5069&categoria=leisure.park&radio=4000&limite=3"
$museos.lugares + $parques.lugares | Format-Table nombre, tipo_entorno, sensibilidad_clima, regla_clima, @{ n = "horario"; e = { $_.horario.valorOriginal } } -Wrap
$interior = $museos.lugares | Where-Object { $_.horario.estado -eq "disponible" } | Select-Object -First 1
$exterior = $parques.lugares | Where-Object { $_.horario.estado -eq "disponible" } | Select-Object -First 1
```

Después se envía la propuesta en orden exterior y luego interior, para mañana y pasado mañana, una fecha por solicitud. Elige días en que ambos lugares abran según su horario:

```powershell
$formato = [Globalization.CultureInfo]::InvariantCulture
foreach ($dias in 1, 2) {
  $fecha = (Get-Date).AddDays($dias).ToString("yyyy-MM-dd", $formato)
  $cuerpo = @{
    viaje = @{ id = "verificacion-clima"; fechaInicio = $fecha; fechaFin = $fecha; zonaHoraria = "America/Guatemala"; horaInicio = "10:00" }
    destino = @{ lat = 14.6349; lng = -90.5069 }
    propuesta = @{ dias = @(@{ numeroDia = 1; paradas = @(
      @{ placeId = $exterior.idExterno; tiempoEstanciaMinutos = 60 },
      @{ placeId = $interior.idExterno; tiempoEstanciaMinutos = 60 }
    ) }) }
  } | ConvertTo-Json -Depth 8
  $r = Invoke-RestMethod -Method Post -Uri "$base/api/itinerarios/priorizar-clima" -ContentType "application/json; charset=utf-8" -Body $cuerpo
  "=== $fecha === consulta: $($r.clima.consulta.estado)"
  $r.clima.dias | Format-List fecha, estadoPronostico, lluviaMm, prioridadAplicada, ordenModificado, motivo
  $r.itinerarios.paradas | Format-Table nombre, tipo_entorno, sensibilidad_clima, llegada, salida
  $r.descartes | Format-Table nombre, motivo, llegada
}
```

El resultado depende del pronóstico real. Si OpenWeather indica lluvia para la fecha, el lugar bajo techo aparece primero y `prioridadAplicada` es `True`. Si no la indica, se conserva el orden. Una fecha más allá de unos 5 días aparece como `fuera_de_cobertura`, con el orden original. Las pruebas automáticas (`npm test`) cubren todos los casos con proveedores simulados.

### Limitaciones

- **El frontend no está integrado en esta entrega.** Sigue usando sus datos de ejemplo y no llama a este endpoint ni a `/validar`. La clasificación y la priorización existen solo en el backend.
- La clasificación es una regla por categoría: un restaurante con terraza, un parque con zonas cubiertas o un lugar con categorías incompletas en OpenStreetMap pueden quedar mal representados.
- La lluvia es un acumulado diario, sin distinguir horas: un día con lluvia solo por la noche también prioriza los lugares bajo techo por la mañana.
- **Zona horaria (limitación previa del módulo de clima).** El resumen diario agrupa por la fecha local que da el desplazamiento único de OpenWeather (`city.timezone`), mientras que las llegadas se calculan con la zona IANA del viaje. Coinciden salvo cuando el destino cambia de horario de verano dentro de la ventana del pronóstico; en ese caso algunos intervalos de lluvia pueden quedar asignados a la fecha contigua. Esto viene de `/api/clima/pronostico` y no se modificó en esta entrega.
- Siguen vigentes las limitaciones de `/validar`: traslados estimados en línea recta y lugares sin horario verificable descartados.

## Endpoint `POST /api/hoteles/recomendaciones`

Recomienda hoteles cercanos a la zona del itinerario de **un día** cuyo precio referencial, convertido a quetzales, no supera el 40 % del presupuesto diario. Los hoteles y sus precios provienen de [SerpApi Google Hotels API](https://serpapi.com/google-hotels-api) (motor `google_hotels`) y la tasa USD → GTQ, del [endpoint estándar de ExchangeRate-API](https://www.exchangerate-api.com/docs/standard-requests) (plan gratuito con clave). No reserva, no cobra, no comprueba disponibilidad, no guarda nada y el frontend todavía no lo consume.

> **El precio es referencial.** Es el importe estructurado que publica Google Hotels a través de SerpApi en el momento de la consulta: puede estar redondeado, cambiar después de la consulta o diferir del importe final de una reserva. El filtro del 40 % garantiza que el **importe referencial convertido** no supera el presupuesto de hospedaje; no garantiza el cargo final.

### Flujo de proveedores

1. Se valida el cuerpo (`src/validacion/hoteles.ts`). Cualquier error responde `400` antes de cualquier llamada externa.
2. Si `hospedaje` es `true` responde vacío con `hospedaje_reservado`; si `sinHotel` es `true`, con `no_necesita_hotel` (si ambos son `true`, prevalece `hospedaje_reservado`); si `paradas` está vacía, con `itinerario_sin_paradas` y `centro: null`. Ninguno de estos casos llama a SerpApi ni a ExchangeRate-API, ni necesita sus claves.
3. Se calcula el centro geográfico de las paradas (`calcularCentro` en `src/hoteles/geografia.ts`).
4. Se comprueba que estén configuradas **las dos** claves. Si falta alguna, responde `503 SERVICIO_NO_CONFIGURADO` sin gastar una búsqueda de SerpApi que después no podría convertirse.
5. Se consulta **una página** de resultados de SerpApi (o se reutiliza de la caché de búsquedas).
6. Se normalizan los resultados, se eliminan los repetidos por `property_token` (se conserva la primera aparición) y se descartan los que quedan fuera de `radio`.
7. Si no queda ningún hotel con precio utilizable dentro del radio, responde vacío **sin consultar el tipo de cambio**.
8. Se obtiene la tasa USD → GTQ vigente (o se reutiliza de la caché).
9. Se convierte cada precio a quetzales y se conservan los que no superan el presupuesto de hospedaje.
10. Se ordena por distancia al centro sin redondear (empates por `idExterno`) y se aplica `limite` al final.

Geoapify no participa en este endpoint: no se usa su clave, ni sus categorías, ni sus identificadores. `GET /api/lugares` y los demás módulos siguen usando Geoapify igual que antes.

### Claves de SerpApi y ExchangeRate-API

| Variable | Proveedor | Dónde obtenerla |
| --- | --- | --- |
| `SERPAPI_API_KEY` | SerpApi (Google Hotels) | Crea una cuenta en [serpapi.com](https://serpapi.com/users/sign_up) y copia la clave privada desde [Manage API Key](https://serpapi.com/manage-api-key) |
| `EXCHANGERATE_API_KEY` | ExchangeRate-API | Regístrate en el plan gratuito en [app.exchangerate-api.com](https://app.exchangerate-api.com/sign-up), confirma el correo (sin confirmar, el proveedor responde `inactive-account`) y copia la clave del panel |

1. Abre `backend/.env` con un editor y añade las dos líneas sin modificar las existentes (en `.env.example` están como marcadores vacíos):

   ```
   SERPAPI_API_KEY=tu_clave_de_serpapi
   EXCHANGERATE_API_KEY=tu_clave_de_exchangerate
   ```

   No uses otras claves del proyecto ni definas estas variables con prefijo `VITE_`: se usan solo en el servidor.

2. Comprueba que tienen valor sin imprimirlas (desde `backend/`):

   ```powershell
   Select-String -Path .env -Pattern '^SERPAPI_API_KEY=\S+' -Quiet
   Select-String -Path .env -Pattern '^EXCHANGERATE_API_KEY=\S+' -Quiet
   ```

3. Reinicia el servidor. Si falta alguna, el servidor inicia igualmente y muestra un aviso; solo este endpoint responde `503 SERVICIO_NO_CONFIGURADO` cuando necesita consultar hoteles. Las salidas tempranas del paso 2 siguen respondiendo `200` y el resto de las rutas no se ve afectado.

Consulta en el panel de cada proveedor la cuota mensual de tu plan. El backend no renueva planes ni reintenta solicitudes.

### Solicitud

```json
{
  "fecha": "2026-11-20",
  "destino": "Antigua Guatemala",
  "paradas": [
    { "lat": 14.5586, "lng": -90.7295 },
    { "lat": 14.5562, "lng": -90.7339 }
  ],
  "presupuestoDiario": 500,
  "moneda": "GTQ",
  "ocupacion": 2,
  "hospedaje": false,
  "sinHotel": false,
  "radio": 5000,
  "limite": 10
}
```

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `fecha` | Sí | Fecha real `AAAA-MM-DD` del día del itinerario. Es la fecha de entrada de la noche consultada. Se rechaza una fecha que ya pasó en todas las zonas horarias (anterior al día de ayer en UTC) |
| `destino` | Sí | Texto de 2 a 100 caracteres con la ciudad o zona de búsqueda (por ejemplo, `"Antigua Guatemala"`). Se recortan los espacios y se reducen los repetidos; se rechazan caracteres de control. El backend no lo deduce de las coordenadas ni usa un destino fijo |
| `paradas` | Sí | Lista de 0 a 25 objetos `{ lat, lng }` con las paradas **de ese día** (números JSON; `lat` entre -90 y 90, `lng` entre -180 y 180; se acepta `0`). Otros campos de cada parada se ignoran |
| `presupuestoDiario` | Sí | Presupuesto diario total del usuario, en quetzales. Mayor que 0, como máximo 1 000 000, finito y con hasta dos decimales. No es el presupuesto total del viaje: el backend no lo divide entre días |
| `moneda` | Sí | Solo `"GTQ"` |
| `ocupacion` | Sí | Entero de 1 a 10: número de **adultos** en una habitación. SerpApi no documenta un máximo; el 10 es un límite propio |
| `hospedaje` | Sí | `true` si el usuario ya tiene hospedaje reservado |
| `sinHotel` | No | `true` si el usuario indicó que no necesita hotel. Por defecto `false` |
| `radio` | No | Entero de 1 a 50000 metros alrededor del centro. Por defecto `5000` |
| `limite` | No | Entero de 1 a 20: número máximo de recomendaciones. Por defecto `10` |

- El cuerpo debe ser un objeto JSON de hasta 32 KB. Los campos desconocidos se ignoran; en particular, **no se acepta un porcentaje enviado por el cliente** (`porcentajeHospedaje` u otro campo no cambia el cálculo).
- Cualquier dato inválido responde `400 PARAMETRO_INVALIDO` con `detalles` por campo, antes de consultar a cualquier proveedor. Esto incluye los casos con `hospedaje: true`.
- El contrato TypeScript está en `shared/types/hotel.ts` (`SolicitudRecomendacionesHoteles`, `RespuestaRecomendacionesHoteles`, `HotelRecomendado`, `TarifaReferencialHotel`, `ImpuestosTarifaHotel`, `FuenteTarifaHotel`, `EstanciaHotel`, `BusquedaHoteles`, `TipoCambioHoteles`, `MotivoSinRecomendacionesHotel`).

#### Cambios incompatibles respecto al contrato anterior

- `destino` es un campo **obligatorio** nuevo, también cuando `hospedaje` o `sinHotel` son `true`.
- Se rechazan fechas ya pasadas y `9999-12-31` (no tiene día siguiente representable).
- `ocupacion` significa ahora número de adultos; antes era el número de huéspedes de una tarifa del catálogo.
- `hoteles[].proveedor` es `"serpapi"` e `idExterno` es el `property_token` de SerpApi; ya no son `place_id` de Geoapify. No hay equivalencia entre ambos identificadores.
- `hoteles[].direccion` se eliminó: la búsqueda de SerpApi no la incluye y no se consultan detalles por hotel.
- `hoteles[].tarifa` cambió de forma (`TarifaHotelAplicada` → `TarifaReferencialHotel`): ya no tiene `id`, `ocupacion`, `vigencia`, `verificadoEn` ni `impuestosIncluidos: true`; incorpora `referencial`, `importeUsd`, `importeUsdCentavos`, `noches`, `campo`, `impuestos` y una `fuente` distinta.
- `busqueda` cambió de forma y se añadieron `destino`, `estancia` y `tipoCambio` a la respuesta.
- Los motivos `catalogo_vacio`, `sin_tarifas_aplicables` y `sin_hoteles_elegibles` se eliminaron; se añadieron `sin_hoteles_con_precio`, `sin_hoteles_en_radio` y `sin_hoteles_en_presupuesto`.
- Los errores `CATALOGO_TARIFAS_INVALIDO` y `CATALOGO_TARIFAS_NO_DISPONIBLE` ya no existen. `SERVICIO_NO_CONFIGURADO` pasa de `500` (clave de Geoapify) a `503` (claves de SerpApi o ExchangeRate-API).

### Estancia, moneda y ocupación

- **Una noche por solicitud.** Entrada: `fecha`. Salida: el día calendario siguiente. Se calcula con aritmética de calendario sobre la fecha civil, sin depender de la zona horaria del servidor, e incluye cambios de mes y de año y los 29 de febrero (`2026-12-31` → `2027-01-01`, `2028-02-28` → `2028-02-29`).
- **Adultos, sin menores.** `ocupacion` se envía como `adults` y siempre se consulta con `children=0`. El backend no infiere edades ni representa menores como adultos. Admitir menores es una ampliación posterior explícita: requeriría un campo nuevo con sus edades (`children` y `children_ages` de SerpApi).
- **Moneda.** La solicitud y el presupuesto están en quetzales (`GTQ`). SerpApi se consulta en dólares (`currency=USD`) y el precio se convierte a quetzales con la tasa de ExchangeRate-API.

### Precio referencial e impuestos

Solo se procesan las entradas de `properties` con `type: "hotel"`, `property_token` y `name` no vacíos, `gps_coordinates` numéricas dentro de rango (se acepta `0`) y un precio numérico positivo con hasta dos decimales. Los anuncios (`ads`), los alquileres vacacionales (`type: "vacation rental"`) y los registros incompletos se descartan; nunca se reemplaza un precio desconocido por cero.

**Selección del precio de cada hotel** (`seleccionarPrecio` en `src/hoteles/tarifas.ts`):

1. Candidatos: el resumen de la propiedad y cada oferta individual de `prices` (y de `featured_prices`, en la respuesta de una propiedad individual) que tenga `source`.
2. De cada candidato se lee primero `total_rate.extracted_lowest` y, si no existe o no es utilizable, `rate_per_night.extracted_lowest`. El campo usado se devuelve en `tarifa.campo`. Para una noche ambos representan el mismo periodo.
3. Se descartan las ofertas cuyo `num_guests` es distinto de los adultos consultados. Si se descartó alguna por ese motivo, tampoco se usa el resumen de la propiedad, porque podría provenir de esa oferta.
4. Entre los candidatos restantes se elige de forma determinista: primero los que usan `total_rate`; después el menor importe; después el resumen de la propiedad antes que una oferta; después la oferta oficial (`official: true`); después el nombre de la fuente en orden de caracteres; y por último el orden original.
5. El precio y el desglose de impuestos salen siempre **del mismo bloque del mismo candidato**: nunca se combina el precio de una oferta con los impuestos o condiciones de otra. La fuente se conserva en `tarifa.fuente` (`resumen_propiedad` u `oferta` con su nombre y si es oficial).

**Tratamiento de impuestos** (`tarifa.impuestos`):

| `estado` | Cuándo | Significado |
| --- | --- | --- |
| `informado` | El bloque usado trae `extracted_before_taxes_fees` numérico y menor o igual que el importe | El importe publicado incluye impuestos y cargos; se informan `importeAntesImpuestosUsd` e `impuestosYCargosUsd` (la diferencia) |
| `no_informado` | El bloque no trae un desglose numérico | Se usa el precio publicado como referencia. **No significa que los impuestos estén excluidos**, solo que el proveedor no los desglosó |

Si `extracted_before_taxes_fees` es **mayor** que el importe, el bloque es incoherente y no se usa. El precio antes de impuestos nunca se utiliza como total. No se extraen importes de enlaces de redirección (`link`, `price_displayed_total` y similares), no se hace scraping de páginas de reserva y no se consultan los detalles de cada hotel por separado: todo sale de la respuesta de búsqueda.

Caso observado que orienta las pruebas automáticas:

| Dato del proveedor | Valor | Uso |
| --- | --- | --- |
| `total_rate.extracted_lowest` | USD 24 | Importe referencial |
| `total_rate.extracted_before_taxes_fees` | USD 21 | Solo para informar `impuestos.estado: "informado"` (impuestos y cargos: USD 3) |
| Importe dentro de un enlace de redirección | USD 24.49 | Se ignora |

### Conversión y regla del 40 %

```
presupuestoHospedaje = presupuestoDiario × 0.40
```

El porcentaje es fijo en el backend (`PORCENTAJE_HOSPEDAJE` en `src/hoteles/tarifas.ts`) y no se puede cambiar desde la solicitud. Todo se calcula en centavos enteros:

1. **Presupuesto diario:** se exigen como máximo dos decimales y se convierte a centavos exactos.
2. **Límite de hospedaje:** `floor(presupuestoDiarioCentavos × 40 / 100)`; la fracción de centavo se redondea **hacia abajo** para no superar el 40 %.
3. **Precio referencial en dólares:** `extracted_lowest` a centavos exactos (se descarta si tiene fracciones de centavo).
4. **Conversión:** `importeCentavos = importeUsdCentavos × tasa`, calculado en aritmética decimal exacta con la tasa completa tal como la entrega ExchangeRate-API (sin redondearla antes a dos decimales) y redondeado **una sola vez** al centavo más cercano, con las mitades exactas hacia arriba (`convertirCentavos`).
5. **Filtro:** se admite el hotel si `importeCentavos <= presupuestoHospedajeCentavos`. El importe comparado es exactamente el que se devuelve en `tarifa.importe` y `tarifa.importeCentavos`. No se añaden márgenes, comisiones ni suplementos.

Ejemplo con datos **ficticios de prueba** (la tasa no es real):

| Presupuesto diario | Límite de hospedaje | Precio referencial | Tasa ficticia | Importe convertido | Resultado |
| --- | --- | --- | --- | --- | --- |
| Q500.00 | Q200.00 | USD 24.00 | 7.65 | Q183.60 | Se admite |
| Q500.00 | Q200.00 | USD 25.00 | 8 | Q200.00 | Se admite (igual al límite) |
| Q499.99 | Q199.99 | USD 25.00 | 8 | Q200.00 | Se excluye (un centavo por encima) |
| Q500.00 | Q200.00 | USD 25.00 | 8.0004 | Q200.01 | Se excluye (un centavo por encima) |

### Consulta a SerpApi

Cada búsqueda que no está en caché hace **una sola** petición `GET https://serpapi.com/search.json` (URL construida con `URL` y `URLSearchParams` en `src/hoteles/serpapi.ts`):

| Parámetro | Valor |
| --- | --- |
| `engine` | `google_hotels` |
| `q` | `hoteles en <destino>` |
| `check_in_date` | `fecha` |
| `check_out_date` | Día siguiente a `fecha` |
| `adults` | `ocupacion` |
| `children` | `0` |
| `currency` | `USD` |
| `hl` | `es` |
| `api_key` | `SERPAPI_API_KEY` |

- No se envían parámetros geográficos: el motor no documenta ninguno. El filtro por `radio` y el orden por cercanía se aplican en el backend con las coordenadas de las paradas.
- Se consulta **solo la primera página**. Una página no representa todos los hoteles del destino: un hotel cercano y barato que SerpApi entregue en otra página no se recomienda. `busqueda.hayMasPaginas` indica si SerpApi informó `serpapi_pagination.next_page_token`; esas páginas no se consultan automáticamente.
- Formas de respuesta admitidas: colección (`properties`), propiedad individual (los campos del hotel en la raíz, con `property_token`) y búsqueda legítima sin resultados (`search_metadata.status: "Success"` con un `error` y sin propiedades). Cualquier otra estructura responde `502 PROVEEDOR_RESPUESTA_INVALIDA`; nunca se presenta como una búsqueda vacía.
- Los errores que SerpApi incluye en el JSON también se interpretan: una cuenta sin búsquedas disponibles o una clave rechazada se tratan igual que los estados HTTP `429` y `401`, y `search_metadata.status: "Error"` es un error del proveedor.
- Tiempo de espera de 20 segundos (`TIEMPO_ESPERA_SERPAPI_MS`) que cubre también la lectura del cuerpo; al agotarse, la petición se cancela. Respuesta máxima de 5 MB (`MAX_BYTES_SERPAPI`).
- No se envía `no_cache`: según la documentación de SerpApi, una búsqueda idéntica dentro de su propia caché de 1 hora se sirve sin descontarla de la cuota mensual.

### Tipo de cambio: vigencia y fallos

Se consulta `GET https://v6.exchangerate-api.com/v6/{EXCHANGERATE_API_KEY}/latest/USD` (`src/hoteles/tipoCambio.ts`). La respuesta se acepta solo si:

- `result` es `"success"` y `base_code` es `"USD"`;
- `conversion_rates.GTQ` es un número finito positivo (se usa `conversion_rates` del endpoint con clave, no `rates` de la modalidad abierta);
- `time_last_update_unix` y `time_next_update_unix` son enteros positivos, la siguiente actualización es posterior a la última, la última no está en el futuro (con 5 minutos de tolerancia de reloj) y tiene menos de 36 horas.

Los errores documentados en el JSON (`"result": "error"`) se traducen: `invalid-key` e `inactive-account` → credenciales rechazadas; `quota-reached` → cuota agotada; `unsupported-code` y `malformed-request` → error del proveedor.

**Caché en memoria por instancia de la aplicación:**

- La tasa se reutiliza hasta `time_next_update_unix` o, como máximo, hasta 36 horas después de `time_last_update_unix`, lo que ocurra primero. El vencimiento depende solo de las fechas de origen: leer la tasa de la caché no lo prolonga.
- Las solicitudes concurrentes que necesitan renovar la tasa comparten **una única** consulta.
- Si la tasa vencida no puede renovarse, la solicitud responde con el error correspondiente (`502`, `503` o `504`). **Nunca** se usa una tasa fija, una conversión 1:1 ni una tasa vencida. Los errores no se guardan en caché.
- Si el proveedor ya superó su `time_next_update_unix` sin publicar una tasa nueva, la tasa recibida se usa en esa solicitud (si tiene menos de 36 horas), pero no queda vigente en caché y la siguiente solicitud vuelve a consultar.
- `tipoCambio` en la respuesta informa la tasa, el proveedor, `actualizadoEn` (actualización de origen), `proximaActualizacion` y `consultadoEn` (cuándo la obtuvo el backend).
- Tiempo de espera de 10 segundos (`TIEMPO_ESPERA_EXCHANGERATE_MS`) y respuesta máxima de 128 KB.

### Cachés y consumo

**Caché de búsquedas de SerpApi** (por instancia, en memoria):

- Guarda solo búsquedas exitosas (también las legítimamente vacías), ya normalizadas: nunca el JSON completo del proveedor ni sus enlaces.
- Vigencia de **15 minutos** desde el inicio de la consulta (`TTL_CACHE_BUSQUEDAS_MS`) y **100 entradas** como máximo (`MAX_ENTRADAS_CACHE_BUSQUEDAS`); al llenarse se descarta la menos usada recientemente.
- La clave incluye todos los parámetros que cambian la consulta: motor, `q` (destino), fechas de entrada y salida, adultos, niños, moneda e idioma. No incluye `radio`, `paradas`, `presupuestoDiario` ni `limite`: el radio y el presupuesto se **reaplican** en cada solicitud sobre los resultados guardados.
- Un resultado reutilizado conserva su fecha original de consulta (`busqueda.consultadoEn`) e indica `busqueda.desdeCache: true`.
- Las búsquedas idénticas concurrentes comparten una única petición.

**Consumo por solicitud:**

| Caso | SerpApi | ExchangeRate-API |
| --- | --- | --- |
| `400`, salidas tempranas o claves ausentes | 0 | 0 |
| Búsqueda en caché | 0 | 0 o 1 según la vigencia de la tasa |
| Búsqueda nueva sin hoteles utilizables dentro del radio | 1 | 0 |
| Búsqueda nueva con candidatos | 1 | 0 o 1 según la vigencia de la tasa |

No hay reintentos automáticos, renovación de planes ni consultas masivas de detalles. Las cachés viven en la memoria de cada proceso: no se comparten entre varias instancias del servidor y se pierden al reiniciarlo, así que **no garantizan el cumplimiento de una cuota global**. No se usa Redis, tablas adicionales ni tareas programadas.

**Centro del día.** Cada parada se convierte en un vector unitario en 3D (latitud y longitud sobre la esfera), se promedian los vectores y el resultado se vuelve a convertir en latitud y longitud. A diferencia de promediar grados, este método funciona junto al antimeridiano: el centro de `179.9` y `-179.9` es `180`, no `0`. Si las paradas se anulan entre sí (puntos opuestos del globo), el centro no está definido y la solicitud se rechaza con `400`.

**Distancia.** `distanciaLineaRectaMetros` es la distancia en línea recta sobre la esfera terrestre (fórmula de Haversine, radio de 6 371 km) entre el centro del día y el hotel, redondeada al metro solo al devolverla; el filtro de radio y el orden usan la distancia sin redondear. **No es una distancia por carretera ni un tiempo de traslado.**

### Límites

| Límite | Valor | Constante |
| --- | --- | --- |
| Páginas de SerpApi por búsqueda | 1 | — |
| Recomendaciones devueltas | `limite` (1 a 20, por defecto 10) | `LIMITE_MAXIMO` en `src/validacion/hoteles.ts` |
| Radio | 1 a 50000 m, por defecto 5000 | `RADIO_MAXIMO` |
| Paradas por día | 25 | `MAX_PARADAS_DIA` |
| Adultos | 1 a 10 | `MAX_ADULTOS` |
| Destino | 2 a 100 caracteres | `MAX_LARGO_DESTINO` |
| Presupuesto diario | Hasta Q1 000 000 | `MAX_PRESUPUESTO_DIARIO` |
| Cuerpo de la solicitud | 32 KB | `LIMITE_CUERPO` en `src/routes/hoteles.ts` |

### Respuesta (200)

Ejemplo ilustrativo del formato con datos **ficticios** (el hotel, el identificador, los precios y la tasa no son reales):

```json
{
  "fecha": "2026-11-20",
  "destino": "Antigua Guatemala",
  "moneda": "GTQ",
  "ocupacion": 2,
  "estancia": { "entrada": "2026-11-20", "salida": "2026-11-21", "noches": 1, "adultos": 2, "ninos": 0 },
  "presupuestoDiario": 500,
  "presupuestoDiarioCentavos": 50000,
  "porcentajeHospedaje": 40,
  "presupuestoHospedaje": 200,
  "presupuestoHospedajeCentavos": 20000,
  "centro": { "lat": 14.5574001, "lng": -90.7317002 },
  "metodoDistancia": "linea_recta",
  "busqueda": {
    "proveedor": "serpapi",
    "motor": "google_hotels",
    "consulta": "hoteles en Antigua Guatemala",
    "monedaProveedor": "USD",
    "consultadoEn": "2026-11-10T16:05:12.345Z",
    "desdeCache": false,
    "radioMetros": 5000,
    "resultadosRecibidos": 20,
    "hotelesConPrecio": 18,
    "hotelesEnRadio": 15,
    "hayMasPaginas": true
  },
  "tipoCambio": {
    "proveedor": "exchangerate-api",
    "base": "USD",
    "destino": "GTQ",
    "tasa": 7.65,
    "actualizadoEn": "2026-11-10T00:00:01.000Z",
    "proximaActualizacion": "2026-11-11T00:00:01.000Z",
    "consultadoEn": "2026-11-10T16:05:13.010Z"
  },
  "hoteles": [
    {
      "idExterno": "ChcIficticio...",
      "proveedor": "serpapi",
      "nombre": "Hotel de ejemplo",
      "lat": 14.5581,
      "lng": -90.7322,
      "distanciaLineaRectaMetros": 95,
      "tarifa": {
        "referencial": true,
        "importeUsd": 24,
        "importeUsdCentavos": 2400,
        "importe": 183.6,
        "importeCentavos": 18360,
        "moneda": "GTQ",
        "unidad": "habitacion_noche",
        "noches": 1,
        "campo": "total_rate",
        "fuente": { "tipo": "resumen_propiedad" },
        "impuestos": { "estado": "informado", "importeAntesImpuestosUsd": 21, "impuestosYCargosUsd": 3 }
      }
    }
  ],
  "motivo": null,
  "mensaje": null
}
```

| Campo | Significado |
| --- | --- |
| `estancia` | Fechas y ocupación consultadas: una noche, adultos y `ninos: 0` |
| `presupuestoDiario`, `presupuestoHospedaje` | En quetzales; los campos `...Centavos` son los valores exactos usados en la comparación |
| `centro` | Centro usado para filtrar y medir, redondeado a 7 decimales; `null` si no se calculó |
| `busqueda` | Consulta hecha a SerpApi, cuándo se hizo (`consultadoEn`, que se conserva si viene de caché), si viene de caché, cuántos resultados llegaron, cuántos son hoteles con precio utilizable, cuántos quedan dentro del radio y si SerpApi informó más páginas; `null` si no se consultó |
| `tipoCambio` | Tasa usada, proveedor, fecha de actualización de origen, próxima actualización y cuándo la obtuvo el backend; `null` si no fue necesaria |
| `hoteles[].tarifa` | Precio referencial en USD y convertido a GTQ (también en centavos), `referencial: true`, campo y fuente de la que se tomó el precio y tratamiento de impuestos |
| `hoteles` | Recomendaciones ordenadas de la más cercana a la más lejana |
| `motivo`, `mensaje` | `null` si hay recomendaciones; si la lista está vacía, el motivo explícito |

La respuesta no incluye el JSON del proveedor, enlaces de SerpApi (`serpapi_property_details_link`, `serpapi_pagination.next`) ni URLs con claves.

### Respuestas vacías

Todas responden `200` con `hoteles: []`:

| `motivo` | Cuándo | SerpApi | ExchangeRate-API |
| --- | --- | --- | --- |
| `hospedaje_reservado` | `hospedaje: true` (prevalece sobre `sinHotel`) | No | No |
| `no_necesita_hotel` | `sinHotel: true` | No | No |
| `itinerario_sin_paradas` | `paradas` vacía; `centro` es `null` | No | No |
| `sin_hoteles_encontrados` | La búsqueda fue exitosa pero no devolvió resultados | Sí (o caché) | No |
| `sin_hoteles_con_precio` | Llegaron resultados, pero ninguno es un hotel con identificador, nombre, coordenadas y precio utilizables | Sí (o caché) | No |
| `sin_hoteles_en_radio` | Hay hoteles con precio, pero ninguno dentro de `radio` | Sí (o caché) | No |
| `sin_hoteles_en_presupuesto` | Hay hoteles dentro del radio, pero ninguno con importe convertido dentro del presupuesto de hospedaje | Sí (o caché) | Sí (o caché) |

```json
{ "fecha": "2026-11-20", "destino": "Antigua Guatemala", "moneda": "GTQ", "ocupacion": 2, "estancia": { "entrada": "2026-11-20", "salida": "2026-11-21", "noches": 1, "adultos": 2, "ninos": 0 }, "presupuestoDiario": 500, "presupuestoDiarioCentavos": 50000, "porcentajeHospedaje": 40, "presupuestoHospedaje": 200, "presupuestoHospedajeCentavos": 20000, "centro": null, "metodoDistancia": "linea_recta", "busqueda": null, "tipoCambio": null, "hoteles": [], "motivo": "hospedaje_reservado", "mensaje": "El usuario ya tiene hospedaje reservado; no se generan recomendaciones de hoteles." }
```

### Errores

Usan el formato común `{ "error": { "codigo", "mensaje", "detalles"? } }`. El mensaje indica qué proveedor falló (SerpApi o ExchangeRate-API) y nunca incluye claves, URLs autenticadas ni el cuerpo de error del proveedor.

| HTTP | Código | Situación |
| --- | --- | --- |
| 400 | `PARAMETRO_INVALIDO` | JSON mal formado o de más de 32 KB, campos ausentes, de otro tipo, no finitos o fuera de rango (incluye `detalles` por campo) |
| 503 | `SERVICIO_NO_CONFIGURADO` | Falta `SERPAPI_API_KEY` o `EXCHANGERATE_API_KEY` y la solicitud necesita consultar hoteles |
| 502 | `PROVEEDOR_CREDENCIALES_INVALIDAS` | El proveedor rechazó la clave del servidor (SerpApi `401`/`403` o mensaje de clave inválida; ExchangeRate-API `invalid-key` o `inactive-account`). Es un problema de configuración del servidor, **no** de la sesión del usuario |
| 503 | `PROVEEDOR_LIMITE_SOLICITUDES` | Cuota agotada o límite de solicitudes (SerpApi `429` o «run out of searches»; ExchangeRate-API `quota-reached` o `429`) |
| 502 | `PROVEEDOR_NO_DISPONIBLE` | Fallo de red al conectar o al leer la respuesta |
| 502 | `PROVEEDOR_RESPUESTA_INVALIDA` | Respuesta que no es JSON, demasiado grande, con estructura inesperada, sin tasa GTQ válida, con fechas incoherentes o con una tasa de más de 36 horas |
| 502 | `PROVEEDOR_ERROR` | Otro estado HTTP de error o `search_metadata.status: "Error"` |
| 504 | `PROVEEDOR_TIEMPO_AGOTADO` | Se agotó el tiempo de espera; la petición se cancela |

Un fallo de un proveedor nunca se presenta como una búsqueda sin resultados ni se sustituye por una tasa fija.

### Cambios respecto a la implementación anterior

La versión anterior de GUI-61 buscaba hoteles en Geoapify (`accommodation.hotel`) y los relacionaba por `place_id` con tarifas cargadas manualmente en `backend/data/tarifas-hoteles.json`, seleccionadas por vigencia y verificación manual. Ese enfoque se **sustituyó por completo**; no hay dos implementaciones activas ni un segundo endpoint.

| Antes | Ahora |
| --- | --- |
| Hoteles de Geoapify Places | Hoteles de SerpApi Google Hotels (una página) |
| Tarifas manuales en GTQ del catálogo JSON, por vigencia | Precio referencial estructurado de Google Hotels en USD, convertido a GTQ con ExchangeRate-API |
| `impuestosIncluidos: true` obligatorio | `impuestos.estado` `informado` o `no_informado` |
| `verificadoEn`, `vigencia` y fuente manual | `busqueda.consultadoEn`, `tarifa.campo` y `tarifa.fuente` del proveedor |
| Radio aplicado por Geoapify | Radio y cercanía aplicados en el backend |
| Sin caché | Caché de búsquedas (15 min, 100 entradas) y de la tasa (hasta la siguiente actualización, máximo 36 h) |
| Motivos `catalogo_vacio`, `sin_tarifas_aplicables`, `sin_hoteles_elegibles` | Motivos `sin_hoteles_con_precio`, `sin_hoteles_en_radio`, `sin_hoteles_en_presupuesto` |

Archivos retirados: `backend/data/tarifas-hoteles.json` y `backend/src/hoteles/catalogo.ts` (no tenían otros consumidores). Se conservan y reutilizan `src/hoteles/geografia.ts` (centro y distancia), el cálculo en centavos y la regla del 40 % de `src/hoteles/tarifas.ts`, la validación de `src/validacion/hoteles.ts` y sus pruebas. El cliente, la clave y las categorías de Geoapify siguen igual para las demás rutas.

### Ejemplos en PowerShell

Con el servidor iniciado (`npm run dev` o `npm start`) desde `backend/`. El cuerpo se envía como bytes UTF-8 para que los acentos del destino lleguen bien también en Windows PowerShell 5.1.

**Salida temprana, sin consumo** (no llama a ningún proveedor ni necesita sus claves):

```powershell
$base = @{
  fecha = "2026-11-20"
  destino = "Antigua Guatemala"
  paradas = @(
    @{ lat = 14.5586; lng = -90.7295 },
    @{ lat = 14.5562; lng = -90.7339 }
  )
  presupuestoDiario = 500
  moneda = "GTQ"
  ocupacion = 2
  hospedaje = $true
}
$cuerpo = [System.Text.Encoding]::UTF8.GetBytes(($base | ConvertTo-Json -Depth 4))
$r = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/hoteles/recomendaciones" -ContentType "application/json; charset=utf-8" -Body $cuerpo
"motivo: $($r.motivo)  salida: $($r.estancia.salida)  límite de hospedaje: Q$($r.presupuestoHospedaje)"
```

**Consulta integrada** (consume 1 búsqueda de SerpApi si no está en caché y, como máximo, 1 solicitud de ExchangeRate-API si la tasa no está vigente). Usa una fecha futura:

```powershell
$base.hospedaje = $false
$base.limite = 5
$cuerpo = [System.Text.Encoding]::UTF8.GetBytes(($base | ConvertTo-Json -Depth 4))
$r = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/hoteles/recomendaciones" -ContentType "application/json; charset=utf-8" -Body $cuerpo
"motivo: $($r.motivo)  límite: Q$($r.presupuestoHospedaje)  tasa: $($r.tipoCambio.tasa) (actualizada $($r.tipoCambio.actualizadoEn))"
"resultados: $($r.busqueda.resultadosRecibidos)  con precio: $($r.busqueda.hotelesConPrecio)  en radio: $($r.busqueda.hotelesEnRadio)  más páginas: $($r.busqueda.hayMasPaginas)  desde caché: $($r.busqueda.desdeCache)"
$r.hoteles | Format-Table nombre, distanciaLineaRectaMetros, @{ n = "USD"; e = { $_.tarifa.importeUsd } }, @{ n = "GTQ"; e = { $_.tarifa.importe } }, @{ n = "campo"; e = { $_.tarifa.campo } }, @{ n = "impuestos"; e = { $_.tarifa.impuestos.estado } } -Wrap
```

Repetir la misma consulta antes de 15 minutos debe mostrar `desde caché: True` con el mismo `consultadoEn` y sin consumir otra búsqueda.

**Comprobación directa de ExchangeRate-API** sin imprimir la clave (consume 1 solicitud de la cuota):

```powershell
$clave = (Select-String -Path .env -Pattern '^EXCHANGERATE_API_KEY=(.+)$').Matches[0].Groups[1].Value.Trim()
$t = Invoke-RestMethod -Uri "https://v6.exchangerate-api.com/v6/$clave/latest/USD"
Remove-Variable clave
"result: $($t.result)  base: $($t.base_code)  GTQ: $($t.conversion_rates.GTQ)  actualizada: $($t.time_last_update_utc)  siguiente: $($t.time_next_update_utc)"
```

Para ver el cuerpo de un error (`400`, `502`, `503` o `504`), usa `try { ... } catch { $_.ErrorDetails.Message }`.

### Limitaciones

- **Precio referencial.** Puede estar redondeado, cambiar después de la consulta o diferir del cargo final. No hay disponibilidad, reservas ni pagos.
- **Una página de resultados.** No representa todos los hoteles del destino; `hayMasPaginas` informa si había más, pero no se consultan.
- **Solo una noche, una habitación, adultos y GTQ.** Sin menores, combinaciones de habitaciones ni estancias de varias noches.
- **`destino` lo aporta el cliente.** Si no coincide con la zona de las paradas, la búsqueda puede devolver hoteles fuera del radio (`sin_hoteles_en_radio`).
- **Impuestos.** Cuando SerpApi no los desglosa, se informa `no_informado`; el backend no puede determinar si están incluidos.
- **Cachés por proceso.** No se comparten entre instancias, se pierden al reiniciar y no garantizan una cuota global.
- La cercanía es en línea recta respecto al centro de las paradas del día, no por carretera.
- El frontend sigue mostrando sus propias recomendaciones de ejemplo y no llama a este endpoint.

### Verificaciones con servicios reales pendientes

Las pruebas automáticas simulan ambos proveedores y no usan claves reales ni consumen cuotas.

- **SerpApi:** una prueba manual previa, fuera de este endpoint, mostró un hotel de Guatemala con precio total e importe antes de impuestos diferenciados. Eso **no** valida el endpoint integrado: falta ejecutar la consulta integrada de arriba con una clave real y revisar la normalización, el radio, el orden y `hayMasPaginas` con datos reales.
- **ExchangeRate-API:** la consulta real sigue **pendiente**. Falta comprobar con una clave real que la respuesta tenga `result: "success"`, `base_code: "USD"`, `conversion_rates.GTQ` y las fechas Unix esperadas, y que el endpoint la acepte.
- Falta comprobar con claves reales los errores de clave inválida y de cuota agotada de ambos proveedores (solo se probaron con respuestas simuladas según su documentación).

## Endpoint `POST /api/restaurantes/recomendaciones`

Recomienda restaurantes cercanos a **cada parada** del itinerario de un día cuyo costo referencial de **una comida principal** para el grupo no supera el 30 % del presupuesto diario. Los establecimientos provienen de [Geoapify Places API](https://apidocs.geoapify.com/docs/places/) y los precios, de un catálogo propio de rangos estadísticos en quetzales construido con fuentes públicas (Numbeo y Preciosmundi). No reserva, no cobra, no hace pedidos, no guarda nada y el frontend todavía no lo consume.

> **Los precios son referenciales.** Ningún restaurante publica su precio a través de Geoapify. Cada establecimiento recibe un **rango de mercado** según su categoría, no su menú. El filtro garantiza que el **costo referencial máximo** del grupo no supera el presupuesto de alimentación; no garantiza el importe real de la cuenta.

### Flujo

1. Se valida el cuerpo (`src/validacion/restaurantes.ts`). Cualquier error responde `400` antes de consultar a Geoapify.
2. Se calcula el presupuesto de alimentación (30 % del diario) en centavos (`src/restaurantes/tarifas.ts`).
3. Si `paradas` está vacía, responde `200` con `motivo: "itinerario_sin_paradas"` sin consultar al proveedor.
4. Se agrupan las paradas con las mismas coordenadas (7 decimales): cada grupo hace **una sola** búsqueda.
5. Por cada parada se consulta Geoapify con **esa parada como centro** (`circle:lng,lat,radio` y `bias=proximity`). No se usa un centro común del día ni del destino.
6. Los resultados se normalizan con el mismo `transformarLugares` de `GET /api/lugares` (se descartan registros sin identificador, nombre, coordenadas válidas o categorías, y los repetidos dentro de la misma parada).
7. Se mide la distancia en línea recta a la parada y se descartan los que quedan fuera del radio.
8. Se asigna una tarifa referencial según la categoría y el país (`src/restaurantes/catalogo.ts`). Si no hay una referencia sustentada, el restaurante queda como `sin_estimacion`.
9. Se calcula el costo referencial del grupo y se separan los elegibles de los excluidos por presupuesto.
10. Se ordena por cercanía (empates por `idExterno`) y se aplica `limite` por parada al final.

Un mismo restaurante puede aparecer en varias paradas si está dentro del radio de cada una; en cada parada lleva su propia distancia. Las paradas de la respuesta conservan exactamente el orden recibido.

### Solicitud

```json
{
  "fecha": "2026-11-20",
  "paradas": [
    { "id": "catedral", "lat": 14.5586, "lng": -90.7295 },
    { "id": "arco", "lat": 14.5609, "lng": -90.7343 }
  ],
  "presupuestoDiario": 500,
  "moneda": "GTQ",
  "comensales": 2,
  "radio": 2000,
  "limite": 10
}
```

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `fecha` | No | Fecha real `AAAA-MM-DD` del día del itinerario. Solo se devuelve en la respuesta: no cambia la búsqueda ni los precios |
| `paradas` | Sí | Lista de 0 a 25 objetos `{ id, lat, lng }` con las paradas **de ese día** (`MAX_PARADAS_DIA`, el mismo límite de hoteles). `id` es un texto de 1 a 100 caracteres sin caracteres de control, se recortan los espacios y no puede repetirse. `lat` entre -90 y 90 y `lng` entre -180 y 180, números JSON finitos (se acepta `0`) |
| `presupuestoDiario` | Sí | Presupuesto diario total en quetzales. Mayor que 0, como máximo 1 000 000, con hasta dos decimales |
| `moneda` | Sí | Solo `"GTQ"` |
| `comensales` | Sí | Entero de 1 a 10: personas que comerán. Es un campo propio; **no** se deduce de la ocupación del hotel |
| `radio` | No | Entero de 1 a 10000 metros alrededor de **cada** parada. Por defecto `2000` |
| `limite` | No | Entero de 1 a 20: recomendaciones máximas **por parada**. Por defecto `10` |

- El cuerpo debe ser un objeto JSON de hasta 32 KB. Los campos desconocidos se ignoran: un `porcentajeAlimentacion` enviado por el cliente no cambia el cálculo.
- Los errores responden `400 PARAMETRO_INVALIDO` con `detalles` por campo (por ejemplo `paradas.1.id` si un identificador se repite).
- El contrato TypeScript está en `shared/types/restaurante.ts` (`SolicitudRecomendacionesRestaurantes`, `RespuestaRecomendacionesRestaurantes`, `ResultadoParadaRestaurantes`, `RestauranteRecomendado`, `RestauranteSinEstimacion`, `TarifaReferencialRestaurante`, etc.).

### Presupuesto: regla del 30 % y comensales

```
presupuestoAlimentacion = presupuestoDiario × 0.30
costoReferencialGrupo   = precioMaximoReferencialPorPersona × comensales
elegible                = costoReferencialGrupo <= presupuestoAlimentacion
```

- El porcentaje es fijo (`PORCENTAJE_ALIMENTACION` en `src/restaurantes/tarifas.ts`). Todo se calcula en centavos enteros: `floor(presupuestoDiarioCentavos × 30 / 100)`, redondeando hacia abajo como en hoteles para no superar el porcentaje.
- **Es una asignación independiente** del 40 % de hospedaje (`PORCENTAJE_HOSPEDAJE`, sin cambios). Ambos son límites de planificación sobre el mismo presupuesto diario; el backend no descuenta el costo de un hotel como si ya se hubiera pagado.
- **Una comida principal por día.** Las recomendaciones de todas las paradas son alternativas para la **misma** comida: cada restaurante se compara solo contra el límite diario y no se suman los costos de los restaurantes recomendados ni se presupuesta una comida por parada. No se distingue desayuno, almuerzo y cena.
- Se evalúa con el **máximo** del rango (criterio conservador). El costo del grupo se compara contra el presupuesto total de alimentación; `presupuestoPorPersona` es informativo.

| Presupuesto diario | Alimentación | Comensales | Perfil | Máximo por persona | Costo del grupo | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| Q500.00 | Q150.00 | 2 | Comida rápida | Q70 | Q140.00 | Elegible |
| Q500.00 | Q150.00 | 2 | Patio de comidas | Q100 | Q200.00 | Excluido |
| Q500.00 | Q150.00 | 1 | Patio de comidas | Q100 | Q100.00 | Elegible |
| Q1000.00 | Q300.00 | 1 | Restaurante general | Q300 | Q300.00 | Elegible (igual al límite) |
| Q466.67 | Q140.00 | 2 | Comida rápida | Q70 | Q140.00 | Elegible (igual al límite) |
| Q466.66 | Q139.99 | 2 | Comida rápida | Q70 | Q140.00 | Excluido (un centavo por encima) |

### Tarifas referenciales

**Fuentes** (consultadas el 2026-10-18; Numbeo indica su última actualización el 2 de octubre de 2026 y Preciosmundi, julio de 2026):

| Fuente | Indicador | Valor publicado |
| --- | --- | --- |
| [Numbeo — Guatemala](https://www.numbeo.com/cost-of-living/country_result.jsp?country=Guatemala) | Meal at an Inexpensive Restaurant | Q30.00–Q100.00 por persona (promedio Q60.00) |
| Numbeo — Guatemala | Combo Meal at McDonald's (or Equivalent Fast-Food Meal) | Q55.00–Q70.00 (promedio Q60.61) |
| Numbeo — Guatemala | Meal for Two at a Mid-Range Restaurant (Three Courses, Without Drinks) | Q300.00–Q600.00 para dos (promedio Q384.09) |
| [Numbeo — Ciudad de Guatemala](https://www.numbeo.com/cost-of-living/in/Guatemala-City) | Combo Meal at McDonald's (or Equivalent Fast-Food Meal) | Q50.00–Q70.00 (promedio Q60.00) |
| [Preciosmundi — Guatemala](https://preciosmundi.com/guatemala/precio-restaurantes) | Menú de McDonalds, Burger King o similar / comida en restaurante barato | ≈ Q59.94 por persona |
| Preciosmundi — Guatemala | Comida para dos en restaurante a la carta | ≈ Q400 para dos |

Los valores de Preciosmundi quedan dentro de los rangos de Numbeo, por lo que se usan como contraste y no amplían los rangos. Estas estadísticas son agregados de colaboradores; **no** son el menú de ningún establecimiento.

**Catálogo** (`CATALOGO_TARIFAS_RESTAURANTES` en `src/restaurantes/catalogo.ts`; región: Guatemala, código de país `gt`):

| Referencia | Categoría de Geoapify | Rango por persona | Aplicabilidad | Confianza | Criterio |
| --- | --- | --- | --- | --- | --- |
| `gt-comida-rapida` | `catering.fast_food` y subcategorías | Q50–Q70 | `perfil_correspondiente` | media | La categoría es venta de comida rápida en mostrador, el mismo producto que mide el indicador de combo |
| `gt-patio-comidas` | `catering.food_court` | Q30–Q100 | `escenario_general` | baja | Un patio agrupa locales de mostrador que no se identifican uno a uno; se combinan el rango de comida rápida y el de restaurante económico |
| `gt-restaurante-general` | `catering.restaurant` y subcategorías | Q30–Q300 | `escenario_general` | baja | La categoría **no** indica el nivel de precios: se usa el rango desde un restaurante económico (Q30) hasta uno de gama media (Q600 para dos = Q300 por persona) |

- **No se clasifica a ningún restaurante como económico** por su categoría, subcategoría de cocina (`catering.restaurant.tacos`, `…pizza`, etc.) ni por su nombre. El rango «restaurante económico» Q30–Q100 de las referencias preliminares se usa como límite inferior del escenario general y como parte del patio de comidas, pero no se asigna por sí solo a `catering.restaurant`. Con el máximo de Q300 por persona, un restaurante genérico solo es elegible cuando el presupuesto de alimentación cubre ese escenario.
- Si un lugar tiene categorías de varios perfiles, se usa el de **máximo más alto** para no subestimar el costo.
- **`sin_estimacion`.** Un establecimiento recibe este estado (y aparece en `sinEstimacion`, nunca en `restaurantes`) si su categoría no tiene referencia (`categoria_sin_referencia`), si Geoapify indica un país distinto de Guatemala (`region_no_cubierta`) o si no indica el país (`region_no_identificada`).
- **Integridad.** `validarCatalogo` exige identificadores únicos, rangos en centavos enteros positivos con mínimo ≤ máximo, moneda `GTQ`, unidad `persona_comida`, región con códigos de país, alcance descrito, al menos una fuente `https` con fecha de consulta `AAAA-MM-DD` y reglas que apunten a referencias existentes. La aplicación no inicia si el catálogo es inválido.
- **Actualizar los precios** solo requiere editar el catálogo (rangos, fuentes y `CONSULTADO_EN`); la lógica de recomendaciones no cambia. No se usan tablas de Prisma.
- Se excluyen a propósito `catering.cafe`, `catering.bar`, `catering.pub`, `catering.ice_cream` y similares: no representan una comida principal.

### Consulta a Geoapify y consumo

Se reutiliza el cliente de `src/geoapify/cliente.ts` (`crearConsultaPlaces`): la misma clave `GEOAPIFY_API_KEY`, el tiempo de espera de 10 segundos y la traducción de errores de `GET /api/lugares`, cuyo comportamiento no cambia.

| Parámetro | Valor |
| --- | --- |
| `categories` | `catering.restaurant,catering.fast_food,catering.food_court` |
| `filter` | `circle:<lng>,<lat>,<radio>` de la parada |
| `bias` | `proximity:<lng>,<lat>` de la parada |
| `limit` | `40` (`RESULTADOS_PROVEEDOR_POR_PARADA` en `src/restaurantes/busqueda.ts`) |
| `lang` | `es` |

| Límite | Valor | Constante |
| --- | --- | --- |
| Paradas por solicitud | 25 | `MAX_PARADAS_RESTAURANTES` |
| Resultados pedidos por parada | 40 (2 créditos: Geoapify cobra 1 crédito por cada 20 lugares) | `RESULTADOS_PROVEEDOR_POR_PARADA` |
| Búsquedas simultáneas | 2 | `CONCURRENCIA_BUSQUEDAS` en `src/restaurantes/recomendaciones.ts` |
| Separación entre inicios | 250 ms (como máximo 4 por segundo, bajo el límite de 5 del plan gratuito) | `INTERVALO_BUSQUEDAS_MS` |
| Radio | 1 a 10000 m, por defecto 2000 | `RADIO_MAXIMO_RESTAURANTES` |
| Recomendaciones por parada | 1 a 20, por defecto 10 | `LIMITE_MAXIMO_RESTAURANTES` |
| Cuerpo de la solicitud | 32 KB | `LIMITE_CUERPO_BYTES` en `src/routes/restaurantes.ts` |

- **Consumo máximo:** 25 paradas distintas × 2 créditos = 50 créditos por solicitud. Las paradas con las mismas coordenadas comparten una búsqueda (`busqueda.busquedaCompartida: true`). No se consultan detalles de cada lugar (Place Details) ni otros proveedores de precios.
- **Resultados limitados antes del filtro.** Geoapify entrega como máximo 40 lugares por parada, ordenados por cercanía, **antes** de aplicar el presupuesto. Si la zona tiene más, no se revisan todos: `busqueda.posiblesResultadosAdicionales` vale `true` cuando se recibió el máximo. Una parada sin elegibles no demuestra que no exista ningún restaurante dentro del presupuesto en la zona.
- No hay caché entre solicitudes ni reintentos automáticos. El ritmo de 4 búsquedas por segundo es por solicitud: varias solicitudes simultáneas al backend no comparten ese control.

### Respuesta (200)

Ejemplo ilustrativo con datos **ficticios** (el restaurante, su identificador y su dirección no son reales; el rango sí es el del catálogo):

```json
{
  "fecha": "2026-11-20",
  "moneda": "GTQ",
  "presupuestoDiario": 500,
  "presupuestoDiarioCentavos": 50000,
  "porcentajeAlimentacion": 30,
  "presupuestoAlimentacion": 150,
  "presupuestoAlimentacionCentavos": 15000,
  "comensales": 2,
  "presupuestoPorPersona": 75,
  "presupuestoPorPersonaCentavos": 7500,
  "comidasPresupuestadas": 1,
  "metodoDistancia": "linea_recta",
  "radioMetros": 2000,
  "limitePorParada": 10,
  "preciosReferenciales": {
    "referencial": true,
    "precioConfirmado": false,
    "moneda": "GTQ",
    "unidad": "persona_comida",
    "criterioEvaluacion": "maximo_del_rango",
    "consultadoEn": "2026-10-18",
    "fuentes": [{ "nombre": "Numbeo — Cost of Living in Guatemala City", "url": "https://www.numbeo.com/cost-of-living/in/Guatemala-City" }],
    "aviso": "Los importes son rangos referenciales de mercado en GTQ…"
  },
  "paradas": [
    {
      "id": "catedral",
      "lat": 14.5586,
      "lng": -90.7295,
      "estado": "procesada",
      "restaurantesEncontrados": 12,
      "recomendacionesElegibles": 3,
      "restaurantes": [
        {
          "idExterno": "51ficticio…",
          "proveedor": "geoapify",
          "nombre": "Comida rápida de ejemplo",
          "direccion": "4a Calle Oriente, Antigua Guatemala",
          "lat": 14.5592,
          "lng": -90.7301,
          "categorias": ["catering", "catering.fast_food"],
          "distanciaLineaRectaMetros": 92,
          "estimacion": "estimado",
          "tarifaReferencial": {
            "referencial": true,
            "precioConfirmado": false,
            "referenciaId": "gt-comida-rapida",
            "perfil": "comida_rapida",
            "aplicabilidad": "perfil_correspondiente",
            "confianza": "media",
            "region": "Guatemala",
            "moneda": "GTQ",
            "unidad": "persona_comida",
            "minimo": 50,
            "minimoCentavos": 5000,
            "maximo": 70,
            "maximoCentavos": 7000,
            "criterioEvaluacion": "maximo_del_rango",
            "valorEvaluacion": 70,
            "valorEvaluacionCentavos": 7000,
            "alcance": "Combo de comida rápida (tipo McDonald's o equivalente) para una persona…",
            "fuentes": [{ "nombre": "Numbeo — Cost of Living in Guatemala City", "url": "https://www.numbeo.com/cost-of-living/in/Guatemala-City", "indicador": "Combo Meal at McDonald's (or Equivalent Fast-Food Meal)", "consultadoEn": "2026-10-18" }]
          },
          "costoReferencialGrupo": { "comensales": 2, "importe": 140, "importeCentavos": 14000, "moneda": "GTQ" },
          "elegiblePorPresupuesto": true
        }
      ],
      "sinEstimacion": [],
      "busqueda": {
        "proveedor": "geoapify",
        "categorias": ["catering.restaurant", "catering.fast_food", "catering.food_court"],
        "radioMetros": 2000,
        "limiteProveedor": 40,
        "resultadosProveedor": 12,
        "resultadosDescartados": 0,
        "fueraDeRadio": 0,
        "sinEstimacion": 0,
        "excluidosPorPresupuesto": 9,
        "posiblesResultadosAdicionales": false,
        "busquedaCompartida": false
      },
      "motivo": null,
      "mensaje": null,
      "error": null
    }
  ],
  "resumen": { "paradasSolicitadas": 1, "paradasProcesadas": 1, "paradasFallidas": 0, "busquedasIntentadas": 1, "busquedasOmitidas": 0, "completo": true },
  "motivo": null,
  "mensaje": null
}
```

| Campo | Significado |
| --- | --- |
| `presupuestoAlimentacion` | 30 % del presupuesto diario; los campos `…Centavos` son los valores exactos de la comparación |
| `paradas[].restaurantesEncontrados` | Restaurantes válidos dentro del radio de esa parada (con o sin estimación) |
| `paradas[].recomendacionesElegibles` | Elegibles por presupuesto antes de aplicar `limite` |
| `paradas[].restaurantes` | Solo los elegibles, del más cercano al más lejano, hasta `limite` |
| `paradas[].sinEstimacion` | Establecimientos cercanos sin tarifa sustentada, separados y con `elegiblePorPresupuesto: false`, hasta `limite` |
| `paradas[].busqueda` | Qué se pidió a Geoapify y cuántos resultados se descartaron, quedaron fuera del radio, sin estimación o fuera de presupuesto |
| `distanciaLineaRectaMetros` | Distancia Haversine (6 371 km) entre la parada y el restaurante, redondeada al metro solo al devolverla. **No es distancia caminando ni por calles** |
| `tarifaReferencial` | Rango, valor usado para filtrar (`valorEvaluacion` = máximo), moneda, unidad, fuentes, aplicabilidad, confianza y `precioConfirmado: false` |
| `resumen.completo` | `false` si alguna parada falló |

**Motivos por parada** (`motivo` es `null` si hay recomendaciones):

| `motivo` | Cuándo |
| --- | --- |
| `sin_restaurantes_encontrados` | La búsqueda fue exitosa, pero no devolvió establecimientos utilizables |
| `sin_restaurantes_en_radio` | Todos los devueltos quedan fuera del radio |
| `sin_tarifas_aplicables` | Hay restaurantes dentro del radio, pero ninguno tiene tarifa sustentada (todos en `sinEstimacion`) |
| `sin_restaurantes_en_presupuesto` | Hay restaurantes con tarifa, pero el costo referencial del grupo supera el presupuesto de alimentación |
| `busqueda_fallida` | Fallo técnico del proveedor en esa parada (`estado: "fallida"`, con `error`). **No significa que no haya restaurantes** |

### Errores y fallos parciales

- Si **todas** las paradas fallan, la solicitud responde con el error del proveedor (mismos códigos que `GET /api/lugares`): nunca se presenta como una lista vacía.
- Si fallan **algunas**, responde `200`: las paradas fallidas tienen `estado: "fallida"`, `restaurantes: []`, `restaurantesEncontrados: null` y `error: { codigo, mensaje, consultada }`, y `resumen.completo` es `false`.
- Si Geoapify rechaza la clave o informa el límite de solicitudes, no se inician las búsquedas pendientes: esas paradas quedan con `consultada: false` y el mismo código de error.

| HTTP | Código | Situación |
| --- | --- | --- |
| 400 | `PARAMETRO_INVALIDO` | JSON mal formado o de más de 32 KB, campos ausentes, de otro tipo, fuera de rango, ids repetidos (incluye `detalles`) |
| 500 | `SERVICIO_NO_CONFIGURADO` | La aplicación se creó sin `GEOAPIFY_API_KEY` (el servidor no inicia sin ella) |
| 502 | `PROVEEDOR_CREDENCIALES_INVALIDAS` | Geoapify rechazó la clave (`401`/`403`) |
| 503 | `PROVEEDOR_LIMITE_SOLICITUDES` | Geoapify respondió `429` |
| 502 | `PROVEEDOR_ERROR` / `PROVEEDOR_NO_DISPONIBLE` | Otro error HTTP o fallo de red |
| 502 | `PROVEEDOR_RESPUESTA_INVALIDA` | Respuesta no JSON o sin `features` |
| 504 | `PROVEEDOR_TIEMPO_AGOTADO` | Geoapify no respondió en 10 segundos |

### Ejemplo en PowerShell

Consume hasta 2 créditos de Geoapify por parada distinta (aquí, 4 créditos). La clave no se envía en la petición:

```powershell
$cuerpo = @{
  fecha = "2026-11-20"
  paradas = @(
    @{ id = "catedral"; lat = 14.5586; lng = -90.7295 },
    @{ id = "arco"; lat = 14.5609; lng = -90.7343 }
  )
  presupuestoDiario = 500
  moneda = "GTQ"
  comensales = 2
  limite = 5
}
$bytes = [System.Text.Encoding]::UTF8.GetBytes(($cuerpo | ConvertTo-Json -Depth 4))
$r = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/restaurantes/recomendaciones" -ContentType "application/json; charset=utf-8" -Body $bytes
"alimentación: Q$($r.presupuestoAlimentacion) para $($r.comensales) comensales  completo: $($r.resumen.completo)"
foreach ($p in $r.paradas) {
  "--- $($p.id): $($p.estado)  encontrados: $($p.restaurantesEncontrados)  elegibles: $($p.recomendacionesElegibles)  motivo: $($p.motivo)"
  $p.restaurantes | Format-Table nombre, distanciaLineaRectaMetros, @{ n = "perfil"; e = { $_.tarifaReferencial.perfil } }, @{ n = "máx. p/p"; e = { $_.tarifaReferencial.maximo } }, @{ n = "grupo"; e = { $_.costoReferencialGrupo.importe } } -Wrap
}
```

### Limitaciones

- **Precios estadísticos, no del establecimiento.** Geoapify (OpenStreetMap) no publica precios. Los rangos son agregados de colaboradores de Numbeo y Preciosmundi y pueden cambiar; deben revisarse periódicamente y actualizarse en el catálogo.
- **Clasificación por categoría.** La calidad depende de la categoría que OpenStreetMap asigna a cada lugar. El escenario general de restaurante (hasta Q300 por persona) es conservador: excluye restaurantes económicos que no pueden identificarse como tales y no cubre restaurantes de alta gama.
- **Cobertura geográfica.** El catálogo solo aplica a Guatemala (`country_code: "gt"` de Geoapify) y no distingue entre ciudades o zonas turísticas, aunque los precios de Antigua o de la Ciudad de Guatemala pueden ser más altos que el promedio nacional.
- **Resultados limitados** a 40 por parada antes del filtro de presupuesto; tampoco se verifican horarios de apertura ni disponibilidad.
- **Distancia en línea recta**, no a pie ni por calles. Integrar Valhalla es una mejora posible, fuera de esta historia.
- **Sin caché** entre solicitudes; una caché temporal por coordenadas y radio sería una mejora posible.
- Una sola comida principal por día: no se gestionan desayuno, almuerzo y cena ni bebidas, propinas o cargos por servicio.

### Verificaciones con servicios reales pendientes

Las pruebas automáticas (`test/restaurantes.test.ts` y `test/restaurantesCalculos.test.ts`) simulan Geoapify y no consumen créditos.

Verificación manual del 2026-10-18 con la clave real (3 créditos en total):

- Una consulta directa a Places alrededor de la Catedral de Antigua Guatemala (`limit=5`) devolvió los 5 lugares con `country_code: "gt"` y categorías jerárquicas (por ejemplo `catering.fast_food.pizza` o `catering.restaurant.regional`, a veces con `building.catering`).
- Una solicitud integrada al endpoint con esa parada, Q500 y 2 comensales respondió `200`: 40 restaurantes dentro de 2000 m (`posiblesResultadosAdicionales: true`), 2 de comida rápida elegibles (Q140 para el grupo), 38 restaurantes genéricos excluidos por presupuesto (escenario general de Q600 para dos) y ninguno sin estimación. La respuesta no contenía la clave.

Pendiente: comprobar con datos reales los errores de clave inválida y de límite de solicitudes (solo se probaron con respuestas simuladas) y revisar periódicamente los rangos del catálogo.

## Reordenamiento reactivo por clima (GUI-72)

Mientras el usuario recorre el itinerario del día, el backend revisa el clima de la zona y, si detecta lluvia significativa, tormenta o un aumento importante del riesgo **respecto a la revisión anterior**, propone sustituir las visitas exteriores afectadas por alternativas techadas cercanas. La propuesta nunca se aplica sola: el usuario la acepta o la rechaza.

Se reutiliza todo lo existente: el cliente de OpenWeather (ahora también con clima actual), la clasificación `indoor`/`outdoor`, Geoapify Places y Place Details con su concurrencia limitada, la interpretación de horarios de `opening_hours`, el optimizador FastAPI con OR-Tools y la matriz de Valhalla. No hay proveedores nuevos, ni persistencia, ni procesos en segundo plano en el servidor.

### Flujo

1. Mientras el paso 4 está abierto, el día mostrado es **hoy** y quedan paradas pendientes, el frontend llama a `POST /api/itinerarios/clima-reactivo/evaluar` al abrirlo y luego cada 12 minutos (configurable). Al cambiar de día, completar todas las paradas o salir del paso, el monitoreo se detiene.
2. El backend consulta OpenWeather en la **ubicación relevante del recorrido**: la ubicación que el usuario compartió explícitamente (si tiene menos de 30 minutos), si no la parada en curso y, si no, la próxima parada pendiente. Nunca usa el centro del destino.
3. Evalúa el riesgo y lo compara con la `referencia` de la revisión anterior, que el cliente devuelve tal como la recibió.
4. Si hay un empeoramiento relevante (`requierePropuesta: true`), el frontend pide `POST .../propuesta`. El backend vuelve a evaluar con los mismos datos (en caché), calcula con Valhalla el horario estimado de cada parada pendiente, identifica las afectadas, busca alternativas en Geoapify, verifica sus horarios y pide al optimizador el nuevo recorrido.
5. El frontend muestra la propuesta. Al aceptar, llama a `POST .../aceptar`; el backend verifica la firma, la vigencia y que el itinerario no haya cambiado, y devuelve las paradas pendientes nuevas. Al rechazar, no se llama al backend y el itinerario queda igual.

### Clima actual y pronóstico

| Fuente | Endpoint de OpenWeather | Qué aporta | Cómo se usa |
| --- | --- | --- | --- |
| Clima actual | `GET /data/2.5/weather` | Código de condición observado (`weather[].id`), lluvia de la última hora (`rain.1h`), hora de la observación (`dt`) y zona horaria (`timezone`) | Una tormenta o lluvia **observada** se identifica por su código y sus milímetros, nunca por una probabilidad. Se considera vigente durante los 60 minutos siguientes. Si la observación tiene más de 90 minutos, se informa como desactualizada y no se usa para decidir |
| Pronóstico | `GET /data/2.5/forecast` (ya usado por `GET /api/clima/pronostico`) | Intervalos de 3 horas con probabilidad de precipitación (`pop`), código de condición y lluvia acumulada (`rain.3h`) | Solo cuentan los intervalos que se solapan con las próximas 6 horas. Una probabilidad es riesgo, no lluvia observada |

La disponibilidad del clima actual se comprobó con la clave configurada (HTTP 200 con código, `rain.1h` y `timezone`). Las fechas y horas del destino se calculan con el desplazamiento `timezone` que devuelve OpenWeather, no con la zona horaria del servidor. El monitoreo solo se activa si la `fecha` del itinerario coincide con la fecha actual del destino.

### Niveles de riesgo y condiciones que disparan una propuesta

| Nivel | Observado | Pronosticado (intervalo en las próximas 6 h) |
| --- | --- | --- |
| `favorable` | Sin lluvia (códigos 800–804, 6xx, 7xx) | `pop` menor que el umbral sin lluvia |
| `lluvia_ligera` | Llovizna (3xx) o lluvia ligera (500, 520) | `pop` menor que el umbral con código de lluvia |
| `riesgo_elevado` | — | `pop` ≥ umbral (70 %) |
| `lluvia_significativa` | Lluvia moderada o intensa (501–504, 511, 521, 522, 531) o `rain.1h` ≥ 2.5 mm | `pop` ≥ umbral con lluvia moderada o intensa o `rain.3h` ≥ 7.5 mm |
| `tormenta` | Tormenta eléctrica (2xx) | `pop` ≥ umbral con código 2xx |

Si falta `pop`, el intervalo solo cuenta como tormenta (código 2xx) o lluvia significativa (`rain.3h` ≥ 7.5 mm). Los códigos son los [grupos oficiales de OpenWeather](https://openweathermap.org/weather-conditions).

**Disparo y control de duplicados** (`decidir` en `src/clima/reactivo/deteccion.ts`):

- Solo se propone desde `riesgo_elevado` y únicamente si el nivel actual es **mayor** que el de la revisión anterior (sin revisión previa se compara contra `favorable`). Una lluvia que sigue igual no genera propuestas nuevas.
- Cada evento tiene un `eventoId` (nivel, origen, condición y bloque de 3 horas). El mismo evento nunca se propone dos veces.
- Después de una propuesta hay una espera mínima de 30 minutos antes de proponer otra por un riesgo igual o menor al notificado; una tormenta sí se notifica durante la espera si antes solo se notificó lluvia.
- Si no hay datos vigentes de ninguna fuente, el motivo es `datos_insuficientes`: no se asume buen tiempo ni se cambia la referencia.
- La `referencia` la calcula el servidor y el cliente la devuelve sin modificarla. Solo describe niveles ya evaluados por el servidor; la decisión siempre usa datos que el backend consulta a OpenWeather, no clima enviado por el cliente.
- Las solicitudes simultáneas de propuesta para el mismo itinerario y evento comparten una sola ejecución.

### Paradas afectadas

- Las visitas `completada` y `cancelada` no se tocan ni se vuelven a incluir. La visita `en_curso` se conserva, el recorrido parte desde ella y su hora de fin programada (`horaFinProgramada`) marca el inicio.
- La clasificación de cada parada usa, en este orden: `tipo_entorno` y `sensibilidad_clima` enviados por el itinerario, sus `categorias` con las reglas de `src/config/entornoClima.ts`, o la regla por defecto del proyecto (exterior, sensibilidad alta), que se informa como `supuesta`.
- Una parada se considera afectada si es exterior y su horario estimado por Valhalla se solapa con una señal de riesgo: sensibilidad `alta` desde `riesgo_elevado`; `media` solo con `lluvia_significativa` o `tormenta`; `baja` nunca. Las interiores se conservan.
- Se buscan alternativas para las 3 primeras afectadas; las demás se listan con una advertencia.

### Alternativas techadas

- **Categorías** (`CATEGORIAS_ALTERNATIVAS_INTERIORES`): `entertainment.museum`, `entertainment.culture` (incluye galerías, centros de arte y teatros), `entertainment.planetarium` y `entertainment.aquarium`. Además, la regla del proyecto debe clasificarlas como `indoor`. No se proponen restaurantes, hoteles, bares, centros comerciales ni otros lugares solo por ser `indoor`.
- **Búsqueda**: una consulta a Geoapify Places por cada parada afectada, centrada en esa parada, con radio de 2000 m. Solo si no se reúnen 3 candidatos se repite con 5000 m. Se usan hasta 20 resultados por consulta.
- **Filtros**: identificador, nombre, coordenadas y categorías válidas (el mismo `transformarLugares` de `GET /api/lugares`); dentro del radio; que no sea una parada del itinerario, completada o cancelada (mismo `placeId`, a menos de 30 m o con el mismo nombre a menos de 150 m); sin duplicados.
- **Orden**: primero los que coinciden con los intereses del usuario (`CATEGORIAS_POR_INTERES`) y después por cercanía en línea recta, que solo sirve para elegir a qué candidatos consultar el horario.
- **Horarios**: solo se consultan con Place Details los 4 mejores candidatos de cada parada, con la concurrencia y el presupuesto de tiempo existentes. `confirmada` exige un horario publicado e interpretable con una ventana abierta hoy de al menos la duración de la visita (mínimo 30 minutos) a partir de la hora de inicio. `horario_no_confirmado` (no publicado, no interpretable o error de consulta) y `cerrada_en_el_horario` se muestran como información y **nunca se envían al optimizador**.
- **Consumo**: como máximo 6 búsquedas (6 créditos) y 12 consultas de detalles por propuesta; `evaluar` no consume créditos de Geoapify.

### Valhalla y OR-Tools

El backend no calcula traslados: los pide a `POST {OPTIMIZER_URL}/reoptimize-clima` (contrato en [optimizer/API.md](../optimizer/API.md)). El optimizador pide **una sola** matriz de tiempos y distancias a Valhalla con el origen, las paradas pendientes y los candidatos, en el modo `auto` o `pedestrian` del viaje, y evalúa cada combinación sobre submatrices de esa matriz. Si Valhalla no responde o no hay ruta, se devuelve el error correspondiente; nunca se usan distancias en línea recta ni velocidades fijas.

- **Origen**: la ubicación compartida, la parada en curso o la última parada completada. El optimizador lo agrega como nodo 0 sintético (sin estancia, sin horario y fuera del orden devuelto), de modo que calcula el traslado real hasta la primera visita y no reinicia el recorrido desde la primera parada original. Si no hay ninguna ubicación conocida, la primera visita es el punto de partida y se advierte.
- **Hora de inicio**: la hora actual del destino (o el fin de la visita en curso).
- **Selección**: por cada parada afectada se prueba cada candidato confirmado (máximo 3) con OR-Tools y se elige la ruta viable con menor tiempo de traslado. Un lugar no se usa para dos paradas, las no afectadas se conservan y una afectada sin alternativa viable se mantiene, con una advertencia. Son como máximo 3 × 3 + 2 resoluciones.
- **Comparación**: la respuesta incluye la ruta actual (orden sin cambios, con horarios estimados) y la propuesta, con horarios, traslados y distancia por la red vial o peatonal. Si no existe una ruta completa que respete los horarios, la propuesta queda como `sin_solucion_viable` y no se declara viable.

### Endpoints

Todos están bajo `/api/itinerarios/clima-reactivo`, aceptan JSON de hasta 64 KB y usan el formato de errores común. Los contratos TypeScript están en `shared/types/climaReactivo.ts`.

**Solicitud de `evaluar` y `propuesta`:**

```json
{
  "itinerario": {
    "id": "it-1",
    "fecha": "2026-11-20",
    "paradas": [
      { "id": "catedral", "nombre": "Catedral", "lat": 14.5586, "lng": -90.7295, "horaApertura": "08:00", "horaCierre": "18:00", "tiempoEstanciaMinutos": 30, "estado": "completada" },
      { "id": "cerro", "nombre": "Cerro de la Cruz", "lat": 14.5672, "lng": -90.7322, "horaApertura": "06:00", "horaCierre": "18:00", "tiempoEstanciaMinutos": 60, "estado": "pendiente", "categorias": ["tourism.attraction.viewpoint"] }
    ]
  },
  "modoTransporte": "pedestrian",
  "intereses": ["Cultura"],
  "ubicacionActual": { "lat": 14.5590, "lng": -90.7300, "registradaEn": "2026-11-20T16:02:00Z" },
  "referencia": null
}
```

| Campo | Regla |
| --- | --- |
| `itinerario.paradas[].estado` | `completada`, `en_curso` (como máximo una), `pendiente` o `cancelada` |
| `itinerario.paradas[]` | 1 a 25, `id` únicos, coordenadas válidas, horas `HH:MM`; `placeId`, `categorias`, `tipo_entorno`, `sensibilidad_clima` y `horaFinProgramada` son opcionales |
| `modoTransporte` | `auto` (por defecto) o `pedestrian` |
| `intereses` | Opcional; los mismos valores de `GET /api/lugares` |
| `ubicacionActual` | Opcional; solo si el usuario la compartió. Se ignora si tiene más de 30 minutos |
| `referencia` | La que devolvió la revisión anterior, sin cambios; `null` en la primera |

**Respuesta de `evaluar` (200)**: `estado` (`activo`, `itinerario_no_activo` o `sin_paradas_pendientes`), `evaluacion` (fuente, ubicación usada, momento de la consulta, observación, señales del pronóstico, `nivel`, `senalPrincipal`, `eventoId` y umbrales), `requierePropuesta`, `motivo`, `mensaje`, `referencia`, `proximaEvaluacionSegundos` y `advertencias`.

**Respuesta de `propuesta` (200)**: lo mismo más `propuesta` (o `null` si ya no hace falta):

| `propuesta.estado` | Significado | ¿Se puede aceptar? |
| --- | --- | --- |
| `pendiente` | Hay al menos una sustitución y una ruta viable | Sí, con `token` |
| `sin_cambios` | Ninguna parada pendiente coincide con el riesgo | No |
| `sin_alternativas` | No hay alternativas techadas con horario confirmado o ninguna es viable | No |
| `sin_solucion_viable` | Con las alternativas no existe un recorrido completo que respete los horarios | No |

Ejemplo ilustrativo con datos **ficticios** (abreviado):

```json
{
  "id": "6f1c…", "estado": "pendiente", "creadaEn": "2026-11-20T16:05:00.000Z", "venceEn": "2026-11-20T16:25:00.000Z",
  "evento": { "nivel": "tormenta", "senalPrincipal": { "origen": "observado", "condicion": "tormenta", "codigoOpenWeather": 211 } },
  "origen": { "lat": 14.5586, "lng": -90.7295, "fuente": "ultima_parada_completada" },
  "horaInicio": "10:05",
  "paradasAfectadas": [{ "paradaId": "cerro", "nombre": "Cerro de la Cruz", "inicioEstimado": "10:23", "motivo": "Lugar exterior con sensibilidad alta al clima; tormenta eléctrica reportada en la zona…" }],
  "sustituciones": [{ "paradaOriginalId": "cerro", "alternativaId": "51ab…", "alternativaNombre": "Museo de ejemplo", "razon": "… horario confirmado 09:00–17:00 … menor tiempo de traslado según Valhalla (pedestrian)." }],
  "conservadas": [],
  "rutaAnterior": { "orden": ["cerro"], "viable": true, "distanciaKm": 1.54, "trasladoMinutos": 18, "visitas": [] },
  "rutaPropuesta": { "orden": ["51ab…"], "viable": true, "distanciaKm": 0.62, "trasladoMinutos": 8, "visitas": [{ "paradaId": "51ab…", "nombre": "Museo de ejemplo", "tipo": "sustituta", "inicio": "10:13", "fin": "11:13", "trasladoMinutos": 8, "distanciaKm": 0.62 }] },
  "paradasPendientesPropuestas": [{ "id": "51ab…", "placeId": "51ab…", "nombre": "Museo de ejemplo", "horaApertura": "09:00", "horaCierre": "17:00", "tiempoEstanciaMinutos": 60, "tipo_entorno": "indoor", "horaInicioProgramada": "10:13" }],
  "advertencias": [{ "codigo": "SEGURIDAD", "mensaje": "…no garantizan la seguridad del trayecto…" }],
  "token": "eyJ2Ijox….firma"
}
```

**Aceptar** (`POST .../aceptar` con `{ "token", "itinerario" }`): devuelve `paradasPendientes` en el orden propuesto. El cliente conserva sus paradas no pendientes en su lugar y agrega esas al final; las completadas no se modifican.

| Situación | Respuesta |
| --- | --- |
| El itinerario es el mismo con el que se generó la propuesta y no venció (20 minutos) | `200`, `yaAplicada: false` |
| El itinerario ya tiene aplicada la propuesta | `200`, `yaAplicada: true` (idempotente) |
| Cambió el itinerario (otra parada completada, cancelada, reordenada o de otro día) | `409 PROPUESTA_OBSOLETA` |
| Venció | `410 PROPUESTA_VENCIDA` |
| Token alterado, de otra instancia o de un reinicio sin `CLIMA_REACTIVO_SECRETO` | `400 PROPUESTA_INVALIDA` |

El token es una firma HMAC-SHA256 del estado del itinerario (huella), del resultado y de las paradas propuestas. El servidor no guarda propuestas.

### Errores

| HTTP | Código | Cuándo |
| --- | --- | --- |
| 400 | `PARAMETRO_INVALIDO` | Cuerpo inválido; no se consulta ningún proveedor |
| 503 | `SERVICIO_NO_CONFIGURADO` | Falta `OPENWEATHER_API_KEY` |
| 502/503/504 | `PROVEEDOR_*` | OpenWeather falló en las **dos** consultas (si falla una, se evalúa con la otra y se advierte), o Geoapify falló en todas las búsquedas de alternativas. Un fallo nunca se presenta como «sin lluvia» ni como «sin alternativas» |
| 502 | `OPTIMIZADOR_NO_DISPONIBLE` / `RESPUESTA_OPTIMIZADOR_INVALIDA` | No se pudo conectar con el optimizador o devolvió un orden con paradas omitidas, agregadas o sustituciones no solicitadas |
| 503 | `SERVICIO_RUTAS_NO_DISPONIBLE` | Valhalla no está disponible |
| 409 | `REOPTIMIZACION_NO_DISPONIBLE` | Valhalla no encuentra ruta (fuera de cobertura o sin conexión para el modo elegido) |

Ante cualquier error, el itinerario actual se conserva y el frontend vuelve a intentar en la siguiente revisión.

### Configuración del monitoreo

Valores por defecto en `src/config/climaReactivo.ts`; se pueden cambiar con variables de entorno, que se validan al iniciar (un valor fuera de rango impide arrancar con un mensaje claro):

| Variable | Por defecto | Rango |
| --- | --- | --- |
| `CLIMA_REACTIVO_UMBRAL_PROBABILIDAD` | `0.7` | 0.05 a 1 |
| `CLIMA_REACTIVO_UMBRAL_LLUVIA_1H_MM` | `2.5` | 0.1 a 100 |
| `CLIMA_REACTIVO_UMBRAL_LLUVIA_3H_MM` | `7.5` | 0.1 a 300 |
| `CLIMA_REACTIVO_HORIZONTE_HORAS` | `6` | 1 a 24 |
| `CLIMA_REACTIVO_INTERVALO_MINUTOS` | `12` | 10 a 60 (OpenWeather actualiza el clima actual cada 10 minutos) |
| `CLIMA_REACTIVO_ESPERA_PROPUESTAS_MINUTOS` | `30` | 0 a 240 |
| `CLIMA_REACTIVO_VIGENCIA_PROPUESTA_MINUTOS` | `20` | 5 a 120 |
| `CLIMA_REACTIVO_RADIO_INICIAL_M` | `2000` | 100 a 5000 |
| `CLIMA_REACTIVO_RADIO_MAXIMO_M` | `5000` | 100 a 5000, no menor que el inicial |
| `CLIMA_REACTIVO_SECRETO` | aleatorio por proceso | Texto |

**Consumo de OpenWeather**: cada revisión hace como máximo 2 consultas (clima actual y pronóstico), que se guardan en caché 10 minutos por zona de unos 110 m y se comparten entre solicitudes simultáneas. Con el intervalo de 12 minutos son unas 10 consultas por hora y por itinerario activo, muy por debajo del límite de 60 por minuto del plan gratuito. La caché es por proceso y no garantiza una cuota global.

### Frontend

- `src/hooks/useMonitoreoClima.ts` revisa el clima al abrir el paso 4 y luego con el intervalo que indica el backend, solo si el día mostrado es hoy y quedan paradas pendientes. No lanza revisiones simultáneas, descarta respuestas tardías de un día anterior o de una revisión invalidada y se detiene al cambiar de día o salir del paso. Solo funciona con la aplicación abierta: no hay notificaciones en segundo plano.
- `src/components/PropuestaClima.tsx` muestra el nivel de riesgo, la fuente y la hora de la consulta, las paradas afectadas, los cambios con su razón, el recorrido actual frente al propuesto, la lista de alternativas («Ver alternativas») y las advertencias. «Aceptar cambios» y «Mantener mi itinerario» solo aparecen con una propuesta aplicable.
- «Usar mi ubicación actual» pide la posición del navegador una sola vez y solo al pulsarlo; sin ella se usa la última parada confirmada.
- Al aceptar, el frontend comprueba que el itinerario no cambió mientras esperaba la respuesta y actualiza únicamente las paradas pendientes del día (el mapa se redibuja con el nuevo orden). Si el usuario completó o canceló una parada después de recibir la propuesta, esta se marca como desactualizada.
- Las plantillas del itinerario de demostración (`src/services/itinerario.ts`) ahora incluyen categorías de Geoapify para que el backend pueda clasificarlas.

### Pruebas

Todas simulan OpenWeather, Geoapify, el optimizador y Valhalla; no consumen cuotas.

```powershell
cd backend;   npm test      # incluye test/climaReactivo*.test.ts
cd frontend;  npm test      # node --test (Node 22.6+), test/climaReactivo.test.ts
cd optimizer; .\venv\Scripts\python.exe -m pytest tests/test_reoptimizacion_clima.py
```

### Limitaciones

- **Solo con la aplicación abierta** y solo el día del itinerario. Si el usuario cierra la pestaña, no hay seguimiento ni avisos.
- **Horarios de OpenStreetMap.** En una prueba real en Antigua Guatemala, los 4 museos y galerías encontrados cerca del Cerro de la Cruz tenían el horario `no_publicado`, por lo que la propuesta fue `sin_alternativas`. Es el comportamiento esperado (no se inventan horarios), pero en zonas con pocos datos el sistema propondrá pocas sustituciones.
- **Una sola ubicación de clima por revisión** (la del punto actual o la próxima parada); paradas muy alejadas entre sí pueden tener otro clima.
- **El itinerario del frontend no persiste el estado `en_curso`**: el paso 4 envía las paradas como completadas o pendientes.
- La estancia de una alternativa es la de la parada sustituida (mínimo 30 minutos), no una duración publicada por el lugar.
- La firma con clave aleatoria por proceso invalida las propuestas al reiniciar; con varias instancias hay que definir `CLIMA_REACTIVO_SECRETO`.
- La propuesta reduce la exposición a la lluvia; **no es una garantía de seguridad** ante tormentas.
