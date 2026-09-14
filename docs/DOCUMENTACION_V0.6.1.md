# e-notario 0.6.1 — Documentación integral del producto

## 1. Control del documento

| Propiedad | Valor |
| --- | --- |
| Producto | e-notario v2 |
| Versión documentada | 0.6.1 |
| Estado | Base funcional validada; punto de partida para futuras fases |
| Plataforma objetivo | Windows x64, con captura móvil en la misma LAN de oficina |
| Repositorio | `https://github.com/yaboula/e-notario` |
| Rama estable | `main` |
| Tag | `v0.6.1` |
| Commit de referencia | `8fcbc847cf1d16840dd1de0a97c5e32a20f4138a` |
| Contrato de exportación | `cnie.ma.2020/v2` |
| Clasificación funcional | Aplicación interna; no destinada al público general |
| Licencia del código | Propietaria según los metadatos del paquete |

Este documento describe el comportamiento que existe realmente en la versión indicada. Las ideas de la sección de evolución futura son direcciones de producto, no funcionalidades disponibles ni compromisos de fecha.

El repositorio de referencia es público, pero su publicación no sustituye una licencia de uso. Los componentes de terceros conservan sus propias condiciones, recogidas en `THIRD_PARTY_NOTICES.md` y `LICENSES/`. Ninguna imagen, OCR, credencial o muestra real de CNIE debe incorporarse al repositorio.

## 2. Propósito del producto

e-notario recibe fotografías del anverso y reverso de una CNIE marroquí, comprueba localmente que la tarjeta pueda procesarse, corrige su perspectiva, solicita OCR a Google Cloud Vision en la región UE y propone 14 campos estructurados para revisión humana. El resultado solo puede exportarse después de la aprobación.

La versión actual está diseñada para un equipo de oficina identificado. El protocolo de captura, la revisión humana y la administración por TI forman parte del producto; no son soluciones temporales.

### 2.1 Objetivos actuales

- Capturar desde el PC o desde un teléfono autorizado sin instalar una aplicación móvil nativa.
- Rechazar fotografías realmente inutilizables sin exigir condiciones fotográficas perfectas.
- Mantener la detección y rectificación en el PC Windows.
- Enviar a Google únicamente la imagen canónica aceptada por una persona.
- Reconocer árabe, francés y números sin descartar ninguno de esos contenidos.
- Convertir el OCR en un contrato estructurado pequeño, revisable y sustituible.
- Evitar exportaciones accidentales y exposición de datos a móviles ajenos.
- Mantener los documentos temporales en memoria y eliminarlos automáticamente.

### 2.2 No objetivos de la versión 0.6.1

- No autentica la CNIE ni demuestra que sea genuina.
- No lee el chip NFC, biometría, firma o fotografía como datos biométricos.
- No ofrece base de datos, archivo permanente, expediente ni historial documental.
- No implementa usuarios, roles persistentes, SSO ni administración centralizada.
- No extrae ni exporta autoridad emisora, CAN, acta civil, mención opcional o MRZ.
- No traduce ni translitera automáticamente árabe y francés.
- No admite diseños distintos de la CNIE marroquí introducida en 2020.
- No incluye actualizador remoto, firma de código corporativa ni telemetría central.

## 3. Alcance entregado por fases

### 3.1 Fase 1 — Captura, detección y rectificación

La fotografía se decodifica de forma segura, se orienta según EXIF y se analiza con dos detectores:

- un detector clásico determinista basado en OpenCV;
- DocQuadNet-256 FP32, opset 17, ejecutado en ONNX Runtime CPU.

La estrategia híbrida compara ambas geometrías. Cuando existe acuerdo estricto utiliza el resultado del modelo refinado con bordes; un acuerdo moderado puede aceptarse con advertencia. Si el modelo es inválido pero OpenCV obtiene una frontera excepcionalmente fuerte, OpenCV puede prevalecer con advertencia explícita. Los desacuerdos materiales, geometrías inválidas, tarjeta parcial, resolución insuficiente o pérdida visible tras la homografía siguen siendo rechazos.

La salida correcta es un JPEG en color de `1600 × 1008`, proporción ID-1. No se aplica binarización, enfoque artificial ni corrección destructiva de color.

### 3.2 Fase 2 — OCR europeo

Después de que el operador pulse **Aceptar imagen e iniciar OCR**, un worker independiente envía únicamente la imagen rectificada al endpoint:

`POST https://eu-vision.googleapis.com/v1/projects/{project_id}/locations/eu/images:annotate`

Se utiliza `DOCUMENT_TEXT_DETECTION` mediante REST y `google-auth`. La respuesta se transforma inmediatamente a un modelo neutral con texto, idiomas, páginas, bloques, párrafos, palabras, confianzas y polígonos. La respuesta JSON original de Google no se conserva.

### 3.3 Fase 3 — Extracción local y revisión humana

Cuando las dos caras tienen OCR correcto, un extractor local y determinista identifica la plantilla `CNIE_MA_2020`, utiliza regiones canónicas y propone 14 campos. Cada valor conserva confianza, advertencias y cara de origen en el modelo de revisión.

