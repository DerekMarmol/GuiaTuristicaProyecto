from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.routers.optimize import router


app = FastAPI()
app.include_router(router)

client = TestClient(app)


def test_reoptimize_desde_hora_actual():
    datos = {
        "paradas": [
            {
                "id": "parque",
                "lat": 14.6349,
                "lng": -90.5069,
                "hora_apertura": "09:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 60
            },
            {
                "id": "museo",
                "lat": 14.6407,
                "lng": -90.5133,
                "hora_apertura": "10:00",
                "hora_cierre": "17:00",
                "tiempo_estancia_minutos": 45
            }
        ],
        "hora_actual_minutos": 840
    }

    respuesta = client.post("/reoptimize", json=datos)

    assert respuesta.status_code == 200, respuesta.text

    resultado = respuesta.json()

    assert set(resultado["orden_optimo"]) == {"parque", "museo"}
    assert resultado["distancia_total_km"] >= 0


def test_reoptimize_ya_no_alcanza_el_tiempo():
    datos = {
        "paradas": [
            {
                "id": "parque",
                "lat": 14.6349,
                "lng": -90.5069,
                "hora_apertura": "09:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 60
            }
        ],
        "hora_actual_minutos": 1380
    }

    respuesta = client.post("/reoptimize", json=datos)

    assert respuesta.status_code == 422

    detalle = respuesta.json()["detail"]
    assert "parque" in detalle


def test_reoptimize_valida_hora_fuera_de_rango():
    datos = {
        "paradas": [
            {
                "id": "parque",
                "lat": 14.6349,
                "lng": -90.5069,
                "hora_apertura": "09:00",
                "hora_cierre": "18:00",
                "tiempo_estancia_minutos": 60
            }
        ],
        "hora_actual_minutos": 1500
    }

    respuesta = client.post("/reoptimize", json=datos)

    assert respuesta.status_code == 422


def test_reoptimize_reutiliza_las_validaciones_de_optimize():
    respuesta = client.post("/reoptimize", json={"paradas": [], "hora_actual_minutos": 600})

    assert respuesta.status_code == 422
    assert "al menos una parada" in respuesta.json()["detail"]
