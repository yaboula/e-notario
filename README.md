# Valiris Desk · expediente local profesional · 0.8.0-alpha.4

Base profesional para capturar una CNIE desde Windows o desde un móvil autorizado, revisar sus 14 valores y completar documentos Word formales. La versión 0.8.0-alpha.4 consolida la Fase 1: expediente temporal cifrado, relleno completo de campos jurídicos, perfiles frecuentes o escritos directamente y colaboración PC–móvil por campo. Conserva intactos `cnie.ma.2020/v2` y el piloto `cnie.ma.legacy/v1`.

Los perfiles de adules, responsables y jueces se administran desde Windows antes o durante la preparación. Pueden corregirse sin romper expedientes existentes; un perfil utilizado no puede desactivarse ni borrarse hasta sustituirlo en todos los expedientes activos. El borrado definitivo exige desactivarlo primero.

Esta fase contiene dos interfaces nuevas e independientes de v1:

- **Estación Windows**: captura, revisión, expedientes cifrados, perfiles profesionales, revisión final, generación, guardado atómico y apertura del DOCX con la aplicación asociada.
- **Captura móvil PWA**: captura y revisión de los 14 valores propios, preparación parcial o completa y colaboración sobre campos jurídicos. No recibe DOCX, OCR completo, diagnósticos ni identidades ajenas.

La detección, rectificación, extracción y generación DOCX permanecen en el PC. Los expedientes, capturas, OCR e identidades temporales se cifran con AES-256-GCM; sus claves se protegen con Windows DPAPI y caducan como máximo en 24 horas. El modo completo permite introducir los campos jurídicos declarados por la plantilla desde Windows o móvil. Un bloqueo temporal por campo evita que dos operadores se sobrescriban, mientras campos distintos se guardan atómicamente en paralelo.

Ambos modos de guardado Word mantienen recibos temporales protegidos mediante DPAPI. Tras reiniciar, permiten reintentar el cierre del expediente o retiro de la solicitud sin generar otro archivo. El cierre comprueba la revisión que se guardó; limpiar sesión elimina los recibos, pero nunca los DOCX guardados por el operador.

Los campos jurídicos repetibles vinculados a personas se conservan por identidad y no por posición. Al reordenar o retirar herederos, su relación sucesoria permanece con la persona correcta; una edición basada en asignaciones antiguas se rechaza y se recarga antes de volver a guardarla.

## Stack

- React 19, TypeScript, Vite y Material UI para las dos interfaces.
- Tauri 2 para la aplicación Windows.
- FastAPI y WebSocket para comunicar UI, móvil y núcleo local; SQLite cifrado para reanudación temporal tras reinicio.
- OpenCV + DocQuadNet-256 ONNX Runtime CPU para la rectificación.
- Google Vision REST + `google-auth`, con cuenta de servicio cifrada mediante Windows DPAPI.
- Motor determinista con perfiles separados para CNIE 2020 y anterior a 2020, con lectura geométrica de 14 campos revisados.
- Motor OOXML con `zipfile` y `lxml`, plantillas versionadas y hashes SHA-256; no usa Word, COM ni LibreOffice para generar. La aleya matrimonial usa Amiri Quran 1.003 embebida en el DOCX.
- HTTPS privado con CA de oficina para habilitar la cámara en móviles de la LAN.

## Desarrollo

Requisitos: Windows x64, Python 3.11–3.13, Node.js 22+, pnpm 9.15.9 y Rust estable para compilar la aplicación Tauri.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[capture,dev]" pyinstaller
pnpm install
pnpm build
.\scripts\start-workspace.ps1
```

La última orden abre la estación web local para desarrollo. La aplicación Tauri inyecta su propio token privado y arranca el motor automáticamente.

## Red móvil segura

La cámara web requiere un contexto HTTPS. La aplicación instalada detecta la IPv4 privada de la ruta activa y prepara la dirección de estación automáticamente. Cuando hay varias redes ambiguas, **Dispositivos** permite indicar una dirección manual. Para desarrollo también está disponible:

```powershell
.\.venv\Scripts\python.exe -m cnie_capture setup-lan --ip 192.168.1.50
```

Después reinicie Valiris Desk. La estación mostrará un QR de un solo uso y caducidad breve. Consulte [la guía de instalación Windows y móvil](docs/WINDOWS_MOBILE_SETUP.md) antes de abrir el puerto de red.

## Núcleo Python

```python
from pathlib import Path
from cnie_rectifier import CnieRectifier