El operador puede confirmar una categoría completa o usar **Aceptar todo y aprobar**. El servidor sigue validando que los valores obligatorios existan y que CIN, fechas y sexo tengan un formato válido. Una corrección realizada desde Windows o desde el móvil propietario aparece en la otra interfaz mediante WebSocket y un refresco periódico de respaldo.

## 4. Usuarios y superficies

### 4.1 Operador Windows

Es el supervisor de la sesión y puede:

- importar fotografías desde disco;
- crear y revocar emparejamientos móviles;
- ver todos los documentos temporales de la estación;
- aceptar o rechazar una imagen antes del OCR;
- revisar original y rectificada;
- consultar OCR árabe, texto completo, geometría y confianza;
- reintentar manualmente OCR cuando el error lo permite;
- revisar y aprobar los 14 campos;
- exportar imagen, OCR de diagnóstico o JSON aprobado;
- importar, probar, sustituir y eliminar la credencial Google;
- consultar el modelo local y el uso OCR;
- configurar una IPv4 manual cuando la detección automática no sea concluyente.

### 4.2 Operador móvil

El teléfono se conecta mediante un QR de un solo uso. Puede:

- capturar una fotografía completa o elegir JPEG/PNG;
- ver la rectificación y el estado de su documento;
- capturar la otra cara;
- revisar y aprobar los 14 campos de documentos creados por esa sesión móvil;
- abrir el anverso o reverso rectificado de su propio documento.

No puede aceptar la imagen para iniciar OCR, administrar credenciales, ver el OCR completo, consultar diagnósticos, exportar JSON ni acceder a documentos de otra sesión.

### 4.3 Responsable de TI

Es responsable de la instalación, red, firewall, certificados móviles, proyecto Google Cloud, permisos mínimos, retirada segura del JSON de cuenta de servicio, actualización y copias de seguridad autorizadas.

## 5. Arquitectura

### 5.1 Vista de contexto

```text
Teléfono autorizado
  │ HTTPS privado :8788 + token de sesión
  ▼
FastAPI / coordinador local ───────── WebSocket de cambios
  │                 │                       │
  │                 ├─ OpenCV + DocQuadNet │
  │                 ├─ Cola OCR            │
  │                 └─ Extractor local     │
  │                                         ▼
  ├─ HTTPS UE ── Google Cloud Vision     Estación Tauri/React
  │                                         │ HTTP loopback :8787
  └─ Memoria temporal + configuración       └─ exportación explícita
```

### 5.2 Componentes

| Componente | Ruta | Responsabilidad |
| --- | --- | --- |
| Estación Windows | `apps/desktop` | Supervisión, imagen, OCR, revisión, diagnóstico y exportación |
| Captura móvil | `apps/mobile-capture` | Cámara, carga, estado y revisión del documento propio |
| UI compartida | `packages/ui` | Tema, componentes, iconos y estilos comunes |
| Cliente API | `packages/api-client` | Contratos TypeScript, autenticación, REST, imágenes y WebSocket |
| Aplicación nativa | `apps/desktop/src-tauri` | Ciclo de vida Windows, token de escritorio, sidecar y diálogos de archivo |
| Coordinador | `src/cnie_capture` | API, memoria, propiedad, estados, cola, red y TLS |
| Rectificador | `src/cnie_rectifier` | Decodificación, detectores, decisión híbrida, calidad y homografía |
| OCR | `src/cnie_ocr` | Credencial DPAPI, cuota, transporte UE y normalización |
| Extractor | `src/cnie_extract` | Plantilla, regiones, normalización conservadora y campos |

### 5.3 Stack

- React 19, TypeScript, Vite y Material UI.
- Tauri 2 y Rust 2021 para Windows.
- FastAPI, Uvicorn y WebSocket.
- Python 3.11–3.13.
- OpenCV, NumPy y Pillow.
- ONNX Runtime CPU y DocQuadNet-256.
- Google Vision REST con `google-auth`.
- Windows DPAPI `CurrentUser` para la cuenta de servicio.
- Certificados X.509 privados de oficina para HTTPS móvil.

## 6. Flujo funcional completo

1. Tauri genera un token aleatorio de escritorio y arranca el sidecar.
2. El sidecar escucha en `127.0.0.1:8787`. Si hay LAN configurada, sirve también HTTPS en `IP_PRIVADA:8788`.
3. Windows genera un QR de 120 segundos. Al usarlo se crea una sesión móvil de cuatro horas.
4. El móvil envía JPEG/PNG con cara, clave de idempotencia y, si corresponde, `document_id`.
5. El coordinador limita memoria, serializa la rectificación y conserva original/rectificada en memoria.
6. Windows inspecciona y acepta o solicita repetición.
7. Aceptar encola una sola solicitud OCR. La captura puede continuar mientras el worker procesa.
8. Cuando ambas caras tienen OCR correcto, la extracción se ejecuta automáticamente en el PC.
9. Windows y el móvil propietario revisan el mismo objeto versionado.
10. La aprobación valida los 14 campos y cambia el documento a `ready`.
11. Solo Windows puede exportar el contrato JSON.
12. Al llegar a 60 minutos o cerrar el motor se eliminan capturas, OCR, campos y revisiones.

