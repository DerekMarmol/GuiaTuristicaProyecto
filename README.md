# Guía Turística

## Requisitos para el funcionamiento

### 1. Instalar Docker Desktop

En caso de presentar un error relacionado con la virtualización al abrir Docker, realizar lo siguiente:

1. Revisar en el **Administrador de tareas**, en el apartado **Rendimiento**, si la virtualización está activa.
   
   - Si no está activa, habilitarla desde la **BIOS/UEFI** del equipo.

2. Si la virtualización está habilitada y el error continúa, ejecutar el siguiente comando en powershell en administrador para verificar el estado del susbsistema de linux:

   ```powershell
   wsl --status
   ```

3. Si WSL no está instalado correctamente, realizar su instalación mediante:

    ```powershell
    wsl --install
    ```

4. Reiniciar la computadora para que los cambios se apliquen

## Backend

Backend en **Node.js** con **PostgreSQL** y **Prisma**.

### Requisitos
- Node.js 20+
- PostgreSQL 14+ (o el contenedor `postgres` de `docker-compose.yml`)

### Puesta en marcha
```bash
docker compose up -d postgres   # o crea la base guia_turistica desde pgAdmin
cd backend
npm install
cp .env.example .env            # edita DATABASE_URL y las claves de API
npx prisma migrate dev          # aplica las migraciones y genera el cliente de Prisma
```

Cada vez que hagas `git pull` y haya migraciones nuevas, vuelve a correr `npx prisma migrate dev`.

### Base de datos
El esquema está en [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) y las migraciones en `prisma/migrations/`.
Para cambiar el esquema: edita `schema.prisma` y corre `npx prisma migrate dev --name <descripcion>`.
Nunca edites una migración que ya se subió a `main`.

#### `Usuario`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | String (uuid) | PK |
| `correo` | String | único; se guarda en minúsculas |
| `contrasena` | String | hash bcrypt, nunca la contraseña en texto plano |
| `nombre` | String | |
| `creadoEn` | DateTime | fecha de registro |

### API

El backend expone:

- `GET /api/lugares`: lugares cercanos a unas coordenadas mediante Geoapify, por categoría, por los intereses que elige el usuario o por ambos, con sus horarios y su clasificación climática (`tipo_entorno`, `sensibilidad_clima`). Requiere `GEOAPIFY_API_KEY` en `backend/.env`.
- `GET /api/lugares/abiertos-ahora`: lugares cercanos a unas coordenadas cuyo horario publicado en Geoapify indica que están abiertos en este momento (`open_now: true`), evaluados en la zona horaria del lugar y ordenados por cercanía. Sin categoría ni intereses usa un conjunto acotado de categorías turísticas. Los lugares cerrados o sin horario verificable se excluyen. Lo consume el botón «Abierto ahora» del paso 4 del frontend.
- `POST /api/itinerarios/generar`: genera el itinerario completo a partir del destino, las fechas y los intereses. Geocodifica el destino (solo Guatemala), busca lugares reales cerca con Geoapify, consulta sus horarios y arma los días con Gemini o, si no hay `GEMINI_API_KEY`, con un planificador sin IA. Requiere `GEOAPIFY_API_KEY`. Lo consume el paso 4 del frontend.
- `POST /api/itinerarios/validar`: recibe una propuesta de itinerario, obtiene los horarios reales de cada lugar en Geoapify y devuelve el plan sin las paradas que estarían cerradas a la hora estimada de llegada. El frontend todavía no lo consume.
- `POST /api/itinerarios/priorizar-clima`: recibe la misma propuesta que `/validar` más las coordenadas del destino, clasifica cada lugar como `indoor` u `outdoor` con su sensibilidad al clima (regla del proyecto según las categorías de Geoapify), sugiere primero los lugares bajo techo en los días con lluvia pronosticada por OpenWeather y después valida los horarios sobre ese orden. El frontend todavía no lo consume.
- `POST /api/hoteles/recomendaciones`: hoteles cercanos al centro del itinerario de un día obtenidos de SerpApi (Google Hotels) para una noche, con su precio referencial en USD convertido a quetzales con la tasa de ExchangeRate-API, cuyo importe convertido no supera el 40 % del presupuesto diario. El precio es referencial y puede diferir del cargo final. No devuelve recomendaciones ni consulta proveedores si el usuario ya tiene hospedaje o no necesita hotel. Requiere `SERPAPI_API_KEY` y `EXCHANGERATE_API_KEY`. Lo consume el paso 4 del frontend.
- `POST /api/itinerarios/clima-reactivo/evaluar`, `/propuesta` y `/aceptar`: durante el día del itinerario, el paso 4 revisa el clima actual y el pronóstico de OpenWeather cada 12 minutos. Si detecta lluvia significativa o tormenta respecto a la revisión anterior, propone alternativas techadas cercanas de Geoapify con horario confirmado y un nuevo recorrido calculado con Valhalla y OR-Tools. Los cambios solo se aplican si el usuario los acepta.
- `GET /api/clima/pronostico`: resumen diario del clima para las fechas del viaje mediante OpenWeather; lo consume el paso 4 del frontend. Requiere `OPENWEATHER_API_KEY`.

```powershell
cd backend
npm install
npm test
npm start
```

Consulta [backend/README.md](backend/README.md) para la configuración, los parámetros, las categorías admitidas y los códigos de error.

## Optimizador y Valhalla

El optimizador (`optimizer/`, FastAPI + Google OR-Tools) calcula los tiempos y distancias de traslado entre paradas con [Valhalla](https://github.com/valhalla/valhalla) sobre datos de OpenStreetMap de Guatemala, en automóvil (`auto`) o a pie (`pedestrian`).

```powershell
docker compose up -d valhalla            # la primera vez descarga el mapa y construye el grafo (~10 min)
Invoke-RestMethod http://localhost:8002/status
docker compose up -d --build optimizer
```

Consulta [docs/valhalla.md](docs/valhalla.md) para la configuración (`VALHALLA_URL`), la preparación de los datos, ejemplos de consultas, las pruebas y los errores habituales, y [optimizer/API.md](optimizer/API.md) para el contrato de `/optimize` y `/reoptimize`.
