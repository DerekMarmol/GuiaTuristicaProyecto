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

## POST /optimize

Recibe una lista de paradas con sus restricciones y devuelve el mejor orden posibles para ir a ellas, reduciendo el tiempo o distancia total del recorrido.

**Sintaxis de la petición:**
```json
{
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