## 7. Captura y rectificación

### 7.1 Contrato del operador

- Una sola CNIE por fotografía.
- Cuatro esquinas visibles, sin dedos ni objetos encima.
- Fondo mate, razonablemente uniforme y contrastante.
- Luz suficiente sin reflejo destructivo.
- Tarjeta aproximadamente entre 50 % y 90 % del encuadre.
- Lado corto detectado de al menos 1.000 píxeles.
- JPEG o PNG de hasta 20 MiB; HEIC no admitido.
- Fotograma completo del sensor disponible: la PWA no recorta ni simula zoom.

### 7.2 Perfil 0.6.1 equilibrado para oficina

Los límites actuales toleran variación moderada de iluminación y borde, pero conservan controles duros. Entre los valores relevantes están:

| Control | Valor inicial |
| --- | ---: |
| Lado corto mínimo | 1.000 px |
| Diagonal tarjeta/imagen mínima | 0,50 |
| Área máxima de tarjeta | 0,94 |
| Soporte de borde mínimo | 0,26 |
| Soporte cromático mínimo | 0,24 |
| Lados de borde soportados | 3 |
| IoU estricto entre detectores | 0,90 |
| Distancia estricta de esquina | 0,02 de la diagonal |
| IoU de acuerdo moderado | 0,80 |
| Distancia moderada | 0,05 de la diagonal |
| OpenCV excepcional | puntuación mínima 0,90 |
| Reflejo máximo estimado | 0,18 |
| Luminancia media admitida | 28–242 |
| Borde negro tras homografía | máximo 0,01 |

Estos valores son configuración de producto, no probabilidades. Deben modificarse mediante un corpus representativo; no para hacer pasar una fotografía concreta.

### 7.3 Resultados públicos

- `success`: existe imagen rectificada en memoria.
- `recapture_required`: el operador debe repetir con una acción concreta.
- `invalid_image`: el archivo no se pudo admitir o decodificar.
- `model_error`: el motor necesario no está disponible.

Las advertencias `CLASSICAL_DETECTOR_MISSED`, `MODEL_DETECTOR_MISSED`, `DETECTOR_SOFT_DISAGREEMENT` y `STRONG_CLASSICAL_OVERRIDE` describen el fallback utilizado; no son por sí solas un rechazo.

## 8. OCR Google Cloud Vision

### 8.1 Garantías de transporte

- Solo se permite JPEG canónico `1600 × 1008`.
- Solo se usa `eu-vision.googleapis.com` y la localización `eu`.
- El cuerpo contiene la imagen inline en Base64; no usa Cloud Storage ni temporal en disco.
- Timeout de conexión: 5 segundos. Timeout de lectura: 20 segundos.
- Detección automática de idioma en producción.
- No hay reintento automático después de iniciar una solicitud.
- Un reintento manual está limitado a tres intentos totales por captura.

### 8.2 Cola y cancelación

Existe un solo worker OCR. Una captura sustituida, eliminada o marcada para repetir incrementa su generación y hace que los trabajos antiguos sean ignorados. Si la petición ya salió, puede contar en Google y en el contador local, pero la respuesta se descarta si la captura dejó de ser vigente.

### 8.3 Credencial

El JSON debe ser `service_account`, tener `project_id`, correo `gserviceaccount.com`, clave privada válida y `token_uri` exactamente igual a `https://oauth2.googleapis.com/token`. El máximo de importación es 64 KiB.

El JSON se cifra inmediatamente con DPAPI y entropía propia de la aplicación. Solo persiste `%LOCALAPPDATA%\e-notario-v2\google-vision.credential.dpapi`. El archivo original es responsabilidad de TI y debe retirarse por su procedimiento seguro.

### 8.4 Límites locales

- 60 solicitudes diarias.
- 900 solicitudes mensuales.
- Valores administrables mediante `CNIE_OCR_DAILY_LIMIT` y `CNIE_OCR_MONTHLY_LIMIT`.
- Persistencia agregada en `ocr-usage.json`, sin imágenes, texto o identificadores.

## 9. Extracción estructurada

### 9.1 Contrato interno

```python
CnieFieldExtractor.extract(front: OcrResult, back: OcrResult, request_id=None) -> ExtractionResult
```

El extractor trabaja con palabras y coordenadas canónicas. No vuelve a llamar a Google, no inventa valores y no completa un idioma desde el otro.

### 9.2 Los 14 campos

