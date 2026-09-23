# Soporte operativo del piloto de Fase 2

Este playbook cubre las incidencias previsibles del piloto sin crear una consola de soporte compleja. El soporte verifica identidad antes de cambiar una cuenta o una estación y nunca solicita imágenes CNIE, OCR, expedientes, Word, contraseñas, códigos TOTP, tokens ni claves privadas.

## Recuperación de contraseña

1. El usuario abre el portal y selecciona «Mot de passe oublié ?».
2. Introduce su correo y usa el enlace que llega desde el SMTP configurado.
3. Define una contraseña nueva de al menos 12 caracteres.
4. Si es titular o administrador, completa además su TOTP al iniciar sesión.

El mensaje del portal no revela si un correo existe. Si no llega el enlace, soporte comprueba entrega SMTP, carpeta de correo no deseado y que la URL `/recover` está permitida en Auth. No se crea otra cuenta con el mismo correo.

## Pérdida de TOTP

La recuperación de un titular o administrador requiere verificación humana de identidad por un responsable distinto del solicitante. Un administrador autorizado elimina el factor perdido desde Auth; el siguiente acceso al portal obliga a enrolar y verificar un TOTP nuevo antes de ofrecer operaciones privilegiadas.

Antes de incorporar clientes deben existir dos cuentas nominativas de administrador de plataforma, ambas con TOTP, para evitar que la pérdida de un único dispositivo bloquee todo el piloto. La segunda cuenta se confirma y se promociona con el mismo script idempotente `supabase/bootstrap/first-platform-admin.psql`.

## Invitación no recibida o caducada

Si el portal confirmó la invitación pero el correo no llegó o caducó, el usuario abre el portal y usa la recuperación de contraseña; no se repite el alta ni se cambia su UUID. Si el portal devolvió error porque Auth creó la cuenta pero la membresía no llegó a guardarse, el responsable puede reenviar una vez al mismo correo: la función completa esa cuenta pendiente sin sustituir su UUID. Si la cuenta fue desactivada, titular o plataforma usa «Réactiver» sobre la membresía existente.

## Cambio, pérdida o avería de PC

1. El titular desactiva la estación anterior en el portal. Si el equipo está perdido, registra la hora del incidente.
2. Instala el paquete firmado vigente en el PC nuevo.
3. Inicia sesión con TOTP, activa la nueva estación y obtiene una autorización local.
4. Reimporta la credencial Google Vision desde el gestor de secretos del despacho y vuelve a configurar la LAN móvil.

No se copia `control-station.dpapi` a otro PC: hacerlo clonaría la identidad de estación. Una estación perdida y desconectada puede usar su autorización ya firmada hasta su vencimiento; la desactivación impide la siguiente renovación, que es el límite explícito del modo offline.

Los expedientes temporales locales no se migran entre estaciones. Si el PC antiguo todavía funciona, se terminan y guardan los Word antes del cambio. Los Word guardados siguen la política documental del despacho fuera de Valiris Desk.

## Cuenta o estación revocada por error

- **Cuenta:** restaurar la membresía existente por UUID. El usuario conserva su contraseña y, si corresponde, TOTP; después renueva su autorización en cada PC.
- **Estación:** una estación desactivada no se reactiva ni reutiliza su clave. Cerrar completamente Valiris Desk y, desde la misma cuenta Windows que activó el PC, ejecutar `"<carpeta de instalación>\sidecar\cnie-capture.exe" reset-control-station --station-id <UUID_DESACTIVADO>`. El comando abre el estado protegido, exige que el UUID coincida exactamente y elimina únicamente `control-station.dpapi`; conserva OCR, perfiles, expedientes temporales, recibos y Word. Al iniciar de nuevo, el titular activa una estación nueva desde Windows. Si falla la coincidencia o lectura DPAPI, no se borra nada.
- **Licencia suspendida:** plataforma elimina la suspensión o corrige la fecha. Las estaciones deben conectarse para renovar; no se sustituyen manualmente los tokens locales.

## Google Vision

1. El titular abre la configuración OCR y ejecuta la prueba de conexión.
2. Si falta credencial o fue revocada, importa una cuenta de servicio válida guardada por el despacho.
3. Si hay cuota agotada, comprueba los límites local y del proyecto Google antes de reintentar.
4. Si Google no está disponible, conserva el expediente local y reintenta cuando vuelva el servicio; no envía la CNIE por correo a soporte.

La cuenta Google permanece en cada estación protegida con DPAPI. No forma parte de Supabase ni del instalador.

## Copia de seguridad de configuración

La copia empresarial del perfil Windows puede conservar los archivos DPAPI para recuperación en el mismo perfil y equipo administrado. Antes de cambios del sistema se respalda de forma cifrada `%LOCALAPPDATA%\e-notario-v2` conforme a la política del despacho. Esta copia contiene secretos y no debe subirse a incidencias ni almacenamiento personal.

Para reconstruir un PC distinto se usan las fuentes de configuración, no una copia de la identidad de estación:

- credencial Google Vision desde el gestor de secretos;
- perfiles profesionales reintroducidos si la protección DPAPI anterior no puede recuperarse;
- nueva configuración LAN y certificados;
- nueva activación de estación desde el portal.

`temporary-workspace.sqlite3`, `temporary-cases.sqlite3` y recibos son trabajo temporal, no un sistema de archivo. La recuperación de Word se hace desde la ubicación donde el usuario lo guardó.

## Rotación de la clave Ed25519 de autorizaciones

La aplicación acepta hasta tres claves públicas durante una transición. La API firma siempre con una sola clave privada y `kid` actual.

Rotación ordinaria de A hacia B:

1. Generar B fuera del repositorio y guardar su privada en el gestor de secretos.
2. Mantener la función firmando con A. Compilar y distribuir una versión puente con:
   `ENOTARIO_CONTROL_LEASE_PUBLIC_KEYS=A_KID=A_PUBLIC_BASE64URL;B_KID=B_PUBLIC_BASE64URL`.
3. Confirmar que todos los PC activos ejecutan la versión puente.
4. Cambiar en Edge Functions `CONTROL_LEASE_PRIVATE_KEY_PEM` y `CONTROL_LEASE_KEY_ID` a B de forma conjunta.
5. Renovar las estaciones y esperar al menos ocho días desde la última firma con A: siete días de trabajo nuevo más el margen de 24 horas.
6. Distribuir una versión que confíe solo en B y retirar la privada A del servicio, conservándola únicamente según la política de custodia/auditoría.

No cambiar primero la función: los instaladores que aún conocen solo A rechazarían autorizaciones firmadas por B. Si A se compromete, se cambia a B cuanto antes; las autorizaciones A ya emitidas y desconectadas no pueden revocarse antes de su expiración máxima.

## Registro mínimo del incidente

Registrar identificador interno, fecha/hora, despacho, tipo de incidencia, estación o UUID afectado, responsable, acción y resultado. Enmascarar el correo. No copiar trazas con tokens o secretos. Para investigar cambios administrativos se consulta `control_audit_events`, que contiene acciones y UUID técnicos sin contenido documental.
