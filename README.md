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

lucia/backend-bd-caching
Backend en **Node.js** con **PostgreSQL** y **Prisma**.

## Requisitos
- Node.js 18+
- PostgreSQL 14+

## Puesta en marcha
```bash
cd backend
npm install
cp .env.example .env            # edita DATABASE_URL con tus datos
createdb guia_turistica         # o créala desde pgAdmin
npx prisma migrate dev          # aplica las migraciones y genera el cliente de Prisma
```

Cada vez que hagas `git pull` y haya migraciones nuevas, vuelve a correr `npx prisma migrate dev`.

## Base de datos
El esquema está en [`prisma/schema.prisma`](prisma/schema.prisma) y las migraciones en `prisma/migrations/`.
Para cambiar el esquema: edita `schema.prisma` y corre `npx prisma migrate dev --name <descripcion>`.
Nunca edites una migración que ya se subió a `main`.

### `Usuario`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | String (uuid) | PK |
| `correo` | String | único; se guarda en minúsculas |
| `contrasena` | String | hash bcrypt, nunca la contraseña en texto plano |
| `nombre` | String | |
| `creadoEn` | DateTime | fecha de registro |

## Backend y consulta de lugares de interés

El backend (Node.js 20 o superior) expone `GET /api/lugares`, que consulta lugares cercanos a unas coordenadas mediante Geoapify, por categoría, por los intereses que elige el usuario o por ambos. Requiere la variable `GEOAPIFY_API_KEY` en `backend/.env`.

```powershell
cd backend
npm install
npm test
npm start
```

Consulta [backend/README.md](backend/README.md) para la configuración, los parámetros, las categorías admitidas y los códigos de error.
main