| Grupo | Clave | Representación |
| --- | --- | --- |
| Identidad | `national_id` | Cadena CIN normalizada |
| Identidad | `given_names_ar` | Texto árabe |
| Identidad | `given_names_latin` | Texto latino |
| Identidad | `surname_ar` | Texto árabe |
| Identidad | `surname_latin` | Texto latino |
| Nacimiento | `birth_date` | Fecha ISO `YYYY-MM-DD` |
| Nacimiento | `birth_place_ar` | Texto árabe |
| Nacimiento | `birth_place_latin` | Texto latino |
| Documento | `expiry_date` | Fecha ISO `YYYY-MM-DD` |
| Documento | `sex` | `M` o `F` |
| Filiación y domicilio | `filiation_ar` | Lista ordenada |
| Filiación y domicilio | `filiation_latin` | Lista ordenada |
| Filiación y domicilio | `address_ar` | Texto multilínea |
| Filiación y domicilio | `address_latin` | Texto multilínea |

La detección de sexo solo admite un marcador alineado geométricamente con la etiqueta impresa. Una letra aislada del fondo de seguridad no se adopta como valor; el campo queda para selección humana `F/M`.

### 9.3 Normalización y validación

- Unicode NFC y limpieza conservadora de espacios y puntuación.
- Conservación de diferencias significativas del árabe.
- CIN final con patrón `[A-Z]{1,3}\d{4,10}`.
- Fechas reales en ISO y caducidad posterior al nacimiento.
- Sexo final exclusivamente `M` o `F`.
- Bloqueo por `EXTRACTION_SIDE_MISMATCH`.
- Campos ausentes permanecen vacíos y no toman texto de una región vecina.

### 9.4 Revisión optimista

Cada cambio contiene una `revision`. Si Windows y móvil editan la misma versión, el segundo recibe `EXTRACTION_STALE_REVISION`; recarga el servidor y no sobrescribe silenciosamente su borrador. Cada revisión registra `reviewed_by` y `reviewed_at`; la aprobación registra `approved_by` y `approved_at`. Todo permanece en memoria.

## 10. Modelo documental y estados

### 10.1 Documento

| Estado | Significado |
| --- | --- |
| `capturing` | Falta una cara |
| `review_required` | Existe una captura pendiente de decisión Windows |
| `ocr_pending` | OCR o extracción en curso |
| `data_review_required` | Los 14 campos están disponibles para revisión |
| `ready` | Datos revisados y aprobados |
| `attention` | Repetición, OCR o extracción necesita intervención |

### 10.2 Captura

Una captura tiene cara, documento, propietario, intento, estado activo, revisión, resultado geométrico, resumen OCR y generación de cancelación. Sustituir una cara desactiva la anterior e invalida toda extracción y aprobación asociada.

### 10.3 OCR

`not_started → queued → processing → success`

Las salidas alternativas son `no_text`, `error` y `cancelled`.

### 10.4 Extracción

`waiting_for_ocr → extracting → review_required → approved`

Los fallos de plantilla o motor terminan en `attention` a nivel documental.

## 11. Sincronización Windows–móvil

El servidor mantiene una única fuente de verdad en memoria. Después de captura, revisión de imagen, cambio OCR, extracción, corrección, aprobación, sustitución o eliminación, publica `{"type":"changed"}` a los WebSocket autenticados.

- Windows invalida las consultas `workspace` y `extraction`.
- El móvil recarga su workspace y la revisión del documento activo.
- Ambas interfaces tienen refresco HTTP cada cuatro segundos como recuperación.
- Los valores recibidos reemplazan datos antiguos, pero un borrador local aún no enviado se conserva.
- Las imágenes usan una función de carga estable para no parpadear durante refrescos de estado.

Los eventos indican que existe un cambio; no contienen datos de la CNIE.

## 12. API local

Todos los endpoints salvo salud y canje inicial requieren `Authorization: Bearer <token>`. La especificación OpenAPI, Swagger y ReDoc están deshabilitados en producción.

| Método y ruta | Acceso | Uso |
| --- | --- | --- |
| `GET /api/health` | Local | Salud y versión |
| `GET /api/workspace` | Windows/móvil | Documentos visibles, capturas y estados |
| `POST /api/pairing` | Windows | Crear QR de un solo uso |
| `POST /api/pair` | Código QR | Canjear código por sesión móvil |
| `DELETE /api/pairing` | Windows | Revocar sesiones móviles |
| `POST /api/captures?side=&document_id=` | Windows/móvil | Crear o sustituir una cara |
| `GET /api/captures/{id}/{variant}` | Propietario/Windows | `metadata`, `original` o `rectified`; `ocr` solo Windows |
| `POST /api/captures/{id}/review` | Windows | Aceptar e iniciar OCR, o repetir |
| `POST /api/captures/{id}/ocr/retry` | Windows | Reintento manual elegible |
| `DELETE /api/captures/{id}` | Windows | Eliminar e invalidar dependencias |
| `GET /api/documents/{id}/extraction` | Propietario/Windows | Contrato mínimo de revisión |
| `PATCH /api/documents/{id}/extraction/review` | Propietario/Windows | Confirmar o corregir con revisión |
| `POST /api/documents/{id}/extraction/approve` | Propietario/Windows | Aprobar la revisión vigente |
| `GET /api/documents/{id}/export` | Windows | JSON UTF-8 aprobado |
| `GET /api/model` | Windows | Grafo, hash, tensores y proveedor ONNX |
| `GET /api/ocr/config` | Windows | Estado no secreto de OCR |
| `PUT /api/ocr/config/credential` | Windows | Importar o sustituir credencial |
| `POST /api/ocr/config/test` | Windows | Probar con imagen sintética |
| `DELETE /api/ocr/config/credential` | Windows | Eliminar blob DPAPI |
| `GET /api/ocr/usage` | Windows | Contadores agregados |
| `WS /api/events` | Windows/móvil | Notificación autenticada de cambios |

