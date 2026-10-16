# Backend

API HTTP con Node.js, Fastify y TypeScript (CommonJS). Expone la consulta de lugares de interés mediante [Geoapify Places API](https://apidocs.geoapify.com/docs/places/), enriquecida con los horarios publicados que devuelve [Geoapify Place Details API](https://apidocs.geoapify.com/docs/place-details/), la validación de una propuesta de itinerario contra esos horarios (`POST /api/itinerarios/validar`), el pronóstico del clima para las fechas de un viaje mediante [OpenWeather 5 Day / 3 Hour Forecast](https://openweathermap.org/forecast5) y la priorización de las paradas según la lluvia pronosticada (`POST /api/itinerarios/priorizar-clima`). La configuración de Prisma se mantiene sin cambios.

## Requisitos

- Node.js 20 o superior (se usan `fetch`, `AbortController` y `node --test` nativos).
- Una clave de Geoapify, que se obtiene en [myprojects.geoapify.com](https://myprojects.geoapify.com/).
- Una clave de OpenWeather para `GET /api/clima/pronostico` (opcional para iniciar el servidor). Consulta [Clave de OpenWeather](#clave-de-openweather).

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
| `PORT` | Puerto HTTP del backend. Valor por defecto: `3000`. |
| `HOST` | Dirección en la que escucha el servidor. Valor por defecto: `::` (todas las interfaces, IPv6 e IPv4). Usa `127.0.0.1` para aceptar solo conexiones locales. |
| `DATABASE_URL` | Conexión de Prisma a PostgreSQL (no se usa en los endpoints de lugares ni de clima). |

El servidor carga `backend/.env` sin sobrescribir variables que ya estén definidas en el entorno. El archivo `.env` está excluido de Git; solo se versiona `.env.example`. Las claves se usan únicamente en el servidor: no deben definirse como variables `VITE_` ni enviarse al frontend.

## Comandos

```powershell
npm run build  # compila TypeScript a dist/ (el servidor queda en dist/backend/src/server.js)
npm start      # inicia el servidor compilado (requiere npm run build)
npm run dev    # inicia el servidor con tsx y lo reinicia al detectar cambios
npm run typecheck  # verifica los tipos de src/ y test/
npm test       # ejecuta todas las pruebas de test/ con Geoapify y OpenWeather simulados (no requiere claves), incluidas las de clasificación y priorización climática
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
- `GET /api/lugares` no calcula si un lugar está abierto en un momento dado; esa evaluación se hace para la llegada estimada de cada parada en [`POST /api/itinerarios/validar`](#endpoint-post-apiitinerariosvalidar). `valorOriginal` conserva todas las reglas y excepciones; no se reduce a una pareja de apertura y cierre ni a una tabla semanal.
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

**Traslados estimados.** No hay datos de rutas reales. El tiempo base se estima con la distancia en línea recta entre las coordenadas y 40 km/h, igual que el optimizador; a ese tiempo se suma la holgura de `calcularTiempoTotalTraslado` (`tiempoService.ts`), con la regla existente de traslado a pie si el tiempo base es menor de 12 minutos. La llegada se valida con el tiempo **ya incluida la holgura**, y ese mismo traslado se publica en la parada (`traslado`, con `estimado: true`). La holgura ya no se añade después de validar.

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
