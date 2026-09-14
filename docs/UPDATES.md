# Actualizaciones de e-notario en Windows

## Canal actual: actualización sobre la instalación existente

El instalador NSIS de una versión nueva debe ejecutarse sobre la instalación actual. No se debe desinstalar previamente: el proceso reemplaza los binarios, actualiza la versión registrada y conserva `%LOCALAPPDATA%\e-notario-v2`, incluida la CA pública, las claves privadas, la configuración de red y la credencial Google cifrada con DPAPI.

Procedimiento operativo:

1. Finalizar las capturas pendientes y exportar cualquier imagen necesaria.
2. Cerrar e-notario; las capturas temporales en memoria se descartan al cerrar.
3. Ejecutar el instalador de la versión superior.
4. Abrir e-notario y comprobar la versión mostrada en el pie de la ventana.
5. Realizar una captura de control.

Se verificó una actualización real de `0.2.0` a `0.2.1` sin desinstalación previa y sin perder la configuración de oficina.

## Canal futuro: actualizador remoto firmado

Tauri Updater permite comprobar, descargar e instalar una versión desde la propia aplicación. Para habilitarlo de forma empresarial hacen falta dos decisiones de infraestructura que no deben improvisarse:

- un endpoint HTTPS corporativo que publique el manifiesto y los paquetes;
- una clave Ed25519 de actualización, cuya parte privada permanezca exclusivamente en el sistema de compilación y cuya parte pública se incluya en la aplicación.

El paquete remoto debe estar firmado y la aplicación debe verificar esa firma antes de instalar. En Windows se utilizará el modo `passive`, que muestra progreso y cierra la aplicación de forma controlada durante la actualización. No se habilitarán endpoints HTTP, claves de ejemplo ni ejecución de instaladores arbitrarios.
