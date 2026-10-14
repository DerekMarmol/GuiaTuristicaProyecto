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

- `GET /api/lugares`: lugares cercanos a unas coordenadas mediante Geoapify, por categoría, por los intereses que elige el usuario o por ambos, con sus horarios. Requiere `GEOAPIFY_API_KEY` en `backend/.env`.
- `POST /api/itinerarios/validar`: recibe una propuesta de itinerario, obtiene los horarios reales de cada lugar en Geoapify y devuelve el plan sin las paradas que estarían cerradas a la hora estimada de llegada. El frontend todavía no lo consume.
- `GET /api/clima/pronostico`: resumen diario del clima para las fechas del viaje mediante OpenWeather; lo consume el paso 4 del frontend. Requiere `OPENWEATHER_API_KEY`.

```powershell
cd backend
npm install
npm test
npm start
```

Consulta [backend/README.md](backend/README.md) para la configuración, los parámetros, las categorías admitidas y los códigos de error.