### 12.1 Idempotencia

Cada `POST /api/captures` exige `Idempotency-Key` UUID. Repetir la misma clave, cuerpo, cara y documento devuelve la captura original; reutilizarla con contenido distinto produce `IDEMPOTENCY_CONFLICT`.

### 12.2 Respuestas de seguridad

Las respuestas incluyen `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, política de permisos y CSP. El access log de Uvicorn está desactivado.

## 13. Contrato de exportación

Solo un documento aprobado se exporta. La forma resumida es:

```json
{
  "schema_version": "cnie.ma.2020/v2",
  "document_id": "uuid",
  "approved_at": "fecha ISO",
  "approved_by": "desktop o mobile",
  "extractor": {"template": "CNIE_MA_2020", "version": "1.2.0"},
  "data": {
    "national_id": "...",
    "surname": {"arabic": "...", "latin": "..."},
    "given_names": {"arabic": "...", "latin": "..."},
    "birth": {"date": "YYYY-MM-DD", "place": {"arabic": "...", "latin": "..."}},
    "expiry_date": "YYYY-MM-DD",
    "filiation": {"arabic": [], "latin": []},
    "address": {"arabic": "...", "latin": "..."},
    "sex": "M o F"
  },
  "verification": {
    "human_reviewed": true,
    "manual_corrections": [],
    "accepted_warnings": []
  }
}
```

No incluye imágenes, OCR completo, polígonos, valores brutos, credenciales, MRZ ni campos retirados.

## 14. Seguridad, privacidad y datos

### 14.1 Límites de confianza

- **Loopback Windows:** UI nativa y servicio local, autenticados por token efímero generado por Tauri.
- **LAN de oficina:** teléfono autorizado y servidor HTTPS privado.
- **Proveedor externo:** exclusivamente Google Cloud Vision UE y únicamente tras aceptación humana.
- **Exportación:** frontera explícita elegida por el operador mediante diálogo Windows.

### 14.2 Propiedad y aislamiento

- Windows puede supervisar toda la memoria de la estación.
- Cada sesión móvil solo ve documentos cuyo propietario es su token.
- La consulta de recursos ajenos devuelve no encontrado para evitar enumeración.
- Máximo de ocho sesiones móviles activas y 16 WebSocket.
- Revocar emparejamiento elimina todas las sesiones móviles activas.

### 14.3 Persistencia

| Dato | Ubicación | Duración |
| --- | --- | --- |
| Original y rectificada | RAM | 60 minutos/cierre |
| OCR neutral y texto | RAM | 60 minutos/cierre |
| Campos, revisiones y aprobación | RAM | 60 minutos/cierre |
| Token escritorio | Memoria del proceso | Vida del proceso |
| Token móvil | `sessionStorage` del navegador + servidor | Hasta 4 horas o revocación |
| Credencial Google | Blob DPAPI en LocalAppData | Hasta sustitución/eliminación |
| Contadores OCR | JSON agregado en LocalAppData | Persistente |
| Configuración LAN | `lan.json` en LocalAppData | Persistente |
| CA y certificado servidor | `tls` en LocalAppData | Persistente/renovable |

### 14.4 Límites de recursos

- 20 MiB por archivo.
- 160 MiB de presupuesto de imágenes en memoria, reservando 10 MiB operativos.
- 30 capturas temporales por proceso.
- Una rectificación a la vez mediante bloqueo local.
- Una cola OCR y un worker.

### 14.5 Obligaciones organizativas pendientes

Antes de producción comercial deben existir aprobación jurídica del tratamiento de CNIE, contrato y configuración Google apropiados, política de retención, control de dispositivos, respuesta a incidentes, firma de código, inventario de estaciones y procedimiento documentado de baja de certificados y credenciales.

## 15. Red y certificados

- `8787/TCP`: HTTP solo en `127.0.0.1`; nunca se abre a la LAN.
- `8788/TCP`: HTTPS en la IPv4 privada seleccionada; firewall solo en perfil privado y subred autorizada.
- Detección: ruta predeterminada, adaptador privado único o `CNIE_LAN_IP` administrada.
- Fallback manual desde **Dispositivos**.
- CA de oficina RSA 3072, validez de 730 días, `path_length=0`.
- Certificado servidor RSA 2048, validez de 90 días, SAN de IP y `localhost`.
- Renovación del certificado si cambia la IP o restan menos de 14 días.
- Solo `office-ca.crt` se distribuye; las claves privadas permanecen en el PC.

## 16. Operación diaria

### 16.1 Inicio de jornada

1. Abrir e-notario y verificar la versión del pie.
2. Confirmar que Google Vision aparece configurado.
3. Revisar el uso diario/mensual si se prevé volumen alto.
4. Comprobar la dirección LAN y emparejar el móvil autorizado.
5. Realizar una captura de control si cambió cámara, red o iluminación.

### 16.2 Procesar una CNIE

1. Crear **Nueva captura**.
2. Capturar anverso y comprobar la rectificación en Windows.
3. Aceptar la imagen para iniciar OCR o pedir repetición.
4. Capturar y aceptar reverso en el mismo documento.
5. Esperar a extracción automática.
6. Comparar los 14 valores con ambas imágenes.
7. Corregir sexo mediante selector y preservar líneas de filiación/domicilio.
8. Confirmar categorías o aceptar todo.
9. Aprobar y exportar JSON desde Windows si corresponde.

### 16.3 Cierre de jornada

1. Exportar únicamente los resultados necesarios al destino autorizado.
2. Confirmar que no quedan documentos que deban conservarse: cerrar elimina la memoria.
3. Desconectar móviles si la estación seguirá abierta sin supervisión.

## 17. Errores y acciones

### 17.1 OCR

| Código | Tipo | Acción |
| --- | --- | --- |
| `OCR_NOT_CONFIGURED` | Configuración | Importar credencial desde Windows |
| `OCR_CREDENTIAL_INVALID` | Configuración | Sustituir JSON y validar campos/clave |
| `OCR_AUTH_FAILED` | Permanente | Rotar credencial y revisar reloj/proyecto |
| `OCR_PERMISSION_DENIED` | Permanente | Corregir permisos mínimos/API/facturación |
| `OCR_QUOTA_EXCEEDED` | Cuota | Revisar cuota Google y esperar/ampliar |
| `OCR_LOCAL_LIMIT_REACHED` | Límite local | Esperar al siguiente periodo o decisión TI |
| `OCR_RATE_LIMITED` | Recuperable | Reintentar manualmente más tarde |
| `OCR_TIMEOUT` | Recuperable | Comprobar red y reintentar manualmente |
| `OCR_PROVIDER_UNAVAILABLE` | Recuperable | Comprobar servicio/red y reintentar |
| `OCR_INVALID_RESPONSE` | Técnico | No aprobar; registrar diagnóstico sin PII |
| `OCR_NO_TEXT` | Calidad | Revisar rectificada y repetir si procede |

### 17.2 Extracción

| Código | Acción |
| --- | --- |
| `EXTRACTION_UNSUPPORTED_LAYOUT` | Confirmar que es CNIE 2020 |
| `EXTRACTION_SIDE_MISMATCH` | Verificar que ambas caras pertenecen a la misma tarjeta |
| `EXTRACTION_REQUIRED_FIELD_MISSING` | Completar el campo desde la imagen |
| `EXTRACTION_LOW_CONFIDENCE` | Revisar visualmente |
| `EXTRACTION_DATA_CONFLICT` | Corregir formato, fecha, CIN o sexo |
| `EXTRACTION_REVIEW_INCOMPLETE` | Revisar los 14 campos |
| `EXTRACTION_STALE_REVISION` | Recargar cambios del otro dispositivo |
| `EXTRACTION_FAILED` | Incidencia técnica; conservar diagnóstico sin datos |

Los códigos geométricos y la acción de captura completa se mantienen en [CAPTURE_PROTOCOL.md](CAPTURE_PROTOCOL.md).

## 18. Instalación, desarrollo y compilación

### 18.1 Requisitos de desarrollo

- Windows x64.
- Python 3.11 a 3.13.
- Node.js 22 o superior.
- pnpm 9.15.9, fijado en el workspace.
- Rust estable y toolchain MSVC para Tauri.

### 18.2 Preparación

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[capture,dev]" pyinstaller
pnpm install
```

