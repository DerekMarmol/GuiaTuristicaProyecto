# Backend

API HTTP con Node.js y Express (CommonJS). Por ahora expone la consulta de lugares de interés mediante [Geoapify Places API](https://apidocs.geoapify.com/docs/places/), enriquecida con los horarios publicados que devuelve [Geoapify Place Details API](https://apidocs.geoapify.com/docs/place-details/). La configuración de Prisma se mantiene sin cambios.

## Requisitos

- Node.js 20 o superior (se usan `fetch`, `AbortController` y `node --test` nativos).
- Una clave de Geoapify, que se obtiene en [myprojects.geoapify.com](https://myprojects.geoapify.com/).

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
| `PORT` | Puerto HTTP del backend. Valor por defecto: `3000`. |
| `DATABASE_URL` | Conexión de Prisma a PostgreSQL (no se usa en el endpoint de lugares). |

El servidor carga `backend/.env` sin sobrescribir variables que ya estén definidas en el entorno. El archivo `.env` está excluido de Git; solo se versiona `.env.example`. La clave se usa únicamente en el servidor: no debe definirse como variable `VITE_` ni enviarse al frontend.

## Comandos

```powershell
npm start      # inicia el servidor
npm run dev    # inicia el servidor y lo reinicia al detectar cambios
npm test       # ejecuta las pruebas con Geoapify simulado (no requiere clave)
```

Si falta `GEOAPIFY_API_KEY`, `npm start` termina con un mensaje que indica la variable faltante.

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
