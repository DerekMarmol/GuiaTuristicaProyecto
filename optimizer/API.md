# API del servicio Optimizer

Este es un microservicio hecho con FastAPI. El objetivo es aclarar la duda sobre la comunicación entre servicios del optimizer en python y el backend en Node.js que le toca realizar a Lucía. Basicamente una guía para que comprenda que información se le envía a este servicio y como funciona cada uno de sus endpoints

## GET /health

Verifica que el servicio esté activo y respondiendo, es la señal que da de vida si está activo.

**Respuesta (200 OK):**
```json
{
  "status": "ok"
}
```

Si la respuesta es similar a la anterior, funciona de manera correcta.

## Tiempos y distancias de traslado (Valhalla)

Antes de optimizar, el servicio consulta a [Valhalla](../docs/valhalla.md) (`POST /sources_to_targets`) una sola matriz con los tiempos y distancias por la red de calles entre todas las paradas. OR-Tools, la validación de horarios y la priorización climática usan esa matriz; ya no se usan distancias en línea recta ni una velocidad fija. La URL de Valhalla se configura con `VALHALLA_URL`.

Ambos endpoints aceptan el campo opcional `modo_transporte`:

| Valor | Medio |
| --- | --- |
| `auto` | Automóvil. Es el valor por defecto si el campo se omite. |
| `pedestrian` | A pie. |

Cualquier otro valor responde `422`. `lat` debe estar entre -90 y 90 y `lng` entre -180 y 180.

`distancia_total_km` es la suma de los tramos de la ruta elegida según Valhalla (de cada parada a la siguiente, sin regresar al inicio).

## POST /optimize

Recibe una lista de paradas con sus restricciones y devuelve el mejor orden posibles para ir a ellas, reduciendo el tiempo o distancia total del recorrido.

**Sintaxis de la petición:**
```json
{
  "modo_transporte": "pedestrian",
  "paradas": [
    {
      "id": "parada_1",
      "lat": 14.6349,
      "lng": -90.5069,
      "hora_apertura": "09:00",
      "hora_cierre": "18:00",
      "tiempo_estancia_minutos": 60
    },
    {
      "id": "parada_2",
      "lat": 14.6407,
      "lng": -90.5133,
      "hora_apertura": "10:00",
      "hora_cierre": "17:00",
      "tiempo_estancia_minutos": 45
    },
    {
      "id": "parada_3",
      "lat": 14.6290,
      "lng": -90.5220,
      "hora_apertura": "08:00",
      "hora_cierre": "20:00",
      "tiempo_estancia_minutos": 90
    }
  ]
}
```
**Respuesta (200 OK):**
```json
{
  "orden_optimo": ["parada_1", "parada_3", "parada_2"],
  "distancia_total_km": 12.4
}
```

## POST /reoptimize

Recibe las paradas que **faltan por visitar** (ya sin las que el usuario completó) junto con la hora actual, y recalcula el mejor orden para el resto del día. Se usa cuando algo cambia en ruta (un retraso, un cambio de clima) y hay que replanificar sin tocar lo que ya pasó.

Es el mismo motor que `/optimize`, con una sola diferencia: la ruta no puede "empezar" antes de la hora real en la que está el usuario.

**Sintaxis de la petición:**
```json
{
  "paradas": [
    {
      "id": "parada_2",
      "lat": 14.6407,
      "lng": -90.5133,
      "hora_apertura": "10:00",
      "hora_cierre": "17:00",
      "tiempo_estancia_minutos": 45
    },
    {
      "id": "parada_3",
      "lat": 14.6290,
      "lng": -90.5220,
      "hora_apertura": "08:00",
      "hora_cierre": "20:00",
      "tiempo_estancia_minutos": 90
    }
  ],
  "hora_actual_minutos": 780,
  "modo_transporte": "auto"
}
```
`hora_actual_minutos` es la hora actual expresada en minutos desde medianoche (ej. `780` = 1:00pm).

**Respuesta (200 OK):**
```json
{
  "orden_optimo": ["parada_3", "parada_2"],
  "distancia_total_km": 5.1
}
```

**Respuesta (422) si ya no alcanza el tiempo:**
```json
{
  "detail": "Ya no se alcanza a llegar a tiempo a parada_2 desde la hora actual."
}
```

## Errores de ambos endpoints

| Estado | Ejemplo de `detail` | Causa |
| --- | --- | --- |
| `422` | Lista de errores de validación de FastAPI | Campos faltantes, coordenadas fuera de rango o `modo_transporte` no admitido. No se consulta Valhalla. |
| `422` | `No se encontró un itinerario válido con los horarios y las rutas disponibles para el medio de transporte seleccionado.` | No existe un orden que respete los horarios usando solo las conexiones que Valhalla encontró. |
| `422` | `Una o más paradas están fuera de la cobertura del mapa de rutas.` | Una parada no está cerca de ninguna vía del mapa cargado en Valhalla. |
| `422` | `No existe una ruta entre las paradas para el medio de transporte seleccionado.` | Valhalla no encontró ruta (regiones desconectadas o distancia mayor al límite del servicio). |
| `502` | `El servicio de rutas devolvió una respuesta inválida.` | Valhalla devolvió JSON inválido, una matriz incompleta o valores negativos. |
| `503` | `El servicio de rutas no está disponible.` / `El servicio de rutas no respondió a tiempo.` | Valhalla no responde, rechaza la conexión, falla internamente o supera `VALHALLA_TIMEOUT_SEGUNDOS`. |

Si Valhalla falla, el optimizador **no** recurre a distancias en línea recta: responde con el error correspondiente.