### 18.3 Desarrollo

```powershell
pnpm build
.\scripts\start-workspace.ps1
```

### 18.4 Pruebas

```powershell
.\.venv\Scripts\python.exe -m pytest
pnpm -r --if-present test
pnpm typecheck
pnpm build
```

La línea base `0.6.1` supera 62 pruebas Python y 8 pruebas de componentes UI. Esto no sustituye el piloto real con corpus autorizado.

### 18.5 Instalador Windows

```powershell
.\scripts\build-sidecar.ps1
pnpm desktop:build
```

La salida NSIS se crea bajo `apps/desktop/src-tauri/target/release/bundle/nsis`. El sidecar contiene Python y sus dependencias; por eso no se requiere Python en el PC operativo.

### 18.6 Configuración administrada

| Variable | Finalidad | Comportamiento sin definirla |
| --- | --- | --- |
| `CNIE_LAN_IP` | Fijar una IPv4 privada concreta para HTTPS móvil | Detección automática de la ruta/adaptador privado |
| `CNIE_OCR_DAILY_LIMIT` | Cambiar el límite local diario de llamadas OCR | 60 |
| `CNIE_OCR_MONTHLY_LIMIT` | Cambiar el límite local mensual de llamadas OCR | 900 |
| `CNIE_DESKTOP_TOKEN` | Inyectar el secreto de la sesión de escritorio en ejecución controlada | Tauri o el proceso generan uno aleatorio |

