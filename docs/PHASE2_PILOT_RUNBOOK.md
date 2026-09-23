# Runbook del piloto de Fase 2

Este procedimiento cubre la puesta en marcha controlada del primer entorno y de cada despacho piloto. No almacena documentos, OCR ni datos jurídicos en Supabase. Los nombres de secretos y las rutas coinciden con la implementación del repositorio.

## 1. Preparar el entorno

1. Crear un único proyecto Supabase alojado en `eu-central-1` (Frankfurt) usando inicialmente el nivel gratuito y registrar su referencia. El entorno de ensayo continúa local. Revisar el paso a pago antes de incorporar el sexto despacho, o antes si los límites, pausas, copias o soporte resultan insuficientes.
2. Publicar el portal bajo un dominio HTTPS propio. Configurar en Auth ese dominio como Site URL y permitir exactamente estas redirecciones:
   - `https://<portal>/accept-invite`
   - `https://<portal>/recover`
3. En Auth del proyecto alojado, desactivar el alta pública y anónima; mantener el acceso por invitación y correo confirmado; exigir al menos 12 caracteres para nuevas contraseñas; habilitar enrolamiento y verificación TOTP. Comprobar estos valores en el panel antes de invitar a nadie. La obligatoriedad de TOTP para titulares y administradores la aplica además `control-v1` al exigir `aal2`.
4. Activar claves de firma JWT asimétricas para sesiones Auth. La clave de firma JWT de Supabase es distinta de la Ed25519 usada para las autorizaciones locales de Windows.
5. Configurar un SMTP transaccional propio en su nivel gratuito y comprobar la entrega de una invitación y de una recuperación de contraseña. No usar el proveedor de correo de prueba de Supabase para el piloto.
6. Obtener la URL del proyecto, la clave publicable y una clave secreta de servidor. La clave secreta solo se configura en Edge Functions.
7. Generar un par Ed25519 exclusivo para autorizaciones locales y asignarle un `kid` estable. Guardar la clave privada en el gestor de secretos; conservar solo la clave pública base64url en el proceso de compilación Windows. No reutilizar la clave de firma del actualizador o del instalador.

## 2. Desplegar base de datos y API

Desde la raíz del repositorio, con Supabase CLI autenticado. Preparar fuera del repositorio un archivo temporal de secretos aceptado por `supabase secrets set --env-file`; debe contener `CONTROL_SUPABASE_SECRET_KEY`, `CONTROL_PORTAL_URL`, `CONTROL_LEASE_PRIVATE_KEY_PEM` y `CONTROL_LEASE_KEY_ID`. Restringir su lectura al usuario que despliega y borrarlo al terminar.

El repositorio ya está inicializado para Supabase CLI mediante `supabase/config.toml`. Su configuración Auth local reproduce las barreras del piloto (sin alta pública, contraseña de 12 caracteres y TOTP disponible). La pasarela deja llegar las peticiones a `control-v1`; la función exige `Authorization: Bearer` y verifica el token con Supabase Auth en cada solicitud antes de comprobar membresía y MFA. Así el piloto no depende de que la verificación heredada de la pasarela acepte las claves JWT asimétricas. `supabase db push` aplica solo las migraciones: no sustituye los ajustes de Auth del paso 1. No ejecutar `supabase config push` con este archivo local, porque incluye la URL `127.0.0.1` para desarrollo. Dominio, SMTP y claves del proyecto alojado se configuran explícitamente y no se versionan.

```powershell
$projectRef = 'PROJECT_REF'
$secretFile = 'C:\ruta-segura\control-secrets.env'
supabase link --project-ref $projectRef
supabase db push
supabase secrets set --project-ref $projectRef --env-file $secretFile
supabase functions deploy control-v1 --project-ref $projectRef
Remove-Item -LiteralPath $secretFile
```

Comprobar en el panel que la migración `202609200001_control_v1.sql` figura aplicada y que la función no registra `CONTROL_CONFIGURATION_MISSING`. No escribir valores reales en la línea de comandos, `.env` versionados, historial de PowerShell ni incidencias de soporte.

## 3. Publicar el portal

Crear el proyecto desde **Workers & Pages → Create application → Pages → Import an existing Git repository**. No crear un Worker y no definir `npx wrangler deploy`: el portal es un sitio estático de Pages dentro de un monorepo.

Configurar el build de Cloudflare Pages así:

```text
Root directory: (vacío; raíz del repositorio)
Build command: pnpm --filter @notario/control-portal build
Build output directory: apps/control-portal/dist
Deploy command: (ninguno)
```

Añadir como variables de producción y de vista previa:

```text
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=PUBLISHABLE_KEY
```

La compilación genera `_redirects` para el fallback SPA y `_headers` con CSP, cabeceras de seguridad y `Cache-Control: no-store` para las rutas del portal; los assets con hash conservan caché larga. Abrir `/recover` directamente para confirmar que el hosting no devuelve 404.

La CSP del portal debe limitar `connect-src` al propio origen y a `https://PROJECT_REF.supabase.co`; no usar `https://*.supabase.co`. El paquete Windows de control aplica automáticamente esa misma restricción al host exacto recibido durante la compilación.

## 4. Crear el primer administrador de plataforma

