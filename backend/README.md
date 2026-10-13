# Backend

API HTTP con Node.js y Express (CommonJS). Expone la consulta de lugares de interés mediante [Geoapify Places API](https://apidocs.geoapify.com/docs/places/), enriquecida con los horarios publicados que devuelve [Geoapify Place Details API](https://apidocs.geoapify.com/docs/place-details/), y el pronóstico del clima para las fechas de un viaje mediante [OpenWeather 5 Day / 3 Hour Forecast](https://openweathermap.org/forecast5). La configuración de Prisma se mantiene sin cambios.

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
| `OPENWEATHER_API_KEY` | Clave de OpenWeather. Si falta, el servidor inicia, muestra un aviso y `GET /api/clima/pronostico` responde `503`; el resto de las rutas funciona igual. |
| `PORT` | Puerto HTTP del backend. Valor por defecto: `3000`. |
| `DATABASE_URL` | Conexión de Prisma a PostgreSQL (no se usa en los endpoints de lugares ni de clima). |

El servidor carga `backend/.env` sin sobrescribir variables que ya estén definidas en el entorno. El archivo `.env` está excluido de Git; solo se versiona `.env.example`. Las claves se usan únicamente en el servidor: no deben definirse como variables `VITE_` ni enviarse al frontend.

## Comandos

```powershell
npm start      # inicia el servidor
npm run dev    # inicia el servidor y lo reinicia al detectar cambios
npm test       # ejecuta las pruebas con Geoapify y OpenWeather simulados (no requiere claves)
npm run ai:test   # pruebas del módulo de IA (validador, orquestador y validación de estancias)
```

Si falta `GEOAPIFY_API_KEY`, `npm start` termina con un mensaje que indica la variable faltante.

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

Son los mismos que ofrece el frontend en el paso 3. Se aceptan sin distinguir mayúsculas, con espacios exteriores y con o sin tildes (`vida nocturna`, `GASTRONOMIA`, ` Fotografía `). Se rechazan intereses desconocidos, elementos vacíos (`Cultura,`) y el parámetro repetido. La correspondencia está en `src/config/intereses.js` y es una decisión del proyecto:

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

Definidas en `src/config/categorias.js`:

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

Cada lugar entregado tiene `idExterno` y `nombre` no vacíos, coordenadas válidas y al menos una categoría del proveedor. `categorias` contiene todas las categorías que informa Geoapify, aunque no se hayan pedido (por ejemplo `building`). `direccion` es `null` cuando el proveedor no la informa. Los registros sin identificador, nombre, coordenadas o categorías válidas se descartan sin completar datos. Si no hay coincidencias, o si todos los registros se descartan, la respuesta es `200` con `lugares` vacío; una respuesta del proveedor con estructura inválida produce `502`. Cada lugar incluye siempre el objeto `horario` descrito a continuación. El contrato TypeScript está en `shared/types/lugarInteres.ts` (`LugarInteres`, `HorarioLugar`, `EstadoHorario` y `RespuestaLugares`).

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
- No se calcula si un lugar está abierto en un momento dado ni para una fecha de visita. `valorOriginal` conserva todas las reglas y excepciones; no se reduce a una pareja de apertura y cierre ni a una tabla semanal.
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
| Consultas de detalles simultáneas | 4 | `CONCURRENCIA_DETALLES` en `src/geoapify/enriquecer.js` |
| Separación mínima entre inicios de consultas | 250 ms (como máximo 4 por segundo) | `INTERVALO_DETALLES_MS` |
| Tiempo de espera por consulta de detalles | 5 segundos | `TIEMPO_ESPERA_DETALLE_MS` en `src/geoapify/detalles.js` |
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

## Endpoint `GET /api/clima/pronostico`

Devuelve, para cada fecha del viaje, un resumen de temperatura y lluvia calculado con el pronóstico de [OpenWeather 5 Day / 3 Hour Forecast](https://openweathermap.org/forecast5). Recibe las coordenadas reales del destino y las fechas; no consulta viajes guardados, no geocodifica el nombre del destino y no modifica el itinerario.

Es el único endpoint de clima del backend y el que consume el frontend: el paso 4 hace una sola consulta por viaje y muestra el resumen de cada día del itinerario.

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
- El rango incluye ambas fechas. Su máximo técnico es de **366 días** (`MAX_DIAS_RANGO` en `src/validacion/clima.js`), para evitar respuestas desproporcionadas. Este límite no tiene relación con el horizonte meteorológico: un viaje de 14 o de 366 días es válido aunque el pronóstico solo cubra unos 5 días. Un rango mayor se rechaza con `400`; nunca se recorta en silencio.
- Las fechas pasadas son válidas y aparecen como `fuera_de_cobertura`: no se consultan datos históricos.
- Cualquier parámetro inválido produce `400` antes de consultar a OpenWeather.

### Consulta al proveedor

Cada solicitud hace **una sola** petición a `GET https://api.openweathermap.org/data/2.5/forecast` con `lat`, `lon` (nuestro `lng`), `appid`, `units=metric` y `lang=es`. No se envía `cnt` ni ninguna fecha: el proveedor devuelve toda la serie disponible (normalmente 40 intervalos de tres horas, unos 5 días a partir del momento de la consulta) y el rango del viaje se aplica después. No se dan por supuestos 40 registros, 5 fechas completas ni que la serie empiece en `fechaInicio`: la cobertura se calcula con los registros recibidos.

- Tiempo de espera de 10 segundos (`TIEMPO_ESPERA_MS` en `src/openweather/cliente.js`) que cubre también la lectura del cuerpo; al agotarse, la petición se cancela.
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

Un fallo de OpenWeather solo afecta a `/api/clima/pronostico`; `/api/lugares` sigue funcionando.

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
