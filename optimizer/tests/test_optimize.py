from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.routers.optimize import router


app = FastAPI()
app.include_router(router)

client = TestClient(app)


def test_optimize_sin_clima():
    datos = {
        "paradas": [
            {
                "id": "inicio",
                "lat": 14.6349,
                "lng": -90.5069,
                "hora_apertura": "08:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 0
            },
            {
                "id": "parque",
                "lat": 14.6350,
                "lng": -90.5070,
                "hora_apertura": "08:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 60
            },
            {
                "id": "museo",
                "lat": 14.6351,
                "lng": -90.5071,
                "hora_apertura": "08:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 90
            }
        ]
    }

    respuesta = client.post("/optimize", json=datos)

    assert respuesta.status_code == 200

    resultado = respuesta.json()

    assert resultado["orden_optimo"][0] == "inicio"
    assert set(resultado["orden_optimo"]) == {
        "inicio", "parque", "museo"
    }
    assert resultado["distancia_total_km"] >= 0


def test_optimize_reordena_por_clima():
    datos = {
        "paradas": [
            {
                "id": "inicio",
                "lat": 14.6349,
                "lng": -90.5069,
                "hora_apertura": "09:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 0
            },
            {
                "id": "parque",
                "lat": 14.6350,
                "lng": -90.5070,
                "hora_apertura": "09:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 60,
                "tipo_entorno": "exterior",
                "sensibilidad_clima": 1.0,
                "pronostico_horario": [
                    {
                        "hora": "09:00",
                        "probabilidad_lluvia": 80
                    },
                    {
                        "hora": "12:00",
                        "probabilidad_lluvia": 50
                    }
                ]
            },
            {
                "id": "museo",
                "lat": 14.6351,
                "lng": -90.5071,
                "hora_apertura": "09:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 180,
                "tipo_entorno": "interior",
                "sensibilidad_clima": 0.0
            }
        ]
    }

    respuesta = client.post("/optimize", json=datos)

    assert respuesta.status_code == 200, respuesta.text

    resultado = respuesta.json()

    assert resultado["orden_optimo"] == [
        "inicio",
        "museo",
        "parque"
    ]

    assert resultado["distancia_total_km"] >= 0
