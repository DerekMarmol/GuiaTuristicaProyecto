# Backend

API HTTP con Node.js y Express (CommonJS). Por ahora expone la consulta de lugares de interés mediante [Geoapify Places API](https://apidocs.geoapify.com/docs/places/). La configuración de Prisma se mantiene sin cambios.

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
      "categorias": ["entertainment", "entertainment.museum"]
    }
  ]
}
```

Cada lugar entregado tiene `idExterno` y `nombre` no vacíos, coordenadas válidas y al menos una categoría del proveedor. `categorias` contiene todas las categorías que informa Geoapify, aunque no se hayan pedido (por ejemplo `building`). `direccion` es `null` cuando el proveedor no la informa. Los registros sin identificador, nombre, coordenadas o categorías válidas se descartan sin completar datos. Si no hay coincidencias, o si todos los registros se descartan, la respuesta es `200` con `lugares` vacío; una respuesta del proveedor con estructura inválida produce `502`. El contrato TypeScript está en `shared/types/lugarInteres.ts` (`LugarInteres` y `RespuestaLugares`).

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
