# e-notario v2 · captura CNIE

Base profesional para capturar una CNIE desde Windows o desde un móvil autorizado, validar localmente su geometría, producir una imagen color rectificada de `1600 × 1008`, reconocer su texto con Google Cloud Vision en la región UE y estructurar localmente los campos del modelo marroquí de 2020 bajo revisión humana.

Esta fase contiene dos interfaces nuevas e independientes de v1:

- **Estación Windows**: importación, emparejamiento QR, documentos anverso/reverso, comparación original/rectificada, OCR árabe RTL, extracción local, validación MRZ, revisión campo por campo y exportación JSON.
- **Captura móvil PWA**: captura completa de la vista de cámara, guía de encuadre, revisión previa, progreso documental y reintento accionable; nunca recibe texto OCR.

La detección, rectificación y extracción de campos permanecen en el PC. Solo una imagen rectificada que el operador haya aceptado se envía al endpoint europeo de Vision. Los datos estructurados no salen de la estación salvo exportación explícita del operador.

## Stack

- React 19, TypeScript, Vite y Material UI para las dos interfaces.
- Tauri 2 para la aplicación Windows.
- FastAPI y WebSocket para comunicar UI, móvil y núcleo local.
- OpenCV + DocQuadNet-256 ONNX Runtime CPU para la rectificación.
- Google Vision REST + `google-auth`, con cuenta de servicio cifrada mediante Windows DPAPI.
- Motor determinista propio para plantilla CNIE 2020, lectura geométrica y MRZ TD1.
- HTTPS privado con CA de oficina para habilitar la cámara en móviles de la LAN.

## Desarrollo

Requisitos: Windows x64, Python 3.11–3.13, Node.js 22+, pnpm 10 y Rust estable para compilar la aplicación Tauri.

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

Después reinicie e-notario. La estación mostrará un QR de un solo uso y caducidad breve. Consulte [la guía de instalación Windows y móvil](docs/WINDOWS_MOBILE_SETUP.md) antes de abrir el puerto de red.

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

## Verificación

```powershell
.\.venv\Scripts\python.exe -m pytest
pnpm typecheck
pnpm build
```

Las capturas, resultados OCR, campos y correcciones se mantienen solo en memoria y caducan después de 60 minutos o al cerrar el motor. Los contadores agregados y la credencial DPAPI sí persisten. Consulte [la configuración segura de Google Vision](docs/GOOGLE_VISION_SETUP.md), [el protocolo de captura](docs/CAPTURE_PROTOCOL.md) y [la guía del benchmark](docs/BENCHMARK.md).

## Modelo

Se incluye DocQuadNet-256 FP32 opset 17, fijado al commit upstream `5d08804af3a2fe6d25c09f85366a19ca4fac0a04`. El grafo publicado tenía un nodo `Cast` fuera de orden topológico; la copia incluida solo corrige ese orden y conserva salidas idénticas. La procedencia, hash y licencia están en `models/README.md` y `THIRD_PARTY_NOTICES.md`.
