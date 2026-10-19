# Valhalla: tiempos y distancias de traslado (GUI-92)

## 1. Qué es y para qué se usa

[Valhalla](https://github.com/valhalla/valhalla) es un motor de rutas de código abierto que calcula recorridos sobre la red de calles y senderos de OpenStreetMap. En este proyecto lo usa **solo el optimizador** (`optimizer/`, FastAPI + Google OR-Tools) para conocer cuánto se tarda y cuántos metros se recorren entre cada par de paradas de un itinerario.

Antes, el optimizador estimaba cada tramo con la distancia en línea recta (Haversine) y una velocidad fija de 40 km/h. Ahora OR-Tools, la validación de horarios, la priorización por clima y `distancia_total_km` usan los valores de Valhalla.

```
frontend ──► backend (Fastify) ──► optimizer (FastAPI + OR-Tools) ──► Valhalla
             /api/itinerarios/      /optimize, /reoptimize            /sources_to_targets
             reoptimizar                                              /route
```

Geoapify (lugares y coordenadas), OpenWeather (clima) y el resto del backend no cambian.

## 2. Medios de transporte admitidos

| Valor | Medio | Costing de Valhalla |
| --- | --- | --- |
| `auto` | Automóvil (valor por defecto) | `auto` |
| `pedestrian` | A pie | `pedestrian` |

Cualquier otro valor se rechaza: el optimizador responde `422` y el backend `400` (`PARAMETRO_INVALIDO`). En el frontend, el viaje «A pie» se envía como `pedestrian` y los demás medios del selector (automóvil, moto, transporte público y aéreo) como `auto`, porque son los únicos dos modos integrados.

## 3. Ejecutar Valhalla con Docker

`docker-compose.yml` define el servicio `valhalla` con la imagen oficial `ghcr.io/valhalla/valhalla-scripted:3.9.1` en el puerto `8002`. Los datos se guardan en el volumen `valhalla_data`, montado en `/custom_files`; no se escribe nada dentro del repositorio.

```powershell
# Desde la raíz del repositorio
docker compose up -d valhalla

# Seguir el progreso de la primera construcción del grafo
docker compose logs -f valhalla

# Comprobar que responde (cuando el contenedor aparece como "healthy")
Invoke-RestMethod http://localhost:8002/status
docker compose ps valhalla
```

Para levantar el optimizador junto con Valhalla:

```powershell
docker compose up -d --build optimizer
```

El optimizador puede iniciar antes de que Valhalla termine de construir el grafo; mientras tanto, `/optimize` y `/reoptimize` responden `503`.

## 4. Preparación de los datos cartográficos

La primera vez que arranca, el contenedor descarga el extracto de Guatemala de [Geofabrik](https://download.geofabrik.de/central-america/guatemala.html) (`tile_urls`, unos 130 MB), construye los tiles de rutas, la base de datos de administraciones y la de zonas horarias, y empaqueta todo en `valhalla_tiles.tar`. En un equipo con 8 núcleos y 7 GB para Docker tardó unos 10 minutos.

Las variables usadas en `docker-compose.yml`:

| Variable | Valor | Efecto |
| --- | --- | --- |
| `tile_urls` | Extracto de Guatemala | Archivo `.osm.pbf` que se descarga si no hay tiles. |
| `use_tiles_ignore_pbf` | `True` | Si ya existen tiles, se reutilizan sin reconstruir. |
| `build_tar` | `True` | Empaqueta los tiles para cargarlos más rápido al reiniciar. |
| `build_admins`, `build_time_zones` | `True` | Datos auxiliares que Valhalla necesita para lado de circulación y horarios. |
| `build_elevation` | `False` | No descarga elevación (no se usa). |
| `server_threads` | `4` | Hilos para construir y servir. Bájalo si el contenedor se queda sin memoria. |

Al reiniciar (`docker compose restart valhalla`) el registro muestra `Found routing tiles with 'use_tiles_ignore_pbf' True.` y el servicio queda listo en segundos.

**Reconstruir con datos nuevos** (por ejemplo, para actualizar el mapa):

```powershell
docker compose stop valhalla
docker compose rm -f valhalla
docker volume rm proyecto_valhalla_data   # el prefijo depende del nombre de la carpeta del proyecto
docker compose up -d valhalla
```

Para usar otra región, cambia `tile_urls` y elimina el volumen como arriba. Los archivos `.osm.pbf`, `custom_files/` y los tiles están excluidos en `.gitignore` por si alguien los descarga a mano.

## 5. Configurar la URL del servicio

El optimizador lee la configuración de variables de entorno (o de `optimizer/.env`; ver `optimizer/.env.example`):

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `VALHALLA_URL` | `http://localhost:8002` | URL base de Valhalla. En Docker Compose es `http://valhalla:8002`. |
| `VALHALLA_TIMEOUT_SEGUNDOS` | `10` | Tiempo máximo de espera por solicitud. |

Para ejecutar el optimizador fuera de Docker contra el Valhalla del contenedor:

```powershell
cd optimizer
$env:VALHALLA_URL = "http://localhost:8002"
.\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

El backend no habla con Valhalla; solo necesita `OPTIMIZER_URL`.

## 6. Consulta de una ruta individual (`POST /route`)

Directamente contra Valhalla:

```powershell
$cuerpo = @{
  locations = @(
    @{ lat = 14.6425; lon = -90.5133 },   # Plaza de la Constitución
    @{ lat = 14.6066; lon = -90.5059 }    # Museo Popol Vuh
  )
  costing = "auto"
  units = "kilometers"
  directions_type = "none"
} | ConvertTo-Json -Depth 4

(Invoke-RestMethod -Method Post -Uri http://localhost:8002/route `
  -ContentType "application/json" -Body $cuerpo).trip.summary | Select-Object time, length
```

Respuesta obtenida con los datos de Guatemala (`time` en segundos, `length` en kilómetros):

```json
{ "time": 1255.913, "length": 5.602 }
```

Desde Python, el servicio `optimizer/app/services/valhalla.py` lo normaliza a segundos y metros:

```python
from app.config import settings
from app.services.valhalla import ClienteValhalla, Coordenada

cliente = ClienteValhalla(settings.valhalla_url, settings.valhalla_timeout_segundos)
traslado = cliente.ruta(
    Coordenada(lat=14.6425, lon=-90.5133),
    Coordenada(lat=14.6066, lon=-90.5059),
    "pedestrian",
)
print(traslado.duracion_segundos, traslado.distancia_metros)
cliente.cerrar()
```

## 7. Consulta de matrices (`POST /sources_to_targets`)

El optimizador envía las mismas coordenadas como `sources` y `targets`, en el orden de las paradas, en **una sola solicitud**:

```json
{
  "sources": [{ "lat": 14.6425, "lon": -90.5133 }, { "lat": 14.6066, "lon": -90.5059 }],
  "targets": [{ "lat": 14.6425, "lon": -90.5133 }, { "lat": 14.6066, "lon": -90.5059 }],
  "costing": "pedestrian",
  "units": "kilometers",
  "verbose": true
}
```

Respuesta real (resumida):

```json
{
  "sources_to_targets": [
    [
      { "from_index": 0, "to_index": 0, "time": 0, "distance": 0.0 },
      { "from_index": 0, "to_index": 1, "time": 3569, "distance": 5.029 }
    ],
    [
      { "from_index": 1, "to_index": 0, "time": 3569, "distance": 5.029 },
      { "from_index": 1, "to_index": 1, "time": 0, "distance": 0.0 }
    ]
  ],
  "units": "kilometers",
  "algorithm": "timedistancematrix"
}
```

`ClienteValhalla.matriz()` la convierte en `MatrizTraslados`:

- `duraciones_segundos[i][j]` y `distancias_metros[i][j]` corresponden al tramo de la parada `i` a la parada `j`, en el orden original. Cada celda se coloca según `from_index` y `to_index`.
- La ida y la vuelta se guardan por separado (pueden diferir por calles de un solo sentido).
- La diagonal vale `0`.
- Una conexión sin ruta (`time` y `distance` en `null`) queda como `None`; nunca se convierte en `0`.
- Se valida que haya una fila y una columna por parada, que los índices no se repitan y que los valores sean números finitos no negativos. Si no, se lanza `RespuestaValhallaInvalida`.
- Con una sola parada no se consulta Valhalla: la matriz es `[[0]]`.

## 8. Cómo usa el optimizador los resultados

1. `/optimize` y `/reoptimize` validan la solicitud y piden la matriz **antes** de crear el modelo de OR-Tools. Los callbacks de OR-Tools solo leen la matriz en memoria; nunca hacen solicitudes HTTP.
2. El modelo trabaja en **segundos**. Cada duración se redondea hacia arriba (`math.ceil`) para que un traslado corto nunca valga cero. El tránsito de `i` a `j` es la estancia en `i` más el traslado `i → j`. La estancia de cada parada se cuenta una sola vez y la ventana de cada parada sigue siendo `[apertura, cierre − estancia]`.
3. Los arcos sin ruta se eliminan del dominio de `NextVar`, así OR-Tools no puede elegirlos. Si no queda un orden viable, responde `422`.
4. La validación de horarios (`ruta_respeta_horarios`) y la penalización climática (`calcular_costo_climatico_ruta`) usan la misma línea de tiempo (`calcular_inicios_visita`), construida con los tiempos de Valhalla. Así la hora estimada de llegada que se compara con el pronóstico de OpenWeather es la misma que se valida contra el horario.
5. La selección entre alternativas por clima suma los minutos de traslado de Valhalla a la penalización climática (antes eran minutos calculados a 40 km/h). Las rutas con un tramo inexistente se descartan.
6. `distancia_total_km` suma los metros de los tramos elegidos y los convierte a kilómetros.

Ejemplo real de `/optimize` con tres paradas del Centro Histórico y la zona 10:

```powershell
$paradas = @(
  @{ id = "plaza"; lat = 14.6425; lng = -90.5133; hora_apertura = "08:00"; hora_cierre = "18:00"; tiempo_estancia_minutos = 30 },
  @{ id = "popol_vuh"; lat = 14.6066; lng = -90.5059; hora_apertura = "09:00"; hora_cierre = "17:00"; tiempo_estancia_minutos = 60 },
  @{ id = "mercado"; lat = 14.6420; lng = -90.5116; hora_apertura = "07:00"; hora_cierre = "18:00"; tiempo_estancia_minutos = 45 }
)
$cuerpo = @{ paradas = $paradas; modo_transporte = "pedestrian" } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri http://localhost:8000/optimize -ContentType "application/json" -Body $cuerpo
```

| `modo_transporte` | Respuesta obtenida |
| --- | --- |
| `auto` (u omitido) | `{"orden_optimo":["plaza","mercado","popol_vuh"],"distancia_total_km":5.72}` |
| `pedestrian` | `{"orden_optimo":["plaza","mercado","popol_vuh"],"distancia_total_km":5.1}` |

## 9. Pruebas

Las pruebas del optimizador usan `pytest`. Las unitarias simulan Valhalla con `httpx.MockTransport` o con un cliente falso, así que no necesitan Docker. Las de integración (`tests/test_valhalla_integracion.py`) se ejecutan contra la instancia real y **se omiten automáticamente** si `VALHALLA_URL` no responde.

```powershell
cd optimizer
py -3.12 -m venv venv            # la versión fijada de ortools requiere Python 3.12 o anterior
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m pytest -q
```

Para ejecutar solo las de integración y ver si se omitieron:

```powershell
.\venv\Scripts\python.exe -m pytest tests/test_valhalla_integracion.py -v -rs
```

Las pruebas del backend incluyen `test/reoptimizacion.test.ts` (envío y validación de `modoTransporte`, errores `503`):

```powershell
cd backend
npm test
```

## 10. Errores habituales

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `/optimize` responde `503` «El servicio de rutas no está disponible.» | Valhalla no está corriendo, sigue construyendo el grafo o `VALHALLA_URL` es incorrecta. | `docker compose ps valhalla`, `docker compose logs valhalla`, `Invoke-RestMethod http://localhost:8002/status`. Dentro de Docker la URL es `http://valhalla:8002`; fuera, `http://localhost:8002`. |
| `503` «El servicio de rutas no respondió a tiempo.» | Matriz grande, equipo lento o Valhalla todavía cargando. | Aumenta `VALHALLA_TIMEOUT_SEGUNDOS` o espera a que el contenedor esté `healthy`. |
| `422` «Una o más paradas están fuera de la cobertura del mapa de rutas.» | Una coordenada no está cerca de ninguna vía del mapa cargado (Valhalla `error_code` 171). | Verifica las coordenadas o carga un extracto que cubra la zona. |
| `422` «No existe una ruta entre las paradas…» | Regiones desconectadas o distancia mayor al límite de Valhalla (códigos 154, 170, 442…). Una coordenada muy lejos del mapa suele devolver primero el 154. | Revisa coordenadas; para recorridos a pie largos, considera `auto`. |
| `422` «…con los horarios y las rutas disponibles…» | Con los tiempos reales no se llega a tiempo a alguna parada, o falta una conexión imprescindible. | Ajusta horarios, estancias o el medio de transporte. |
| `502` «El servicio de rutas devolvió una respuesta inválida.» | Respuesta no JSON o matriz incompleta (por ejemplo, un proxy delante de Valhalla). | Revisa los registros del optimizador (`docker compose logs optimizer`). |
| El contenedor de Valhalla se reinicia o muere al construir | Falta de memoria. | Baja `server_threads` o asigna más memoria a Docker Desktop. |
| `pip install` falla con `ortools==9.11.4210` en Windows | Esa versión no publica paquetes para Python 3.13+. | Crea el entorno con Python 3.12 (`py -3.12 -m venv venv`) o usa el contenedor. |

Los registros del cliente indican el endpoint, el estado HTTP y el `error_code` de Valhalla, sin coordenadas ni datos del usuario.
