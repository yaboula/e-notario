# Saneamiento de Fase 1 antes de Fase 2

Fecha: 18 de septiembre de 2026. Base de trabajo: `0.8.0-alpha.3`, API 2, Python `0.8.0a3`. Este documento actualiza el traspaso original alpha.2 y distingue correcciones comprobadas de validaciones todavía pendientes.

Actualización posterior del escáner: alpha.4. Durante esta revisión se encontraron constantes `UI_VERSION` alpha.2 en ambas interfaces, pese a los metadatos alpha.3 del paquete. Se corrigieron tomando la versión directamente del `package.json`; la evidencia anterior de salud del motor no acreditaba este arranque de interfaz. Véanse [cambios de captura](CAPTURE_PROTOCOL.md#captura-asistida-y-corrección-de-bordes--alpha4) y [actualizaciones](UPDATES.md). Alpha.3 permanece como checkpoint histórico en el tag `v0.8.0-alpha.3`.

## Correcciones realizadas

| Pendiente | Estado y comportamiento actual |
|---|---|
| Cola OCR detenida por fallo de persistencia | Corregido. El trabajador espera y reintenta persistencia con pausas de 1, 2, 4, 8, 16 y hasta 30 segundos. No inicia el proveedor sin persistencia previa y no repite una llamada para guardar su resultado. |
| Mantenimiento periódico terminado por el mismo fallo | Corregido y reproducido mediante prueba. Sobrevive, informa del fallo y continúa tras recuperar almacenamiento. |
| Éxito OCR todavía no durable | El resultado permanece pendiente de commit. Espacio de trabajo y metadatos muestran `processing`; OCR bruto y reintento responden 503. Solo se notifica el cambio durable. Una captura sustituida durante la espera no se envía. |
| Contador corrupto o ilegible tratado como cero | Corregido. Solo la ausencia inicial significa consumo cero. JSON inválido, estructura/fechas/cantidades inválidas o lectura denegada producen `OCR_USAGE_READ_FAILED`. Se preserva el archivo. |
| Escritura del contador | Archivo temporal único en la misma carpeta, flush/fsync y reemplazo atómico. `OCR_USAGE_WRITE_FAILED` conserva el contador anterior e impide enviar al proveedor. No se ofrece reset silencioso. |
| Caducidad CNIE omitida en testigos | Corregido en herencia `1.5.1`: los doce testigos insertan `الصالحة إلى غاية` después del CIN, con fecha `AAAA/MM/DD`. Herencia `1.5.0` permanece intacta y direccionable. Matrimonio continúa en `1.7.0`. |
| Versiones incoherentes | Python, interfaces, Rust/Tauri, motor y metadatos DOCX alineados con alpha.3. API 2 y contratos CNIE conservados. |

`/api/health` mantiene el contrato de compatibilidad y añade `background` con estado de OCR, mantenimiento y error de almacenamiento. `status: ok` acredita que responde HTTP, no que todas las tareas estén sanas. Windows muestra un aviso de almacenamiento desde el espacio de trabajo.

## Desenfoque: avance y pendiente real

Se añadió `card_laplacian_variance`, calculada sobre el interior de la tarjeta rectificada, normalizada a `1000 × 630`, excluyendo fondo y borde. La métrica histórica del frame se conserva como diagnóstico. Una prueba con desenfoque sintético y fondo muy texturado confirma que el fondo no cambia la nueva medición.

`RectifierConfig.min_card_laplacian_variance` permite activar un gate con código `CARD_TOO_BLURRY`. Su valor por defecto es `None`: **todavía no existe un rechazo automático de desenfoque activo en producción**. La prueba del gate utiliza un umbral propio del fixture y no constituye calibración. No se introdujo un umbral arbitrario como solución comercial.

Para cerrar este pendiente se necesita un corpus autorizado representativo de ambas generaciones, caras, móviles y condiciones de captura, con referencia humana de legibilidad. La calibración es local y no requiere enviar imágenes a Google. No se encontró ese corpus en el repositorio; se solicitó su ubicación al responsable del producto.

## Evidencia obtenida

- 97 pruebas focalizadas correctas, más 15 comprobaciones relacionadas tras la última corrección (incluyen una regresión nueva de snapshot concurrente): recuperación OCR antes/después del proveedor, fallo persistente sin bucle agresivo, sustitución durante espera, mantenimiento, consumo, rectificación, documentos, versiones históricas, relaciones y API/almacenamiento.
- 78 pruebas existentes de interfaz correctas: 62 Windows y 16 móvil. Tipos y builds de ambas interfaces correctos.
- Word 16.0: herencia máxima con 1 solicitante, 12 herederos y 12 testigos conserva dos páginas; herencia completa y matrimonio completo, una cada uno. Las cuatro páginas se renderizaron y revisaron sin cortes, solapes ni glifos ausentes. Controles: 49 herencia y 13 matrimonio, sin bloqueo y documentos sin protección.
- Se intentó el renderer estándar; no hay `soffice.exe` en el runtime. La alternativa realmente ejecutada fue Word en solo lectura, exportación PDF y Poppler. No se acredita una ejecución LibreOffice.
- Todo el diagnóstico nuevo usa datos sintéticos y almacenamiento aislado; no hubo llamadas Google Vision.

## Paquete y base de trabajo

Paquete completo alpha.3 construido y comprobado. Instalador: `apps/desktop/src-tauri/target/release/bundle/nsis/e-notario_0.8.0-alpha.3_x64-setup.exe`, 97,551,238 bytes. SHA-256:

`CFB11B6829720AE2BD70DAADB54CBA576566B45992D8643214F6CEF7A5E5DE12`

Se verificaron 53 recursos web/plantillas, el bytecode de los siete módulos corregidos contra el fuente actual y el hash ONNX previsto. El ejecutable real devuelve alpha.3/API 2, dos plantillas vigentes, 403 en las tres operaciones móviles reservadas a Windows y 503 `OCR_USAGE_READ_FAILED` ante consumo corrupto. La metadata editable Python también se actualizó localmente a `0.8.0a3`, sin cambiar dependencias.

Sidecar, app e instalador son `NotSigned`; `production_approved` sigue siendo falso. Kits Clean y Upgrade preparados con 8742 archivos instalables y el mismo hash del setup. No se ejecutaron. Evidencia completa: `build/release-alpha3/package-evidence.json`.

La copia de fuentes actuales, incluidos archivos sin rastrear, queda en `build/release-alpha3/e-notario-alpha3-sources.zip`, con manifiesto SHA-256 por archivo. Congela el contenido actual sin reemplazar trabajo existente ni atribuirlo al HEAD antiguo. No constituye un commit Git ni contiene configuración/datos de usuario ignorados por Git.

La instalación real `D:\e-notario` conserva alpha.2. Construir el repositorio no la actualiza. El árbol contiene trabajo anterior modificado y sin rastrear; no se hicieron reset, clean ni sustituciones desde HEAD.

## Gates que siguen abiertos

- Calibración de desenfoque y benchmark con corpus autorizado representativo.
- Firma Authenticode de la organización: no se encontró certificado de code signing disponible en el almacén actual.
- Instalación limpia, actualización y reparación en entorno desechable, y cuenta Windows estándar: Sandbox no está disponible en este puesto. Preparar kits no equivale a ejecutarlos.
- Prueba física de cámaras/móviles y flujo nativo del operador, cancelación, recuperación, apertura fallida y edición manual Word.
- Aprobación jurídica humana, autorización de los recursos gráficos y matriz Windows/Word/móviles soportada.
- Responsables y política empresarial de tratamiento, backups, dispositivos, soporte e incidentes.

Estos puntos no se certifican mediante pruebas sintéticas ni se dan por resueltos con el cierre funcional de Fase 1. El saneamiento no inicia infraestructura SaaS ni cambia el alcance todavía no acordado de Fase 2.