Estas variables son de operación, no un lugar para credenciales. No deben registrarse claves privadas, imágenes o texto OCR en argumentos, scripts, variables o logs.

### 18.7 Estructura y responsabilidad del repositorio

- `apps/`: superficies Windows y móvil.
- `packages/`: contratos y presentación compartida.
- `src/`: cuatro núcleos Python independientes: coordinación, rectificación, OCR y extracción.
- `tests/`: pruebas unitarias e integradas del servidor y los núcleos.
- `models/`: modelo ONNX, procedencia y hash documentados.
- `scripts/`: desarrollo, construcción del sidecar, red y empaquetado.
- `docs/`: referencia de producto, operación, seguridad y decisiones.

Los artefactos generados (`build/`, `output/`, instaladores y entornos locales) no son fuentes. Los datasets autorizados, anotaciones, credenciales y diagnósticos con datos personales permanecen siempre fuera del repositorio.

## 19. Actualizaciones y recuperación

- Instalar una versión superior sobre la existente; no desinstalar primero.
- Terminar/exportar el trabajo temporal antes de cerrar.
- `%LOCALAPPDATA%\e-notario-v2` se conserva durante la actualización.
- La actualización `0.6.0 → 0.6.1` fue verificada conservando tres archivos de configuración con hashes idénticos.
- El instalador comercial futuro debe firmarse y verificarse.

La copia de seguridad de referencia `0.6.1` contiene un Git bundle completo, un ZIP fuente y el instalador. Consulte [UPDATES.md](UPDATES.md) para el canal actual y el actualizador firmado futuro.

## 20. Calidad y benchmark

### 20.1 Automatización existente

- Decodificación, EXIF, geometría, homografía y rechazo.
- OpenCV, DocQuadNet y decisión híbrida.
- Cero aceptación de múltiples rectángulos en el negativo cubierto.
- Transporte OCR simulado: éxito, mezcla de idiomas, vacío, timeout, autenticación, permiso, 429 y 5xx.
- Credencial DPAPI y límites agregados.
- Propiedad móvil, endpoints Windows-only y WebSocket.
- Extracción, normalización, sexo, campos ausentes y conflictos.
- Revisión optimista, aprobación e invalidación.
- Sincronización Windows/móvil, revisión masiva y estabilidad del visor.
- Responsive móvil a 360, 390 y 430 px.

### 20.2 Gate real pendiente

La precisión comercial no debe declararse usando solo pruebas sintéticas. Se mantiene el objetivo de un dataset autorizado fuera del repositorio, separado por tarjeta, con test sellado y negativos. Deben medirse recall, falsas aceptaciones, IoU, error de esquinas, CER árabe, exactitud por campo y latencias en el hardware objetivo.

## 21. Observabilidad y diagnóstico

La versión actual evita logs de acceso y no registra rutas, imágenes, OCR o campos. Los diagnósticos explícitos contienen estados, códigos, métricas, tiempos y versiones. La estación puede exportar OCR solo por acción consciente para análisis autorizado.

Para una flota comercial harán falta métricas agregadas, correlación técnica, alertas y soporte remoto sin incorporar PII. Cualquier observabilidad futura debe aplicar minimización desde el diseño.

## 22. Limitaciones conocidas y deuda controlada

- Solo una plantilla de documento.
- La extracción geométrica necesita ampliación y calibración con corpus real.
- Google puede omitir el marcador de sexo; la revisión humana resuelve el caso sin inventar un valor.
- No existe persistencia transaccional: reiniciar descarta la sesión.
- No hay cuentas ni permisos granulares dentro de Windows.
- La CA es propia por estación y su distribución todavía es un procedimiento de TI.
- El instalador no está firmado con certificado corporativo.
- El repositorio no contiene CI/CD ni publicación automática de artefactos.
- No existe actualizador remoto firmado.
- La interfaz está orientada al español; no hay sistema de internacionalización.
- Un único worker OCR y una única rectificación simultánea son adecuados para el volumen actual, no para procesamiento masivo.

## 23. Hoja de ruta propuesta

La evolución debe realizarse por contratos versionados y fases pequeñas. Orden recomendado:

### 23.1 Industrialización

- Firma de código e instaladores.
- CI con pruebas, análisis de dependencias, SBOM y artefactos reproducibles.
- Canal de actualización Tauri firmado.
- Configuración administrada y política de versiones soportadas.
- Telemetría técnica sin PII y paquete de soporte seguro.

