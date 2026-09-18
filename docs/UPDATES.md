# Actualizaciones de e-notario en Windows

Actualización del 18 de septiembre: consultar [Saneamiento de Fase 1](SANEAMIENTO_FASE1.md) para alpha.3, sus correcciones y evidencia vigente. Las evidencias alpha.1/alpha.2 siguientes mantienen su carácter histórico.

## Estado del puesto al cierre de Fase 1

El 17 de septiembre de 2026 se actualizó el puesto autorizado a `0.8.0-alpha.2` en `D:\e-notario`, conservando configuración OCR, perfiles, red y certificados y comprobando arranque/acceso directo. Después de construir ese setup se ajustó dos veces el formato de fechas por decisión del producto: primero cifras normales y finalmente `AAAA/MM/DD`.

Se reconstruyó el sidecar final, se sustituyó el motor instalado y se comprobó igualdad SHA-256 con el origen y salud `0.8.0-alpha.2`, API 2. **La instalación local tiene la corrección final, pero el setup alpha.2 construido antes no acredita esos hotfixes.** Antes de distribuirlo se deben reconstruir sidecar/app/setup como paquete coherente, comprobar recursos y registrar hash del nuevo instalador. No copiar un ejecutable suelto como procedimiento normal de actualización de clientes.

El cierre funcional aceptado no acredita firma comercial, instalación limpia o reparación en entorno desechable. Véanse [documentación integral de Fase 1](DOCUMENTACION_FASE1.md) y [QA Windows](WINDOWS_INSTALLATION_QA.md).

## Canal actual: actualización sobre la instalación existente

El instalador NSIS de una versión nueva debe ejecutarse sobre la instalación actual. No se debe desinstalar previamente: el proceso reemplaza los binarios, actualiza la versión registrada y conserva `%LOCALAPPDATA%\e-notario-v2`, incluida la CA pública, las claves privadas, la configuración de red y la credencial Google cifrada con DPAPI.

Procedimiento operativo:

1. Finalizar las capturas pendientes y exportar cualquier imagen necesaria.
2. Cerrar e-notario; desde 0.8.0 los datos temporales permanecen cifrados hasta caducar y pueden reanudarse. Si no deben conservarse, use «Limpiar sesión» antes de cerrar.
3. Ejecutar el instalador de la versión superior.
4. Abrir e-notario y comprobar la versión mostrada en el pie de la ventana.
5. Realizar una captura de control.

La interfaz comprueba la compatibilidad de versión con el motor antes de abrir el puesto. Una instalación mezclada se bloquea y debe repararse con el paquete completo. Las publicaciones de producción se construyen con [el procedimiento de firma verificada](RELEASE_WINDOWS.md).

Se verificaron actualizaciones reales sin desinstalación previa, incluida `0.6.0 → 0.6.1`; la comprobación conservó los tres archivos de configuración local con hashes idénticos y verificó el binario instalado frente al paquete construido.

La aceptación `0.7.2 → 0.8.0-alpha.1` se prepara con el [kit aislado de instalación](WINDOWS_INSTALLATION_QA.md). No está acreditada hasta disponer de su informe de ejecución y de las comprobaciones manuales pendientes; no se reutiliza la evidencia de `0.6.0 → 0.6.1` para aprobar esta transición.

## Canal futuro: actualizador remoto firmado

Tauri Updater permite comprobar, descargar e instalar una versión desde la propia aplicación. Para habilitarlo de forma empresarial hacen falta dos decisiones de infraestructura que no deben improvisarse:

- un endpoint HTTPS corporativo que publique el manifiesto y los paquetes;
- una clave Ed25519 de actualización, cuya parte privada permanezca exclusivamente en el sistema de compilación y cuya parte pública se incluya en la aplicación.

El paquete remoto debe estar firmado y la aplicación debe verificar esa firma antes de instalar. En Windows se utilizará el modo `passive`, que muestra progreso y cierra la aplicación de forma controlada durante la actualización. No se habilitarán endpoints HTTP, claves de ejemplo ni ejecución de instaladores arbitrarios.
