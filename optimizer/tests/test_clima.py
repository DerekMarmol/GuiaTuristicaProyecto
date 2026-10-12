from app.routers.optimize import (
    Parada,
    PronosticoHora,
    calcular_penalizacion_por_hora
)


def test_penalizacion_por_hora():
    parque = Parada(
        id="parque-1",
        lat=14.6349,
        lng=-90.5069,
        hora_apertura="08:00",
        hora_cierre="18:00",
        tiempo_estancia_minutos=60,
        tipo_entorno="exterior",
        sensibilidad_clima=1.0,
        pronostico_horario=[
            PronosticoHora(
                hora="09:00",
                probabilidad_lluvia=80
            ),
            PronosticoHora(
                hora="12:00",
                probabilidad_lluvia=50
            ),
            PronosticoHora(
                hora="15:00",
                probabilidad_lluvia=10
            )
        ]
    )

    assert calcular_penalizacion_por_hora(parque, 9 * 60) == 80
    assert calcular_penalizacion_por_hora(parque, 12 * 60) == 50
    assert calcular_penalizacion_por_hora(parque, 15 * 60) == 10