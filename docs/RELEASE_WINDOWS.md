# Publicación Windows firmada

La distribución de producción debe usar un certificado Authenticode de la organización con uso extendido **Code Signing** y una autoridad de sellado de tiempo RFC 3161. No se acepta un certificado autofirmado para clientes.

## Preparación del puesto de compilación

1. Instale el certificado con su clave privada en `Cert:\CurrentUser\My` y limite el acceso a la cuenta de publicación.
2. Instale las herramientas de firma del Windows SDK.
3. Defina el thumbprint público y la URL de sellado proporcionada por la autoridad:

```powershell
$env:ENOTARIO_SIGNING_THUMBPRINT = 'THUMBPRINT_SIN_ESPACIOS'
$env:ENOTARIO_TIMESTAMP_URL = 'https://timestamp.proveedor.example'
```

No se guarda la contraseña, la clave privada ni un PFX en el repositorio.

## Construcción y verificación

```powershell
.\scripts\build-release.ps1
```

El script exige primero que pasen las suites Python, UI, TypeScript y Rust. Localiza `rc.exe` del Windows SDK cuando no está en PATH y restaura la configuración del proceso al terminar. Después compila ambas interfaces, empaqueta el sidecar, firma el sidecar, entrega a Tauri una configuración de firma temporal, crea el instalador NSIS y comprueba mediante `Get-AuthenticodeSignature` que el sidecar, el ejecutable principal y el instalador de la versión actual tienen estado `Valid` y el thumbprint esperado. Un fallo de pruebas, compilación o firma hace fallar la publicación; no se certifica un instalador antiguo que haya quedado en la carpeta de salida.

La configuración sigue los campos oficiales `certificateThumbprint`, `digestAlgorithm` y `timestampUrl` de Tauri 2. El certificado y el servidor de tiempo deben ser los aprobados por la organización.

El empaquetado toma hashes SHA-256 de los recursos web y de las plantillas antes de construir. Al terminar exige que cada recurso exista en el runtime y coincida con el origen, y que el origen no haya cambiado durante la operación. No se deben ejecutar compilaciones web paralelas mientras se empaqueta el sidecar.

## Gate de publicación

La [QA aislada del instalador](WINDOWS_INSTALLATION_QA.md) prepara escenarios separados de instalación limpia y actualización desde `0.7.2`, con hashes de todos los recursos y recuperación tras reparación. Sus informes no sustituyen la prueba en una cuenta estándar, la interfaz nativa ni la firma de producción.

- suites Python, UI, tipos, pruebas nativas Rust (incluida DPAPI) y builds en verde;
- fixtures DOCX y revisión visual en Microsoft Word;
- firma válida del sidecar y del instalador;
- prueba de actualización sobre la versión anterior sin perder perfiles o configuración;
- instalación limpia en una cuenta Windows estándar;
- registro del hash SHA-256 del instalador aprobado.
