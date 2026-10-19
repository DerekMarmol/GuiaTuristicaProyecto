from app.routers.optimize import (
    Parada,
    PronosticoHora,
    calcular_costo_climatico_ruta,
    seleccionar_mejor_ruta
)

from valhalla_falso import crear_matriz, matriz_uniforme


def crear_paradas_prueba():
    pronostico = [
        PronosticoHora(hora="09:00", probabilidad_lluvia=80),
        PronosticoHora(hora="12:00", probabilidad_lluvia=50),
        PronosticoHora(hora="15:00", probabilidad_lluvia=10)
    ]

    paradas = [
        Parada(
            id="inicio",
            lat=14.6349,
            lng=-90.5069,
            hora_apertura="08:00",
            hora_cierre="18:00",
            tiempo_estancia_minutos=0,
            sensibilidad_clima=0.0
        ),
        Parada(
            id="parque",
            lat=14.6350,
            lng=-90.5070,
            hora_apertura="08:00",
            hora_cierre="18:00",
            tiempo_estancia_minutos=60,
            tipo_entorno="exterior",
            sensibilidad_clima=1.0,
            pronostico_horario=pronostico
        ),
        Parada(
            id="museo",
            lat=14.6351,
            lng=-90.5071,
            hora_apertura="08:00",
            hora_cierre="18:00",
            tiempo_estancia_minutos=180,
            tipo_entorno="interior",
            sensibilidad_clima=0.0
        )
    ]

    return paradas

def test_costo_climatico_segun_orden():
    paradas = crear_paradas_prueba()
    matriz = matriz_uniforme(3)

    ruta_1 = [0, 1, 2]
    ruta_2 = [0, 2, 1]

    costo_1 = calcular_costo_climatico_ruta(
        paradas, ruta_1, 9 * 3600, matriz
    )

    costo_2 = calcular_costo_climatico_ruta(
        paradas, ruta_2, 9 * 3600, matriz
    )

    assert costo_1 == 80
    assert costo_2 == 50
    assert costo_2 < costo_1

def test_seleccionar_mejor_ruta_por_clima():
    paradas = crear_paradas_prueba()

    rutas_candidatas = [
        [0, 1, 2],
        [0, 2, 1]
    ]

    mejor_ruta = seleccionar_mejor_ruta(
        paradas,
        rutas_candidatas,
        9 * 3600,
        matriz_uniforme(3)
    )

    assert mejor_ruta == [0, 2, 1]


def test_costo_climatico_usa_la_hora_de_llegada_de_valhalla():
    paradas = crear_paradas_prueba()

    traslado_corto = crear_matriz([
        [0, 60, 60],
        [60, 0, 60],
        [60, 60, 0]
    ])
    traslado_de_tres_horas = crear_matriz([
        [0, 3 * 3600, 60],
        [60, 0, 60],
        [60, 60, 0]
    ])

    assert calcular_costo_climatico_ruta(
        paradas, [0, 1, 2], 9 * 3600, traslado_corto
    ) == 80
    assert calcular_costo_climatico_ruta(
        paradas, [0, 1, 2], 9 * 3600, traslado_de_tres_horas
    ) == 50