1. Desde Auth, crear una cuenta confirmada para el correo nominativo del administrador con una contraseña provisional aleatoria. No comunicar ni reutilizar esa contraseña y no usar una cuenta compartida. Este paso manual existe solo para romper el ciclo de confianza inicial.
2. El administrador abre el portal, usa «Mot de passe oublié ?» y establece desde `/recover` su contraseña personal de al menos 12 caracteres. TI comprueba que la recuperación terminó y descarta la credencial provisional.
3. Ejecutar el bootstrap contra la conexión directa de Postgres. El script selecciona una sola cuenta por correo exacto, exige correo confirmado y es idempotente:

```powershell
$env:SUPABASE_DB_URL = 'DIRECT_POSTGRES_CONNECTION_STRING'
psql "$env:SUPABASE_DB_URL" -v admin_email='admin@example.com' `
  -f supabase/bootstrap/first-platform-admin.psql
Remove-Item Env:SUPABASE_DB_URL
```

El resultado debe mostrar `platform_admin = t`. El bootstrap rechaza una cuenta que ya pertenezca a un despacho, y las funciones de membresía rechazan usar posteriormente una cuenta de plataforma como titular u operador. Al volver a iniciar sesión, el portal obliga a enrolar y verificar TOTP antes de permitir cualquier operación de plataforma. Guardar los códigos de recuperación o el procedimiento de recuperación MFA en el soporte interno; una sesión `aal1` nunca puede crear despachos ni modificar licencias.

## 5. Dar de alta un despacho

El administrador, ya autenticado con TOTP:

1. Crea el despacho con límite de 1–3 estaciones y una fecha de fin futura.
2. Invita al titular por correo desde el despacho creado.
3. El titular acepta la invitación, define su contraseña y el portal le obliga a verificar TOTP.
4. El titular invita a los operadores. Los operadores usan cuenta personal y no requieren TOTP en el piloto.
5. En cada PC, el titular inicia sesión, activa la estación y obtiene la primera autorización local firmada.
6. Cada operador inicia su propia sesión en Windows. Para enlazar un móvil, inicia sesión con esa misma cuenta y escanea el QR de la estación.

No crear un segundo despacho para un usuario existente: cada cuenta del piloto pertenece como máximo a un despacho. Para recuperar una cuenta revocada se usa la acción de restauración por UUID, no una nueva invitación.

Si una invitación falla después de que Auth haya creado la cuenta pero antes de guardar su membresía, se puede reenviar al mismo correo desde el portal. `control-v1` completa automáticamente solo esa invitación pendiente y envía un enlace de recuperación para establecer la contraseña. Una cuenta que ya inició sesión, una cuenta revocada, un administrador de plataforma o un miembro de otro despacho no entra en esta recuperación y debe tratarse mediante su flujo administrativo explícito.

## 6. Validación de aceptación

Hacer una sola pasada registrada en el entorno real antes de distribuir el instalador:

- Administrador sin TOTP: puede identificarse, pero no crear despachos. Con TOTP: crea un despacho y su licencia.
- Titular sin TOTP: no administra miembros ni estaciones. Con TOTP: invita un operador y activa un PC.
- Operador: ve solo sus expedientes temporales, recibe la URL móvil y no puede cambiar red, miembros, estaciones ni OCR.
- Aislamiento: cuentas de un segundo despacho no ven ni operan recursos del primero.
- Estación: una clave no puede reutilizarse en otro despacho y el límite de 1–3 PC se respeta.
- Desconexión: una autorización válida permite hasta siete días; al terminar, solo deja revisar trabajo existente y guardar Word durante un máximo de 24 horas.
- Revocación y suspensión: bloquean la siguiente renovación; documentar que una estación ya desconectada conserva su autorización firmada hasta su vencimiento.
- Idiomas: completar invitación, TOTP, administración, activación Windows y enlace móvil en francés y en árabe RTL.

Registrar fecha, responsable, versión del instalador, `kid`, despacho/estaciones usados y resultado. No incluir correos personales completos, tokens, claves ni contenido documental en el acta.

## 7. Compilar y entregar Windows

En el puesto de compilación con certificado de firma instalado:

```powershell
$env:VITE_SUPABASE_URL = 'https://PROJECT_REF.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'PUBLISHABLE_KEY'
$env:ENOTARIO_CONTROL_LEASE_KEY_ID = 'LEASE_KEY_ID'
$env:ENOTARIO_CONTROL_LEASE_PUBLIC_KEY = 'ED25519_PUBLIC_BASE64URL'
$env:ENOTARIO_SIGNING_THUMBPRINT = 'CERTIFICATE_THUMBPRINT'
$env:ENOTARIO_TIMESTAMP_URL = 'https://TIMESTAMP_SERVICE'
powershell -File scripts/build-release.ps1 -Control
```

El script exige un árbol Git completamente registrado y sin cambios, rechaza secretos del servidor en el entorno de compilación y comprueba la firma del sidecar y del instalador. Junto al instalador genera `valiris-desk_<versión>_control-release.json` con commit, variante, fecha UTC, firmante, host Supabase, `kid`, tamaño y SHA-256; nunca incluye la clave publicable completa ni claves criptográficas. Distribuir solo el artefacto firmado que superó la validación de aceptación y conservar ese manifiesto junto al acta del piloto.

Para una versión puente de rotación, sustituir las dos variables de clave individual por `ENOTARIO_CONTROL_LEASE_PUBLIC_KEYS='KID_A=PUBLIC_A;KID_B=PUBLIC_B'`. Seguir el orden completo de `PHASE2_SUPPORT_PLAYBOOK.md`; la función debe continuar firmando con A hasta que los PC hayan recibido esa versión.
