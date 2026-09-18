# QA aislada del instalador Windows

Actualización del 18 de septiembre: consultar [Saneamiento de Fase 1](SANEAMIENTO_FASE1.md) para alpha.3, sus correcciones y evidencia vigente. Las evidencias alpha.1/alpha.2 siguientes mantienen su carácter histórico.

Estado: procedimiento de aceptación para versiones preliminares. Preparar un kit no significa haber ejecutado ni aprobado la instalación. El runner de kits no ejecuta instaladores sobre el puesto del desarrollador; la actualización real autorizada que se describe más abajo es evidencia separada, no una ejecución de esos kits.

## Estado actual al cierre de Fase 1

Referencia `0.8.0-alpha.2`, API 2, 17 de septiembre de 2026. Tras la actualización alpha.1 documentada abajo, se instaló alpha.2 en el mismo puesto autorizado `D:\e-notario`; se verificaron versión, arranque, acceso directo, catálogo y conservación de configuración OCR, perfiles, red y certificados. Existe copia preventiva local bajo `build/install-backups`, no distribuible.

El setup alpha.2 se generó antes de los dos cambios posteriores de fechas. Se reconstruyó e instaló el sidecar final con cifras 0–9 y orden `AAAA/MM/DD`, comprobando SHA-256 contra el origen y salud API 2. Esta evidencia corresponde al motor instalado, **no al contenido final del setup anterior**. Para distribuir hay que reconstruir todo el paquete y repetir verificación de recursos/hash e instalación.

Los kits Sandbox siguen sin ejecutarse por falta de Sandbox en este puesto; no se eludió su protección. La actualización de este PC no acredita instalación limpia, reparación o permisos de usuario estándar. El cierre funcional aceptado se recoge en la [documentación integral](DOCUMENTACION_FASE1.md), junto con los gates externos pendientes. Los hashes de las construcciones alpha.1 siguientes se conservan como historia, no se presentan como hashes vigentes de alpha.2.

## Construir y preparar

Compile las interfaces, empaquete el motor y construya el instalador NSIS de la versión actual. Para producción utilice exclusivamente [la publicación firmada](RELEASE_WINDOWS.md); un instalador alfa sin firma no se entrega a clientes.

```powershell
pnpm build
.\scripts\build-sidecar.ps1
pnpm --filter @notario/desktop tauri build
.\scripts\prepare-windows-qa.ps1 -Scenario Clean
.\scripts\prepare-windows-qa.ps1 -Scenario Upgrade
```

La preparación rechaza ejecutables e instaladores con otra versión. Para actualización exige el instalador original `0.7.2`; puede indicarse su ruta mediante `-PreviousInstaller`. Cada ejecución crea un kit distinto bajo `build/windows-qa`, con:

- instaladores copiados y su SHA-256;
- manifiesto con versión, compatibilidad API, estado Authenticode y hashes de todos los archivos que deben instalarse;
- script de aceptación que solo admite la cuenta desechable de Windows Sandbox y cuyo SHA-256 queda fijado en el manifiesto;
- `run.wsb` y directorio independiente `results`.

Tauri sustituye en la copia destinada a NSIS su marcador interno de tipo de bundle de `UNK` a `NSS`, sin modificar el ejecutable de compilación que queda en `target/release`. Por ello, el manifiesto conserva el hash del ejecutable de compilación como evidencia y calcula por separado el hash esperado del ejecutable instalado aplicando únicamente esa sustitución única. Un marcador ausente o duplicado invalida la preparación; no se omite el ejecutable principal de la verificación.

La carpeta de entrada se monta como solo lectura. Solo la carpeta de resultados admite escritura desde Sandbox; no se comparten configuración del despacho, credenciales, imágenes, DOCX personales ni el repositorio completo. Se desactiva la redirección del portapapeles. La red se mantiene habilitada para que el instalador pueda obtener WebView2 cuando sea necesario.

