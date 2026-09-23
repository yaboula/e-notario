# Traspaso a Fase 2 — Valiris Desk SaaS híbrido

Actualización de marca, 23 de septiembre de 2026: **Valiris** es la marca y **Valiris Desk** el nombre comercial de la aplicación. Las menciones históricas a e-notario y las rutas o identificadores técnicos existentes se conservan cuando describen compatibilidad, instalaciones anteriores o contratos internos.

Actualización posterior del escáner: `0.8.0-alpha.4`, API 2. Véase [captura asistida y corrección de bordes](CAPTURE_PROTOCOL.md#captura-asistida-y-corrección-de-bordes--alpha4) y [extensiones de API](PHASE1_API.md#extensiones-de-escáner-alpha4-api-2). Alpha.3 queda preservada en el tag `v0.8.0-alpha.3`; la comparación sintética no sustituye pruebas físicas ni corpus real.

Fecha de consolidación: 18 de septiembre de 2026. Documento de continuidad entre chats, no autorización para implementar o desplegar toda la Fase 2. Leer primero este dossier y después las referencias indicadas. No asumir que el nuevo chat conserva la conversación anterior.

Actualización posterior: la base de trabajo es ahora alpha.3/API 2, herencia 1.5.1. Cola OCR, contador y omisión de caducidad corregidos; calibración de desenfoque y gates externos aún abiertos. El estado vigente está en [Saneamiento de Fase 1](SANEAMIENTO_FASE1.md); las cifras de instalación/hash del dossier original son históricas.

## 1. Encargo inmediato del siguiente agente

El responsable del producto quiere empezar la segunda fase en un chat nuevo porque el anterior está saturado. La Fase 1 local está documentada y su cierre funcional está aceptado. La dirección de producto acordada es SaaS híbrido y un avance dividido en tres grandes fases, no una transformación completa en una sola ejecución.

El siguiente paso es definir y acordar un plan ejecutable de Fase 2: alcance, decisiones abiertas, arquitectura proporcionada, hitos, dependencias y aceptación. No comenzar cambios masivos, contratar proveedores, crear infraestructura o modificar la instalación real solo por recibir este dossier. La revisión OpenCV/OCR original fue diagnóstico; el saneamiento posterior corrigió cola y contador. El gate de desenfoque sigue pendiente de calibración representativa.

No existe aquí un plan detallado aprobado de Fases 2 y 3. Sus fronteras deben confirmarse con el usuario. Los candidatos de alcance de la sección 11 son recomendaciones para discutir, no compromisos ya aceptados.

## 2. Producto, usuarios y forma de trabajo

e-notario ayuda a despachos marroquíes —notarios, adoul y otros profesionales— a capturar CNIE, revisar datos y generar documentos Word. El usuario quiere convertir esta base en un producto vendible a muchos despachos, con calidad profesional y empresarial. Es un proyecto importante para su carrera de ingeniería; las decisiones deben justificarse y mantenerse trazables.

Preferencias expresadas:

- Conversar y documentar en español, conservando el contenido jurídico árabe y las etiquetas originales necesarias.
- Avanzar por fases y acuerdos; no presentar como completado algo que solo está previsto.
- Soluciones enfocadas, sin overengineering ni miles de comandos/pruebas que no aporten al objetivo. Verificar según el riesgo, especialmente aislamiento, pérdida de trabajo y generación jurídica.
- Preguntas claras, sin plazo artificial para decidir. El usuario se quejó de preguntas con temporizador; no interpretar falta de respuesta como aceptación.
- Respetar los textos originales, todas las personas y su función. No reorganizar el cuerpo jurídico por criterios meramente visuales.
- Cuidar el flujo continuo y simple, evitando pantallas técnicas que no necesita el operador.
- Puede usarse D: si falta espacio en C:, con temporales de build aislados y sin borrar archivos del usuario.

## 3. Ubicación y estado técnico de entrega

- Repositorio de trabajo: `D:\e-notario-v2`.
- Documentación: `D:\e-notario-v2\docs`.
- Instalación real del puesto: `D:\e-notario`.
- Acceso directo del usuario: `C:\Users\aboul\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\e-notario.lnk`.
- Base de trabajo: `0.8.0-alpha.3`; compatibilidad API 2. La instalación real mantiene alpha.2.
- `pyproject.toml` declara `0.8.0a3`, homogeneizada con alpha.3 en el saneamiento.
- Al consolidar: rama `main`, HEAD abreviado `4909ae4` (`docs: normalize ADR template`). Estos datos son una instantánea, deben volver a comprobarse.
- Hay numerosos archivos modificados y sin rastrear; gran parte de Fase 1 no está representada por HEAD. No basta leer ese commit.

### 3.1 Advertencia Git imprescindible

Trabajar desde la carpeta actual del proyecto y comprobar `git status` antes de cualquier cambio. Una nueva worktree basada solo en HEAD puede carecer de módulos, plantillas y documentación actuales. No hacer checkout/reset/clean destructivos, no sustituir archivos por versiones antiguas y no asumir que cambios existentes son descartables.

Este traspaso no crea commits ni congela el árbol en una release. Si se necesita aislamiento o una línea base versionada, proponer una operación que preserve también archivos nuevos y acordarla con el usuario. No intentar resolver el árbol sucio eliminándolo.

### 3.2 Motor instalado y paquete

Los dos ejecutables comprobados al consolidar son:

- `D:\e-notario\sidecar\cnie-capture.exe`.
- `D:\e-notario-v2\apps\desktop\src-tauri\binaries\cnie-capture\cnie-capture.exe`.

Ambos tienen SHA-256 `74F7B45E028098028B38D74D2064D6D077FA824681B7674A10087DD18648C9D0`. Es evidencia de igualdad entre esos archivos, no firma comercial ni prueba de todos los recursos del setup. La comprobación previa de salud del puesto devolvió `status: ok`, `version: 0.8.0-alpha.2`, `api_version: 2`.

El setup alpha.2 fue construido antes de dos ajustes posteriores de fechas. Se reconstruyó y actualizó el sidecar del puesto, pero el setup anterior no acredita los hotfixes finales. Antes de entregar a clientes: reconstruir paquete completo, verificar recursos/hashes y ejecutar QA de instalación. No afirmar que el instalador anterior equivale al motor actualmente instalado.

## 4. Documentos que debe leer el siguiente agente

Lectura inicial, en este orden:

1. Este dossier.
2. [Documentación integral de Fase 1](DOCUMENTACION_FASE1.md): alcance, módulos, operación, datos, formularios y límites.
3. [Arquitectura y evidencias](PHASE1_ARCHITECTURE.md): cifrado, colaboración, recuperación, cierre y QA.
4. [API local 2](PHASE1_API.md): 49 rutas, permisos, modelos, revisiones e idempotencia.
5. [README del producto](../README.md) y [changelog](../CHANGELOG.md).

Antes de decidir sobre cada dominio:

- Núcleo: [captura](CAPTURE_PROTOCOL.md), [extracción](STRUCTURED_EXTRACTION.md), [CNIE antigua](CNIE_LEGACY.md), [benchmark](BENCHMARK.md), [Google Vision](GOOGLE_VISION_SETUP.md), [modelo](../models/README.md).
- Documentos: [plantillas](DOCX_TEMPLATES.md) y manifiestos/`legal.txt` en `src/cnie_documents/templates`.
- Distribución: [instalación/móvil](WINDOWS_MOBILE_SETUP.md), [actualizaciones](UPDATES.md), [publicación firmada](RELEASE_WINDOWS.md), [QA Windows](WINDOWS_INSTALLATION_QA.md).
- Decisiones futuras: [convención ADR](decisions/README.md).

Las guías `DOCUMENTACION_V0.6.1.md` y `DOCUMENTACION_V0.7.0.md` son históricas. Sus 60 minutos, datos solo en memoria y flujo antiguo no son instrucciones vigentes. Además, las antiguas «Fases 2/3» del núcleo OCR/extracción no son las nuevas fases del programa SaaS: OCR y extracción ya existen.

## 5. Arquitectura actual, no SaaS remoto todavía

El monorepositorio separa:

- `apps/desktop`: React/TypeScript/Vite, UI Windows.
- `apps/desktop/src-tauri`: Rust/Tauri 2, sidecar, diálogos, guardado/apertura, recibos DPAPI e instancia única.
- `apps/mobile-capture`: web/PWA móvil, captura y recursos propios.
- `packages/api-client`: contratos, HTTP/eventos, errores y compatibilidad API.
- `packages/ui`: revisión, personas, perfiles, relaciones y colaboración compartidas.
- `src/cnie_rectifier`: OpenCV + DocQuadNet/ONNX CPU.
- `src/cnie_ocr`: Google Vision europeo, credencial y límites agregados.
- `src/cnie_extract`: extracción local moderna y antigua.
- `src/cnie_documents`: catálogo y generación OOXML con `zipfile`/`lxml`.
- `src/cnie_cases`: borradores, estados, arrendamientos y almacén cifrado.
- `src/cnie_profiles`: catálogo profesional persistente.
- `src/cnie_capture`: API, coordinación, cola OCR y snapshot recuperable.

Un único proceso coordina HTTP loopback 8787 y HTTPS privado LAN 8788. El token de escritorio queda en Windows; el móvil canjea QR de un uso por una sesión propia. No hay cuentas SaaS, RBAC empresarial, backend multiempresa, facturación ni actualizador remoto implementados.

Rectificación, extracción estructurada y DOCX son locales. OCR requiere internet y envía la imagen rectificada a Google Vision UE. Por tanto, «híbrido/local» no significa «todo offline» ni «ninguna CNIE sale jamás del PC». La futura capa de control no debe recibir CNIE/OCR/Word por defecto; tampoco se deben hacer promesas absolutas de privacidad incompatibles con el proveedor OCR actual.

## 6. Decisiones funcionales que preservar

### 6.1 Captura y datos

La elección profesional es explícita: CNIE 2020 por defecto o CNIE antigua antes de iniciar. Queda fijada para ambas caras; el motor verifica compatibilidad, no cambia silenciosamente de modelo. La antigua sí contiene árabe y latín, incluido el reverso con filiación, dirección y sexo.

Un resultado de rectificación válido acepta automáticamente la imagen y encola OCR. Se eliminaron las etapas ordinarias de aceptación visual, OCR árabe y texto completo. No eliminar por ello las evidencias internas antes de liberar imágenes. La confirmación y aprobación humana de los 14 datos sigue siendo necesaria.

Contratos separados e intactos: `cnie.ma.2020/v2`, `cnie.ma.legacy/v1`. No hay traducción, transliteración, inferencia de faltantes, autenticación de tarjeta, biometría ni uso de MRZ/código de barras para rellenar identidades.

Cada aprobación crea una identidad temporal basada solo en valores revisados. «Conservar identidad y liberar imágenes» elimina originales, rectificaciones, OCR y evidencias del almacén activo sin borrar la identidad aprobada. «Limpiar sesión» exige confirmación y elimina temporales/sesiones/recibos, no perfiles/configuración ni DOCX externos.

### 6.2 Word dentro del flujo

Después de confirmar datos se ofrecen parcial y completo. **Completo ya está implementado**, no es el botón inaccesible de una propuesta anterior. Parcial rellena datos de personas; completo permite también introducir los campos jurídicos declarados. Windows revisa/genera/guarda y abre el documento con la aplicación asociada; móvil prepara solo recursos propios y nunca recibe DOCX.

No editor Word incorporado, no Word/COM/LibreOffice en generación de producción y no sincronización de cambios externos hacia la app. Word/COM se usó únicamente para QA de render.

La solicitud parcial se retira después del guardado correcto. Los expedientes usan `editing → final_review → completed`; descargar no completa. Cancelar diálogo conserva el recurso. Si Word no abre, el archivo queda guardado; se ofrece Explorador. Si falla confirmar cierre tras guardar, recuperar recibo y reintentar solo cierre, no generar otro documento.

### 6.3 Personas, texto y presentación

- Solo dos pilotos actuales: matrimonio `ma.marriage` 1.7.0 y herencia `ma.inheritance` 1.5.1; las versiones históricas permanecen disponibles. Las otras siete referencias del posible paquete de nueve no se han aportado.
- Matrimonio: esposo, esposa y padre de la esposa, cada uno 0–1. No añadir rol de madre.
- Herencia: solicitante 0–1, herederos 0–12 y testigos 0–12. Causante manual, no rol CNIE.
- Todos los mínimos vigentes son cero. Personas/campos jurídicos pendientes avisan, sin bloquear por incompletitud. Formato, máximos, propiedad, integridad, aprobación CNIE y concurrencia sí se validan; no eliminar esas garantías bajo la palabra «opcional».
- Una identidad no se repite dentro del rol; reutilizarla en roles distintos advierte.
- Filiación ya es valor completo con `و`: no separar padres ni añadir otra conjunción. Evitar prefijos duplicados `ابن`/`بنت` procedentes del OCR antiguo.
- Fechas finales: `AAAA/MM/DD`, cifras normales 0–9; ejemplo `2026/09/17`. No números árabes ni fechas escritas con palabras. Internamente ISO, LRM invisible para orden RTL.
- `صلة الإرث`: texto de relación con el causante por heredero, introducido por operador; no cuota/cálculo sucesorio. Se conserva por identidad al reordenar, con contexto de asignación API 2.
- Perfiles: seleccionar uno frecuente o escribir nombre puntual sin alta en catálogo. No desactivar/borrar perfiles en uso; para borrar, primero desactivar.
- Preservar secuencia jurídica original, no convertir cuerpo en tablas/fichas. Después de `شهد بذلك السادة` van testigos, no herederos.
- Primera página arte `p1` completo —header/escudo/título—, `p2` solo continuación. No reemplazar p1 por un marco/pie genérico.
- A4, RTL y controles editables ocultos visualmente. Aleya matrimonial exacta como texto, no IA rasterizada; Amiri Quran 1.003 embebida. La referencia literal y campos/capacidades están en la documentación integral.
- Plantillas versionadas/inmutables, hashes y `legal.txt`; sin importación UI. Archivos históricos no se alteran para cambiar capacidades de expedientes ya fijados.

## 7. Seguridad, datos y recuperación actuales

Almacenes bajo `%LOCALAPPDATA%\e-notario-v2`, separados del destino instalado:

- `temporary-workspace.sqlite3`: snapshot AES-256-GCM, clave DPAPI CurrentUser; imágenes, OCR, aprobaciones, sesiones, solicitudes e idempotencia.
- `temporary-cases.sqlite3`: cifrado por expediente, claves diferentes y DPAPI.
- `professional-profiles.dpapi`: persistente.
- `saved-case-receipts.dpapi`: recibos temporales sin valores CNIE ni bytes Word; contienen ruta/revisión/hash técnicos, que también requieren protección.
- `google-vision.credential.dpapi`: cuenta de servicio protegida.
- `ocr-usage.json`: consumo agregado; tiene el defecto indicado en sección 9.
- `lan.json`, certificados y claves TLS: claves privadas como archivos, no todas envueltas con DPAPI. No distribuirlas; solo CA pública a móviles autorizados.

Retención: capturas 24 h desde creación, identidades 24 h desde aprobación, expedientes 24 h desde modificación, recibos 24 h; no todas las caducidades se renuevan juntas. Móvil cuatro horas, QR 120 segundos un uso. Cierre conserva estado cifrado y limpia memoria; no equivale a borrado inmediato de trabajo. Limpieza no garantiza borrado forense SSD ni de backups externos.

Autorización móvil por propietario, Windows global sobre ese puesto. No equivale a aislamiento multiempresa de un servicio remoto. WS avisa cambios; HTTP autorizado recarga datos. Arrendamientos campo/rol 45 s, renovación UI 15 s; revisiones optimistas/idempotencia evitan sobrescrituras. API 2 exige contexto para relación vinculada a herederos.

Capacidades principales: 20 MiB subida, 50 Mpx decodificación, 30 capturas/160 MiB de bytes de imágenes, 64 identidades/solicitudes/expedientes/perfiles, ocho móviles, 16 WS, DOCX máximo 25 MiB, tres intentos OCR, límites iniciales 60 llamadas/día y 900/mes. Son límites locales, no capacidad SaaS certificada.

No PII/tokens/credenciales/rutas en logs ordinarios; HTTP `no-store`. DOCX solo datos aprobados/campos jurídicos explícitos, sin imágenes CNIE/OCR bruto/evidencias/tokens. DPAPI no protege frente a Windows comprometido; responsabilidades de TI siguen vigentes.

## 8. Evidencia disponible y límites

Se acreditaron con pruebas existentes almacenamiento, perfiles, idempotencia, roles, aislamiento móvil y exclusividad Windows de generar/completar/reabrir. Hay pruebas de herencia con solicitante + 12 herederos + 12 testigos usando identidades sintéticas y liberación progresiva como estrategia de capacidad.

QA visual sintética: cuatro fixtures mínimos/máximos, Word 16.0.20326.20144, cinco páginas revisadas; matrimonio una página, herencia máxima dos; p1/p2 correctos, controles editables/desbloqueados. Después se renderizaron los dos completos con fechas finales `AAAA/MM/DD`. `render_docx.py` se intentó pero faltaba `soffice.exe`; la alternativa ejecutada fue Word/exportación PDF y Poppler. No afirmar ejecución correcta de LibreOffice.

Hubo actualización real autorizada `0.7.2 → alpha.1 → alpha.2`, conservación de configuración y backup preventivo local. Kits Sandbox preparados, no ejecutados: este puesto no dispone de Sandbox. No eludir protección del runner ni usar la instalación del usuario como máquina desechable sin nueva autorización.

La última revisión específica ejecutó:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_rectifier.py tests/test_docquad.py tests/test_geometry.py tests/test_image_io.py tests/test_benchmark.py tests/test_ocr_google.py tests/test_ocr_credentials.py tests/test_ocr_api.py tests/test_capture_api.py tests/test_extract_engine.py tests/test_extract_api.py
```

Resultado: **69 passed**, dos avisos de deprecación del entorno TestClient; no son los tres defectos de la sección siguiente. Se comprobó hash ONNX correcto. Los tests OCR usan dobles de proveedor: no hubo envío de tarjetas a Google ni certificado de precisión OCR real. Las reproducciones adicionales se ejecutaron en memoria con datos sintéticos, sin cambios de código.

El cierre de fase no acredita corpus representativo, aprobación jurídica, firma comercial, interacción física de todos los móviles, instalación limpia/reparación ni toda la experiencia manual de edición Word.

## 9. Hallazgos confirmados después de documentar Fase 1

Estado al traspaso inicial: pendientes, no corregidos. Actualización alpha.3: 9.1 y 9.3 corregidos; 9.2 tiene medición sobre tarjeta y gate configurable, con calibración de producción pendiente. La pasada de 69 tests no significa ausencia de defectos; estos escenarios no estaban cubiertos. No interpretar el cierre funcional como prohibición de corregir regresiones ni como certificación empresarial.

### 9.1 Cola OCR se detiene ante fallo de persistencia — prioridad alta

Origen: `State.ocr_worker()` en `src/cnie_capture/api.py`, alrededor de líneas 729–760. Sus `broadcast()` persisten y pueden lanzar `HTTPException(503, TEMPORARY_STORAGE_WRITE_FAILED)` fuera del `try` que protege la llamada al proveedor. Esa excepción termina la tarea; el `finally` solo confirma `queue.task_done()`, no la recupera.

Reproducción: dos capturas aprobadas sintéticas, store cuya escritura lanza `OSError`, ejecutar worker. Resultado: `worker_stopped=true`, ninguna llamada OCR, una captura `processing`, otra `queued`, una entrada pendiente. El proceso/API puede seguir vivo mientras el OCR deja de avanzar; un `/api/health` correcto no detecta esta condición.

Propuesta a acordar: manejo recuperable explícito del fallo de almacenamiento, preservar estado pendiente, no publicar éxito no durable ni seguir enviando datos al proveedor a ciegas. Probar recuperación tras fallo transitorio y comportamiento ante fallo persistente sin bucle agresivo. Revisar también el mantenimiento periódico que comparte `broadcast`; su terminación ante el mismo fallo es un riesgo a comprobar, no una reproducción adicional ya acreditada.

### 9.2 Nitidez medida sin gate de desenfoque — prioridad media

Origen: `src/cnie_rectifier/quality.py`, líneas 44/61/70 y `RectifierConfig`. La varianza Laplaciana se calcula para el frame de análisis completo, no solo texto de tarjeta; no hay comparación de nitidez en `rejection_codes`.

Reproducción con fixture `synthetic_capture`, configuración por defecto y modo híbrido real: original `laplacian_variance≈209.24` aceptado; Gaussian sigma 3 `≈9.83` aceptado; sigma 8 `≈0.72` aceptado, sin rechazos, por fallback OpenCV. Sigma 15 se rechazó por falta de cuadrilátero en modo OpenCV, no por un gate de nitidez.

Propuesta a acordar: medir legibilidad/desenfoque sobre tarjeta/zonas adecuadas y calibrar con ejemplos representativos. No convertir 0.72 ni cualquier umbral arbitrario en un contrato universal; no añadir una barrera que rechace tarjetas válidas por textura del fondo. La revisión humana sigue siendo necesaria, pero el defecto puede desperdiciar OCR/cuota y empeorar la experiencia.

### 9.3 Contador OCR corrupto tratado como consumo cero — prioridad media

Origen: `src/cnie_ocr/usage.py`, `_read()` alrededor de líneas 38–43. Captura errores de lectura/JSON/conversión y devuelve `{}`, indistinguible de un fichero aún no creado.

Reproducción con lectura simulada de JSON corrupto y escritura interceptada: `summary.used_today=0`, reserva siguiente `used_today=1`, sin alerta. Un archivo válido con consumo anterior no se puede reconstruir a partir de un archivo corrupto; reiniciar silenciosamente debilita el control de costes. La escritura debe revisarse también ante permisos/disco, sin confundir problema local con indisponibilidad Google.

Propuesta a acordar: distinguir ausencia inicial de corrupción/lectura fallida y mostrar error de almacenamiento/consumo, sin reset silencioso ni tratarlo como cuota ilimitada. Probar ruta inexistente, JSON inválido, lectura denegada y escritura fallida; conservar cuotas del proveedor como segunda defensa.

## 10. Otras deudas y gates antes de clientes

Inventario del traspaso original alpha.2; consultar SANEAMIENTO_FASE1.md para distinguir los puntos corregidos y la evidencia del paquete actual.

1. Reconstruir setup coherente con hotfix final, hashes y QA de instalación/actualización/reparación/usuario estándar.
2. Firma Authenticode de organización y canal de distribución; el actualizador remoto firmado sigue futuro.
3. Corpus autorizado moderno/antiguo representativo y benchmark sellado por identidad; no solo dos tarjetas iniciales.
4. Aprobación jurídica humana del texto y render de cada modelo, autorización de recursos gráficos y matriz Word/Windows soportada.
5. Testigos de herencia: manifiesto actual omite `expiry_date`, mientras matrimonio y solicitante/herederos la insertan tras CIN. La intención del usuario era incluir validez en ambas plantillas para las personas; no afirmar cobertura universal hasta corregir o acordar excepción.
6. Homogeneizar versión Python/app y definir una línea base de publicación que incluya el trabajo sin rastrear.
7. Prueba física operador/móvil: cámara, confirmación, cancelación, apertura fallida, recibos/recuperación y edición manual Word.
8. Responsables y política empresarial para datos, backups, dispositivos, soporte e incidentes.

No todos estos puntos pertenecen necesariamente a la misma entrega de Fase 2. Clasificar correcciones de base, gates de distribución y nuevas funciones SaaS con el usuario. Un sprint previo de saneamiento es una recomendación, no autorización otorgada en este traspaso.

## 11. Fase 2: marco propuesto para discutir

Dirección aceptada: añadir control remoto a una estación que conserva procesamiento sensible local. No empezar reescribiendo el núcleo OCR/OpenCV ni introduciendo microservicios por defecto.

Candidatos de bloques, pendientes de aprobación:

1. Modelo organización/despacho, usuarios, roles, estaciones y dispositivos; separación real entre organizaciones y contexto de soporte.
2. Identidad de cuenta, autenticación, sesiones y recuperación/revocación; relación clara entre usuario SaaS y sesión móvil LAN actual.
3. Activación/licencia y derechos de uso; vinculación/reemplazo de equipos, caducidad y funcionamiento ante pérdida de conectividad.
4. Backend de control mínimo, persistencia, despliegue, secretos y entorno de pruebas; contratos/versiones y migraciones explícitos.
5. Operación: administración, trazas de acciones sin PII, salud del puesto/worker, incidentes y soporte autorizado.
6. Distribución/actualizaciones/plantillas versionadas y firmadas; compatibilidad, rollback y no pérdida de datos.

Cobros automáticos, portal amplio, nuevas plantillas, nube documental y expansión comercial no se incorporan por asociación a la palabra SaaS. Decidir si corresponden a Fase 2 o 3. Nueve plantillas no pueden prometerse sin sus originales.

### 11.1 Preguntas abiertas que cambian la arquitectura

- ¿Qué entrega concreta cierra Fase 2 y qué queda en Fase 3?
- ¿Quién contrata: despacho, usuario o estación; cuántos equipos/operadores por organización?
- ¿Qué permisos necesita titular, operador y soporte; hay cuentas compartidas permitidas?
- ¿Qué ocurre con licencia/sesión sin internet y con borradores al vencer el derecho de uso? El OCR actual igualmente necesita red.
- ¿Activación/renovación manual en primer piloto o facturación integrada desde el inicio?
- ¿Quién paga/proporciona Vision: organización/despacho o plataforma? Actualmente el puesto importa su cuenta de servicio; no existe OCR SaaS centralizado.
- ¿Qué hosting/región, dominio, presupuesto, correo de autenticación y proveedor están disponibles? No hay elección definitiva registrada aquí.
- ¿Qué métricas salen del puesto, con qué consentimiento y política; quién accede al soporte y cómo se revoca?
- ¿Qué tamaño de piloto, Windows/Word/móviles soportados y entorno QA desechable estarán disponibles?

Preguntar en grupos pequeños por impacto. Primero propuesta breve y decisiones de producto, después detalles tecnológicos. No fijar stack cloud, identidad, pagos, precios, periodo offline ni fecha de salida como si se hubieran decidido antes.

### 11.2 Entregables recomendados del plan

Objetivo medible, alcance/no alcance, esquema local/control remoto, datos permitidos y límites de confianza, permisos, flujos de activación/conectividad, contratos, hitos pequeños, dependencias/coste operativo, riesgos, pruebas proporcionadas y gates de piloto. Registrar ADR solo para decisiones realmente tomadas. No convertir el dossier en un plan de implementación aprobado.

## 12. Inicio seguro del nuevo chat

Abrir un chat en el proyecto `D:\e-notario-v2`, usando la carpeta de trabajo actual que contiene los cambios. En caso de otra máquina/copia, transferir archivos actuales y documentación por un canal autorizado, sin credenciales/PII; no basta este documento para recrear el código.

Primeros pasos del agente:

1. Leer referencias de sección 4 y reglas locales aplicables; contrastar estado/versiones/plantillas sin modificar datos.
2. Reconocer alcance cerrado, arquitectura híbrida y estado vigente del saneamiento; no reabrir defectos ya corregidos ni dar por calibrado el gate de desenfoque.
3. Presentar una propuesta compacta de Fase 2 y la primera decisión que deba resolver el usuario.
4. Acordar límites e hitos antes de implementar, desplegar o actualizar el puesto.

No ejecutar pruebas con imágenes reales ni llamadas Vision solo para familiarizarse. No iniciar/terminar procesos del usuario, limpiar sesión, importar secretos o instalar paquetes sobre el puesto como parte de la lectura. QA sintética usa almacenamiento aislado. Cambiar código en repo no cambia automáticamente la app instalada.

## 13. Mensaje de inicio listo para copiar

```text
Vamos a planificar la Fase 2 de e-notario como SaaS híbrido, continuando el estado actual, no desde cero. Trabaja en D:\e-notario-v2 y conserva todos los cambios existentes, incluidos archivos sin rastrear. Una worktree limpia basada solo en HEAD no contiene necesariamente el trabajo actual.

Lee completamente docs/PHASE2_HANDOFF.md, docs/DOCUMENTACION_FASE1.md, docs/PHASE1_ARCHITECTURE.md, docs/PHASE1_API.md, README.md y CHANGELOG.md antes de proponer el plan. Consulta las guías especializadas que correspondan.

La Fase 1 local está cerrada funcionalmente y documentada; la base de trabajo es 0.8.0-alpha.3/API 2, con el estado actualizado en docs/SANEAMIENTO_FASE1.md. No es aún una publicación comercial estable ni un SaaS remoto. El saneamiento corrigió cola OCR, contador corrupto y caducidad de testigos (herencia 1.5.1). Falta calibrar el gate de desenfoque con corpus representativo y completar los gates externos de publicación. Consulta el informe vigente para evidencia del nuevo setup; la instalación real alpha.2 no se actualiza automáticamente al cambiar el repositorio. No ocultes estos pendientes ni afirmes gates que no se han ejecutado.

La dirección híbrida y el avance en tres fases están aceptados; el alcance detallado de Fases 2/3, stack cloud, licencias, pagos, proveedores y política offline todavía deben acordarse. Primero presenta tu comprensión, una propuesta enfocada con hitos/aceptación y preguntas sin temporizador. No empieces implementación, infraestructura o actualización de mi instalación hasta que acordemos el plan. Mantén español, respeto al texto jurídico y la privacidad, sin overengineering ni pruebas/comandos innecesarios.
```