result = CnieRectifier().rectify(Path("capture.jpg").read_bytes())
if result.status.value == "success":
    Path("rectified.jpg").write_bytes(result.rectified_image)
print(result.to_dict())
```

CLI de diagnóstico y benchmark:

```powershell
cnie-rectifier inspect --input capture.jpg --output-image rectified.jpg --output-json result.json
cnie-rectifier benchmark --manifest D:\dataset\manifest.jsonl --output D:\results\benchmark.json
cnie-rectifier model-info
cnie-ocr inspect --input rectified.jpg --output ocr.json --language-mode auto
cnie-ocr benchmark --manifest D:\dataset\ocr-manifest.json --output D:\results\ocr-benchmark.json
```

`rectified_image` solo existe cuando el estado es `success`; `to_dict()` nunca incluye bytes. Los logs normales no muestran rutas, imágenes ni contenido visible de la CNIE.

## Compilación Windows

```powershell
.\scripts\build-sidecar.ps1
pnpm --filter @notario/desktop tauri build
```

Los instaladores se generan bajo `apps/desktop/src-tauri/target/release/bundle`. Una versión más reciente se instala directamente sobre la existente, sin desinstalar y conservando la configuración local. Consulte [la política de actualizaciones](docs/UPDATES.md). Una distribución empresarial definitiva debe firmarse con un certificado de firma de código de la organización.

La aceptación de versiones preliminares utiliza [kits aislados de instalación y actualización](docs/WINDOWS_INSTALLATION_QA.md), con escenarios separados, hashes de todos los recursos y pruebas de recuperación tras reparación. El runner solo admite la cuenta desechable de Windows Sandbox; no ejecuta instaladores sobre el puesto del desarrollador. Preparar el kit no acredita las comprobaciones que todavía no se hayan ejecutado.

## Verificación

```powershell
.\.venv\Scripts\python.exe -m pytest
pnpm -r --if-present test
pnpm typecheck
pnpm build
```

Las capturas, resultados OCR, campos, correcciones e identidades temporales se conservan cifrados durante un máximo de 24 horas y pueden reanudarse tras reiniciar el motor. «Limpiar sesión» elimina los registros y sus claves de datos; no elimina plantillas, configuración OCR ni perfiles profesionales. Consulte [la arquitectura de Fase 1](docs/PHASE1_ARCHITECTURE.md), [la configuración segura de Google Vision](docs/GOOGLE_VISION_SETUP.md), [el protocolo de captura](docs/CAPTURE_PROTOCOL.md) y [la guía del benchmark](docs/BENCHMARK.md).

Las identidades aprobadas y las solicitudes DOCX también son exclusivamente temporales. Una solicitud desaparece si expira, se sustituye o se elimina cualquiera de sus identidades. El DOCX guardado queda fuera de Valiris Desk: el operador continúa su trabajo directamente en Word y no existe sincronización de retorno.

## Modelo

Se incluye DocQuadNet-256 FP32 opset 17, fijado al commit upstream `5d08804af3a2fe6d25c09f85366a19ca4fac0a04`. El grafo publicado tenía un nodo `Cast` fuera de orden topológico; la copia incluida solo corrige ese orden y conserva salidas idénticas. La procedencia, hash y licencia están en `models/README.md` y `THIRD_PARTY_NOTICES.md`.

## Documentación

La referencia actual es la [documentación integral de Fase 1](docs/DOCUMENTACION_FASE1.md), con flujos, módulos, CNIE moderna/antigua, almacenamiento, seguridad, Word, instalación, operación, QA y pendientes de publicación. La [API local](docs/PHASE1_API.md) detalla rutas, permisos, revisiones e idempotencia; el [índice documental](docs/README.md) reúne las guías especializadas y referencias históricas.

El cierre funcional de Fase 1 está aceptado por el responsable del producto. La base de trabajo es `0.8.0-alpha.4`, API 2; el saneamiento y sus pendientes externos se registran en [Saneamiento de Fase 1](docs/SANEAMIENTO_FASE1.md). Esto no acredita SaaS desplegado, aprobación jurídica ni firma de producción. La instalación real conserva alpha.2 hasta actualizarla con el nuevo paquete; consulte [actualizaciones](docs/UPDATES.md). La [guía de plantillas DOCX](docs/DOCX_TEMPLATES.md) define creación, validación y versionado.
