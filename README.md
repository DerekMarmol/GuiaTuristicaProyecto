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