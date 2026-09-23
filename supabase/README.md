# Control remoto de Fase 2

Este directorio contiene únicamente el control de despachos, cuentas, estaciones y licencias. CNIE, OCR de trabajo, campos jurídicos y DOCX no forman parte de su esquema ni de sus rutas.

## Estado

La migración, `control-v1`, el cliente tipado, la configuración local de Supabase CLI y el portal administrativo FR/AR constituyen la base de implementación. Windows y móvil ya aplican cuentas personales y autorizaciones locales en el repositorio. El entorno alojado del piloto es `valiris-desk-prod` (`zbngaqldayjyebvxqncq`) en `eu-central-1` (Frankfurt); la migración y `control-v1` están desplegadas, pero el piloto aún no está autorizado a clientes. La contratación y renovación son manuales.

## Componentes y secretos

- Proyecto Supabase gestionado con Auth, Postgres y Edge Functions. Activar claves JWT asimétricas y MFA TOTP para titulares y administradores de plataforma.
- Correo SMTP propio para invitaciones. El proveedor integrado de prueba no sirve para usuarios reales.
- La función usa `SUPABASE_SECRET_KEYS.default`, que Supabase inyecta automáticamente y mantiene fuera del repositorio. `CONTROL_SUPABASE_SECRET_KEY` queda como compatibilidad para entornos anteriores.
- `CONTROL_PORTAL_URL`: URL HTTPS del portal para completar invitaciones. Configurar también `/accept-invite` y `/recover` como redirecciones Auth permitidas y el hosting con fallback al `index.html`.
- `CONTROL_LEASE_PRIVATE_KEY_PKCS8_B64`: clave privada Ed25519 PKCS#8 codificada en base64 para autorizar trabajo local; nunca en el instalador ni en Git. La forma PEM anterior sigue admitida para rotaciones existentes.
- `CONTROL_LEASE_KEY_ID`: identificador público de esa clave. El instalador incluye solo su clave pública, con rotación controlada.

El portal usa solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` de `apps/control-portal/.env.example`; ninguna clave secreta se incluye en Vite. Debe publicarse por HTTPS con cabeceras CSP y `Cache-Control: no-store` para HTML. Las claves de firma de licencia y del actualizador Tauri deben ser diferentes. La cuenta de Google Vision permanece en cada estación del despacho.

La variante Windows de control usa los mismos dos valores públicos en `apps/desktop/.env.production` y recibe durante la compilación `ENOTARIO_CONTROL_LEASE_KEY_ID` y `ENOTARIO_CONTROL_LEASE_PUBLIC_KEY`. Durante una rotación puede recibir `ENOTARIO_CONTROL_LEASE_PUBLIC_KEYS` con entre uno y tres pares `kid=base64url` separados por `;`; la configuración antigua de una sola clave sigue siendo válida. La clave privada permanece únicamente como secreto de la función desplegada y como copia local protegida por Windows DPAPI para recuperación operativa.

Para producir el instalador firmado del piloto, configure además `ENOTARIO_SIGNING_THUMBPRINT` y `ENOTARIO_TIMESTAMP_URL`, y ejecute `powershell -File scripts/build-release.ps1 -Control` desde la raíz. El script valida la URL, la clave publicable, el `kid` y la clave pública antes de compilar, activa la característica Tauri `control` y comprueba la firma del sidecar y del instalador. Sin `-Control` mantiene la compilación local de Fase 1. Nunca pase `CONTROL_LEASE_PRIVATE_KEY_PEM` al proceso de compilación.

## Inicio y límites

La migración crea `control_platform_admins`, inicialmente vacía. TI crea la cuenta inicial confirmada en Auth y el administrador sustituye la credencial provisional mediante el flujo de recuperación del portal. Después, TI ejecuta `bootstrap/first-platform-admin.psql` por correo exacto. En el siguiente acceso, el portal obliga a enrolar TOTP antes de permitir operaciones de plataforma. No hay alta pública ni ruta de autoasignación de ese privilegio. El procedimiento completo está en `docs/PHASE2_PILOT_RUNBOOK.md`.

La función recibe el JWT del usuario, consulta Auth y la pertenencia vigente en cada solicitud, y usa la clave secreta solo del lado servidor. Las tablas tienen RLS activado y ningún permiso de lectura/escritura para `anon` o `authenticated`. Las operaciones con capacidad de estación, renovación y revocación se ejecutan en funciones SQL transaccionales. Una estación usa un par Ed25519 protegido localmente; el servicio exige una prueba sobre un reto de un solo uso antes de firmar una autorización de hasta siete días, limitada además por el vencimiento. Tras ese límite quedan como máximo 24 horas para finalizar trabajo temporal ya iniciado. La revocación de una estación desconectada no puede ser inmediata.

La API vive bajo `/functions/v1/control-v1`:

| Actor | Rutas principales |
|---|---|
| Cualquier cuenta autenticada | `GET /me` |
| Miembro activo | `GET /entitlement`, retos y autorización de su estación |
| Titular con MFA | Invitación/revocación/restauración de operadores; lista, activación y desactivación de PC |
| Administrador de plataforma con MFA | Alta de despacho, invitación/desactivación/restauración del titular y modificación de licencia |

Supabase Auth conserva los eventos de autenticación. `control_audit_events` registra los eventos administrativos mínimos de despacho, invitación, restauración y revocación de miembros, licencia, estación y emisión o renovación de autorizaciones locales; no contiene datos CNIE ni contenido documental.

La restauración de cuentas desactivadas se realiza por su UUID existente: no se vuelve a enviar una invitación que intente duplicar el usuario de Auth. Las listas del portal contienen solo correo y metadatos administrativos, incluido si la cuenta todavía no ha iniciado sesión y su invitación sigue pendiente. Si Auth no puede confirmar ese estado, la API devuelve `CONTROL_AUTH_UNAVAILABLE` en vez de presentar una cuenta como aceptada. Ninguna ruta recibe contenido documental.

La recuperación de acceso, cambio de PC, OCR, copia de configuración y rotación de claves se describen en `docs/PHASE2_SUPPORT_PLAYBOOK.md`.

## Verificación local

Desde `supabase/functions/control-v1`: `npx deno check index.ts` y `npx deno test lib_test.ts`. Desde la raíz: `pnpm --filter @notario/control-portal build` y `.venv/Scripts/python.exe -m pytest -q tests/test_control_grant.py`. La migración de producción se aplicó correctamente y la función desplegada respondió `401 CONTROL_AUTH_REQUIRED` a una solicitud sin sesión, confirmando arranque y rechazo de acceso anónimo. Aún faltan las pruebas reales de autorización y aislamiento entre despachos antes del piloto.