Antes de instalar, el runner compara su propio SHA-256 con el manifiesto preparado. Una modificación posterior del script invalida el kit y obliga a prepararlo de nuevo; editar el runner dentro del directorio de entrada no constituye una ejecución válida.

Abra cada `run.wsb` en una sesión nueva de Windows Sandbox. No ejecute `test-windows-sandbox.ps1` en el PC principal: su comprobación inicial lo rechaza. El script puede sustituir y reinstalar e-notario únicamente dentro del entorno desechable. No desinstala ni borra carpetas del host.

## Comprobaciones automáticas

En ambos escenarios se comprueban los hashes del paquete, la instalación silenciosa, el registro por usuario y su versión, todos los binarios y recursos instalados y el arranque del motor instalado con la API esperada.

La actualización instala primero `0.7.2`, arranca su motor para generar configuración de oficina de prueba y añade un marcador DPAPI sintético. Después instala la versión superior sin desinstalación manual y exige que todos esos archivos conserven el mismo hash. El marcador no es una credencial Google ni pretende validar una configuración OCR real.

En la versión nueva se crean un perfil y un expediente sintéticos mediante la API instalada. Se termina deliberadamente solo el proceso del motor iniciado por la prueba, se reinstala la misma versión y se comprueban tanto la conservación del catálogo de perfiles como la recuperación de los dos recursos. La plantilla se consulta en el catálogo instalado, sin fijar una versión antigua en el script. Esta prueba de reparación no se confunde con la actualización desde `0.7.2`, que todavía no disponía de perfiles profesionales.

`results/result.json` contiene estado, etapas comprobadas, versión, escenario, número de archivos y gates manuales pendientes. No incluye tokens, nombres de personas, claves privadas, valores CNIE ni el contenido de las bases cifradas. Un fallo devuelve estado `failed` y una etapa concreta. Un resultado `passed` solo acredita las comprobaciones enumeradas.

El motor instalado vincula además una sesión móvil sintética, crea un expediente de su propiedad y exige `403` al intentar generar, completar o reabrirlo desde esa sesión. Una respuesta de éxito, un error de red o cualquier código distinto de `403` hace fallar la comprobación. Después de la reparación exige que la misma sesión pueda recuperar su expediente. Esto no prueba cámara ni un teléfono físico.

## Gates que siguen siendo manuales

- Instalación en una cuenta Windows estándar real: la cuenta predeterminada de Sandbox no acredita este requisito.
- Arranque e interacción de la interfaz Tauri/WebView2 y compatibilidad interfaz–motor.
- Captura, datos aprobados y flujo completo PC–móvil en teléfonos físicos.
- Cancelación del diálogo nativo, guardado correcto y apertura de Word o alternativa de Explorador.
- Render y edición del DOCX en Microsoft Word soportado y aprobación jurídica.
- Publicación Authenticode con el certificado y sellado de tiempo de la organización.

Una instalación con datos de prueba nunca contiene la credencial ni los documentos de un despacho real. La copia de una credencial DPAPI de otro usuario no constituye una prueba válida: DPAPI está vinculada a la cuenta Windows que la creó.

## Recursos del puesto de compilación

Debe haber espacio suficiente tanto en el volumen del repositorio como en el de temporales de Windows, y memoria disponible para Rust. Si un equipo tiene poca memoria, limite `CARGO_BUILD_JOBS` y utilice `TEMP`/`TMP` dentro de un directorio de compilación en un volumen con capacidad. Estos cambios deben limitarse al proceso y restaurarse al terminar. No se libera espacio borrando datos del usuario como parte de una compilación.

El 17 de septiembre de 2026 se validaron la sintaxis de ambos scripts con Windows PowerShell y el rechazo del runner fuera de Sandbox. La ejecución funcional de los escenarios requiere un entorno Sandbox disponible y sus respectivos informes; no se considera aprobada solo por esas pruebas del script.