### 23.2 Identidad y auditoría empresarial

- Usuarios, roles y principio de mínimo privilegio.
- Integración con Microsoft Entra ID/SSO cuando el contexto lo justifique.
- Registro de auditoría inmutable para acciones, no para texto innecesario.
- Políticas de sesión, bloqueo de estación y gestión de dispositivos.

### 23.3 Persistencia documental

- Base de datos cifrada y almacenamiento de objetos con retención configurable.
- Expedientes, búsqueda, reanudación y control de concurrencia transaccional.
- Eliminación, exportación y trazabilidad conforme a política jurídica.
- Copias de seguridad cifradas, restauración probada y recuperación ante desastre.

### 23.4 Calidad documental

- Herramientas de anotación y gestión del corpus.
- Calibración por dispositivo y condición sin debilitar negativos.
- Evaluación de fine-tuning DocQuadNet después de suficientes fallos anotados.
- Detección de desenfoque, reflejo y legibilidad ligada a impacto OCR real.
- Soporte de nuevas versiones de CNIE mediante detectores de plantilla versionados.

### 23.5 Extracción e interoperabilidad

- Contratos posteriores a `cnie.ma.2020/v2` con migraciones explícitas.
- Webhooks, API de integración o conectores con sistemas notariales.
- Colas durables, idempotencia externa y reintentos controlados.
- Exportaciones firmadas y sellado temporal si existe base jurídica.

### 23.6 Opciones OCR

- Comparativa periódica de Vision con OCR local o proveedores alternativos.
- Motor offline sustituible para continuidad operativa.
- Enrutamiento por política organizativa y residencia de datos.
- Evaluaciones de coste, CER y disponibilidad antes de cambiar producción.

### 23.7 Experiencia de operación

- Instalación y provisión de estaciones desde MDM.
- Panel de salud de flota y expiración de certificados.
- Accesibilidad, atajos configurables e internacionalización.
- Guía interactiva de captura basada en señales locales no biométricas.

## 24. Reglas para futuras fases

1. No romper el contrato actual sin aumentar `schema_version`.
2. Añadir adaptadores detrás de interfaces; evitar acoplar UI a Google u ONNX.
3. Mantener propiedad de documento y autorización en el servidor, no solo en la UI.
4. No enviar datos a un nuevo tercero sin decisión explícita, configuración y documentación.
5. No registrar PII para diagnosticar errores funcionales.
6. Añadir pruebas de regresión por cada incidente real reproducible.
7. Separar muestras por identidad documental al entrenar o evaluar.
8. Preservar una ruta de revisión humana y mostrar incertidumbre.
9. Versionar migraciones, configuración, contrato y artefactos de modelo.
10. Exigir restauración probada antes de llamar «persistente» a una nueva fase.

## 25. Estrategia de versión y documentación

- SemVer para la aplicación (`MAJOR.MINOR.PATCH`).
- `PATCH`: correcciones compatibles, calibraciones medidas y mejoras UI sin romper contrato.
- `MINOR`: nueva fase compatible, capacidad o contrato adicional.
- `MAJOR`: cambio incompatible de instalación, datos o arquitectura.
- Tag Git anotado por versión publicada.
- `CHANGELOG.md` actualizado antes del tag.
- Este documento se copia o actualiza para cada release de referencia.
- Las decisiones arquitectónicas futuras relevantes deben registrarse en `docs/decisions` como ADR.

## 26. Referencias internas

- [Índice de documentación](README.md)
- [Protocolo de captura](CAPTURE_PROTOCOL.md)
- [Benchmark](BENCHMARK.md)
- [Configuración Google Vision](GOOGLE_VISION_SETUP.md)
- [Extracción estructurada](STRUCTURED_EXTRACTION.md)
- [Instalación Windows y móvil](WINDOWS_MOBILE_SETUP.md)
- [Actualizaciones](UPDATES.md)
- [Procedencia del modelo](../models/README.md)
- [Avisos de terceros](../THIRD_PARTY_NOTICES.md)
- [Historial de cambios](../CHANGELOG.md)
- [Registros de decisiones de arquitectura](decisions/README.md)

## 27. Glosario

- **CNIE:** Carte Nationale d'Identité Électronique de Marruecos.
- **Rectificación:** transformación de perspectiva que produce una vista frontal canónica.
- **Cuadrilátero:** cuatro esquinas aceptadas de la tarjeta en la fotografía original.
- **OCR:** reconocimiento óptico de caracteres.
- **RTL/LTR:** dirección de escritura derecha-a-izquierda / izquierda-a-derecha.
- **DPAPI:** protección criptográfica de Windows ligada al usuario actual.
- **LAN:** red local de la oficina.
- **PWA:** aplicación web instalable o utilizable desde el navegador móvil.
- **TTL:** tiempo máximo de permanencia de un dato temporal.
- **PII:** información personal identificable.
- **Idempotencia:** repetición segura de una solicitud sin crear duplicados.
- **ADR:** registro breve de una decisión de arquitectura.
