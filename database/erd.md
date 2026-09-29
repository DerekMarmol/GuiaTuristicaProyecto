# Diagrama Entidad-Relación del proyecto Guía Turistica.

En este archivo les comparto las entidades que se han creado, sus tipos de datos y su respectiva relación. Esto como base para cuando se cree lo de las migraciones de las bases de datos, por si tienen dudas de como se relaciona cada modelo


```mermaid
erDiagram

Viaje ||--o{ Itinerario:"Un viaje puede tener diferentes itinerarios"

Itinerario ||--o{ Parada:"Un itinerario puede tener diferentes paradas"

Parada ||--|| Restriccion:"Una parada puede tener unicamente una restricción"

Parada {
    string id
    string itinerarioId
    string nombre
    float lat
    float lng
    string horaApertura
    string horaCierre
    int tiempoEstanciaMinutos
}

Viaje {
    string id 
    string destino
    enum tipoViaje
    float lat
    float lng
    float presupuesto
    enum transporte
    string[] intereses
    string fechaInicio
    string fechaFin
    boolean hospedaje
    string nombreHotel
}

Itinerario {
    string id
    string viajeId
    int numeroDia
    string fecha
}

Restriccion {
    string id
    string paradaId
    enum tipoEntorno
    enum sensibilidadClima
}

```