## Evidencia del paquete preliminar — 17 de septiembre de 2026

Se completó la compilación Tauri/NSIS de `0.8.0-alpha.1` y se prepararon los kits independientes `Clean` y `Upgrade`. Ambos manifiestos incluyen 8.733 archivos instalables y el mismo instalador de 97.549.608 bytes, con SHA-256 `9DDE3BA05C9A5856BA7205CC1105BA72ADADE7E2984A7A6E376764837DBBE282`. El ejecutable y el instalador declaran la versión preliminar esperada. Authenticode devuelve `NotSigned` y los manifiestos mantienen `production_approved: false`.

Ese primer paquete fue retirado como candidato de QA tras detectar y corregir la autorización del endpoint de reapertura. Su hash identifica únicamente una construcción histórica, no el código corregido. Deben reconstruirse el sidecar, el instalador y los kits antes de cualquier prueba de aceptación.

El instalador histórico se conserva con extensión `.exe.retired`, fuera del nombre esperado por la preparación de kits. Las configuraciones `run.wsb` de esos dos kits fueron desactivadas con `QA_PACKAGE_RETIRED_REBUILD_REQUIRED`; no se borraron los paquetes históricos ni se modificó la instalación real.

Después de la corrección se reconstruyó completamente el sidecar y Tauri/NSIS. El candidato vigente mide 97.555.970 bytes y su SHA-256 es `B7ED4606410CE122B533B811DC8CAD604BFFC911805C2AD2878C626730CAA753`; los nuevos kits `Clean` y `Upgrade` fijan ese mismo hash y los 8.733 archivos esperados. Sigue siendo `NotSigned` y `production_approved: false`. Se verificó además que el bytecode de `cnie_capture.api` incluido en PyInstaller corresponde al fuente corregido y que el motor empaquetado devuelve `403` para generar, completar y reabrir desde una sesión móvil sintética. Esto no cambia los gates de instalación, Word y firma.

Los kits todavía no se ejecutaron: este puesto no dispone de Windows Sandbox. No se quitó ni se eludió la protección del runner Sandbox.

Con autorización expresa se efectuó además una actualización controlada de la instalación real de este puesto, desde `0.7.2` hasta `0.8.0-alpha.1`, conservando el destino `D:\e-notario`. Antes de instalar se creó una copia recuperable de la configuración y del registro de desinstalación. Después de instalar se verificaron los 8.733 archivos contra el manifiesto corregido —incluido el ejecutable principal con la marca NSIS esperada— sin ausencias ni diferencias. Los diez archivos de configuración preexistentes, 34.595 bytes en total, conservaron exactamente sus hashes SHA-256. El registro, el `ProductVersion` y el acceso directo apuntan a la versión y ruta esperadas.

El motor instalado se inició además con `LOCALAPPDATA`, `TEMP` y `TMP` aislados bajo `D:` y datos exclusivamente sintéticos. Respondió como `0.8.0-alpha.1`, API 2, publicó las dos plantillas y rechazó con `403` las tres operaciones móviles reservadas a Windows: generar, completar y reabrir. Finalmente se abrió la aplicación instalada de forma normal y se confirmó que su proceso hijo responde al contrato de salud esperado. Esta evidencia acredita la actualización concreta de este puesto; no sustituye una instalación limpia, una reparación ni el escenario de actualización reproducible en una máquina desechable.

Antes de instalar puede comprobarse el contrato del motor realmente empaquetado, con una sesión y un expediente exclusivamente sintéticos almacenados bajo `build/packaged-engine-smoke`:

```powershell
.\scripts\smoke-packaged-engine.ps1
```

La prueba exige API 2, catálogo de matrimonio y respuestas `403` del ejecutable empaquetado cuando la sesión móvil intenta generar, completar o reabrir su expediente. No utiliza la configuración real, no instala nada y termina únicamente el proceso que inicia; tampoco sustituye los escenarios NSIS.
