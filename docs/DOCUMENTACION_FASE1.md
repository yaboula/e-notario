# e-notario Fase 1 Documentación integral

Actualización posterior del escáner: `0.8.0-alpha.4`, API 2. Véase [captura asistida y corrección de bordes](CAPTURE_PROTOCOL.md#captura-asistida-y-corrección-de-bordes--alpha4) y [extensiones de API](PHASE1_API.md#extensiones-de-escáner-alpha4-api-2). Alpha.3 queda preservada en el tag `v0.8.0-alpha.3`; la comparación sintética no sustituye pruebas físicas ni corpus real.

## 1. Estado y propósito

Referencia de trabajo: `0.8.0-alpha.3`, API local 2, 18 de septiembre de 2026. El cierre original corresponde a alpha.2; las correcciones posteriores y la evidencia vigente están en [Saneamiento de Fase 1](SANEAMIENTO_FASE1.md). La Fase 1 queda cerrada por decisión del responsable del producto tras sus pruebas y las correcciones documentales finales. Este cierre acredita el alcance local entregado; no cambia automáticamente la versión alfa a una publicación estable ni certifica requisitos externos todavía no acreditados.

e-notario es una estación Windows para capturar las dos caras de una CNIE marroquí, rectificarlas, obtener OCR, confirmar los datos y preparar un documento Word. El móvil autorizado participa en la captura y preparación; Windows controla la generación y el guardado. El archivo final queda en manos del operador, que continúa en Word sin sincronización de retorno.

La documentación es una referencia de producto, ingeniería y operación. No contiene datos personales reales ni constituye una aprobación jurídica de los modelos. Ante contradicción con las guías históricas 0.6.1 o 0.7.0, prevalecen esta referencia y el comportamiento verificado del código actual.

### 1.1 Lectura recomendada

- Operador: secciones 3–9 y 14–16.
- TI del despacho: secciones 10–16 y las guías de instalación, OCR y publicación.
- Ingeniería: secciones 2, 10–13 y 17–21, junto con [API de Fase 1](PHASE1_API.md).
- Responsable del producto: alcance, cierre, evidencias y pendientes de comercialización en las secciones 1 y 19–21.

### 1.2 Alcance cerrado

Se entregan captura Windows/móvil, rectificación común, perfiles de extracción separados para CNIE 2020 y antigua, revisión de 14 campos, identidades temporales aprobadas, liberación de imágenes, relleno parcial y completo, dos plantillas DOCX, perfiles profesionales, edición colaborativa de expedientes, reanudación cifrada, limpieza de sesión, guardado atómico y recuperación de su confirmación.

Quedan fuera cuentas SaaS, organizaciones remotas, suscripciones, cobros, portal administrativo, actualización remota, almacenamiento documental en la nube, firma electrónica, editor Word incorporado, autenticación biométrica y un catálogo de nueve modelos. Solo existen los dos pilotos; las otras siete referencias originales todavía no se han aportado.

## 2. Arquitectura implementada

El monorepositorio separa interfaz, transporte y dominios. La aplicación Tauri arranca el sidecar Python y proporciona a su interfaz un token de escritorio privado. El mismo servicio atiende HTTP en loopback y HTTPS en la LAN. No hay un backend SaaS desplegado en esta fase.

### 2.1 Componentes y responsabilidades

- `apps/desktop`: React, TypeScript y Vite; puesto Windows, revisión, documentos, perfiles y diagnóstico.
- `apps/desktop/src-tauri`: Rust/Tauri 2; arranque del motor, instancia única, diálogos, archivos, apertura, Explorador y recibos de guardado.
- `apps/mobile-capture`: interfaz móvil web/PWA; cámara, revisión y preparación de recursos propios. PWA no significa funcionamiento OCR sin conexión.
- `packages/api-client`: contratos TypeScript, cliente HTTP, compatibilidad, eventos y mensajes de error.
- `packages/ui`: componentes compartidos, selectores de personas, perfiles, relaciones sucesorias y colaboración.
- `src/cnie_rectifier`: OpenCV, DocQuadNet-256 y ONNX Runtime CPU, geometría y calidad.
- `src/cnie_ocr`: Vision UE, credenciales y contadores agregados.
- `src/cnie_extract`: regiones, normalización y extracción de los dos diseños CNIE.
- `src/cnie_documents`: catálogo, manifiestos, seguridad OOXML y generación.
- `src/cnie_cases`: expediente, validación, persistencia y arrendamientos de edición.
- `src/cnie_profiles`: catálogo profesional protegido.
- `src/cnie_capture`: API, coordinación, cola OCR y instantánea recuperable.
- `scripts` y `tests`: construcción, fixtures sintéticos, publicación, QA e integración.

El detalle del ciclo de vida y de los fallos de persistencia se conserva en [Arquitectura de Fase 1](PHASE1_ARCHITECTURE.md).

### 2.2 Distribución del procesamiento

Detección, rectificación, extracción estructurada y generación DOCX ocurren en el PC. El OCR requiere internet y envía a Google Vision la imagen rectificada aceptada, no el DOCX ni el catálogo profesional. El móvil envía las capturas al PC; no ejecuta ONNX ni recibe el documento Word.

Word no participa en la generación de producción. El motor utiliza `zipfile` y `lxml`, sin COM ni LibreOffice. El uso de Microsoft Word para exportar fixtures a PDF pertenece únicamente a QA documental.

## 3. Usuarios y permisos

### 3.1 Operador Windows

Puede ver los recursos temporales de la estación, importar imágenes, generar QR, revisar datos, asignar personas, completar campos, administrar perfiles, revisar expedientes, guardar DOCX, liberar imágenes y limpiar la sesión. Puede reabrir un expediente en revisión final o completado mientras siga retenido.

No existe todavía una cuenta individual de aplicación con RBAC. El privilegio Windows corresponde a la superficie de escritorio autenticada por su token; no equivale a una auditoría nominativa empresarial.

### 3.2 Operador móvil

Tiene una sesión de hasta cuatro horas y solo ve sus capturas, identidades, solicitudes y expedientes. Puede editar estos recursos y enviarlos a revisión. Recibe perfiles profesionales activos, sin contadores globales de uso. No puede generar, completar o reabrir expedientes finalizados, administrar perfiles, configurar OCR, exportar JSON aprobado o limpiar todos los datos de la estación.

Un recurso ajeno se presenta como inexistente, normalmente con HTTP 404. Una operación exclusiva de escritorio devuelve HTTP 403. Ocultar un botón no sustituye esa autorización del servidor.

### 3.3 TI y responsable jurídico

TI configura Windows, red privada, certificados, cuenta de servicio, cuotas, actualización y política de backups. La persona jurídicamente responsable aprueba el texto y el render de cada plantilla antes de utilizarla como modelo de producción. e-notario no calcula derechos hereditarios ni sustituye esa responsabilidad.

## 4. Flujo del operador

1. Abrir e-notario y comprobar que interfaz y motor son compatibles.
2. Elegir CNIE 2020, que es el valor inicial, o CNIE antigua antes de iniciar una nueva tarjeta.
3. Importar JPEG/PNG desde Windows o vincular un móvil mediante el QR.
4. Capturar anverso y reverso de la misma tarjeta.
5. Una rectificación satisfactoria acepta automáticamente la imagen e inicia OCR. Si falla el gate de imagen, repetir la cara.
6. Revisar los datos extraídos contra ambas imágenes; corregir y confirmar categorías o usar «Aceptar todo y aprobar».
7. Elegir «Relleno parcial» o «Relleno completo» en la entrada documental del mismo flujo.
8. Elegir plantilla y asignar identidades a sus roles. Puede prepararse un modelo con roles vacíos.
9. En completo, introducir los campos jurídicos deseados. Los recomendados vacíos generan avisos, no un bloqueo por incompletitud.
10. Windows revisa y ejecuta «Guardar y abrir en Word».
11. Elegir destino; continuar editando el mismo DOCX en Word.
12. Cuando corresponda, liberar imágenes o limpiar la sesión.

Se eliminaron del recorrido ordinario los pasos separados de aceptación visual, OCR árabe y texto completo. El OCR completo sigue existiendo internamente y su endpoint es exclusivo de Windows; eliminar una pantalla no significa eliminar el dato de trabajo antes de liberar imágenes o limpiar sesión.

## 5. Captura y rectificación

### 5.1 Condiciones de captura

Una sola tarjeta sobre fondo mate, liso y contrastante; cuatro esquinas visibles; sin dedos, flash directo ni objetos que la solapen. La ocupación recomendada es aproximadamente 50–90 % del encuadre y el lado corto de la tarjeta debe aportar al menos 1.000 píxeles.

Se admiten JPEG y PNG. HEIC y PDF no son entradas de captura. El límite HTTP es 20 MiB por archivo; el decodificador limita a 50 millones de píxeles. La salida canónica es `1600 × 1008`, JPEG con calidad 95. El perfil activo conserva gates de geometría, resolución, bordes e iluminación; no se flexibiliza para hacer pasar un caso concreto. La revisión posterior confirmó que la métrica de nitidez no se usa como gate de rechazo: no se afirma un control duro de desenfoque ya implementado.

### 5.2 Detección híbrida

OpenCV y DocQuadNet proporcionan hipótesis y evidencias. La lógica híbrida contrasta esquinas, máscara, bordes y desacuerdos, y aplica fallbacks controlados. Un resultado `success` es el gate automático de la imagen, no una aprobación de identidad ni una comprobación de autenticidad.

El modelo incluido es DocQuadNet-256 FP32, opset 17, CPU, fijado al commit upstream `5d08804af3a2fe6d25c09f85366a19ca4fac0a04`. El SHA-256 local es `b4727efbeedeb0e751cc03ae96572ccb1c7f891ee00e62278eca98826fd20abb`. La copia corrige únicamente el orden topológico de un nodo Cast; la procedencia y licencias figuran en [Modelo](../models/README.md) y [Avisos de terceros](../THIRD_PARTY_NOTICES.md).

### 5.3 Repetición y sustitución

Sustituir una cara invalida la extracción, sus revisiones y la identidad aprobada derivada. Las solicitudes parciales que la referencian se retiran. Los expedientes completos conservados no se consideran válidos automáticamente: su generación vuelve a comprobar la existencia y caducidad de las identidades asignadas.

Las respuestas OCR de una captura anterior no sobrescriben la nueva; se comprueba su generación interna y si sigue activa. Véanse los códigos y acciones en [Protocolo de captura](CAPTURE_PROTOCOL.md).

## 6. OCR y extracción CNIE

### 6.1 OCR europeo

Google Cloud Vision recibe la imagen rectificada mediante el endpoint europeo configurado. La cuenta de servicio se importa expresamente en Windows y su JSON se guarda protegido con DPAPI CurrentUser. La aplicación no elimina el JSON original; TI debe retirarlo mediante su procedimiento.

La cola distingue `not_started`, `queued`, `processing`, `success`, `no_text`, `error` y `cancelled`. Los reintentos están controlados y el máximo es tres intentos por captura. Una tarea interrumpida puede reencolarse al recuperar la instantánea. Los límites iniciales son 60 llamadas diarias y 900 mensuales; también deben existir cuotas y alertas del proveedor.

La prueba de conexión usa una imagen sintética y consume una llamada. Los contadores persisten fechas y cantidades agregadas, sin valores de identidad. [Configuración de Vision](GOOGLE_VISION_SETUP.md) documenta importación, rotación y límites.

### 6.2 Modelo moderno y antiguo

La selección profesional es explícita: `CNIE_MA_2020` o `CNIE_MA_LEGACY`. Queda fijada para ambas caras del documento. Para cambiarla se inicia otra CNIE. El motor verifica compatibilidad y rechaza modelo equivocado o caras mezcladas; no se presenta como un clasificador universal de cualquier tarjeta marroquí.

La CNIE antigua contiene árabe y latín. Su reverso tiene regiones propias para filiación, domicilio y sexo; no reutiliza los recortes modernos. No se extraen retrato, firma, biometría, código de barras ni estado civil al contrato aprobado. La comparación del CIN visual entre caras evita aprobar una discrepancia.

Los contratos permanecen separados: `cnie.ma.2020/v2` y `cnie.ma.legacy/v1`. El piloto antiguo funciona dentro del alcance probado; la cobertura de todas las tiradas, desgaste y cámaras no está acreditada por las dos imágenes iniciales. Consulte [CNIE antigua](CNIE_LEGACY.md).

### 6.3 Los 14 campos revisados

- `national_id`: número CIN.
- `given_names_ar`, `surname_ar`: nombre y apellidos árabes.
- `given_names_latin`, `surname_latin`: nombre y apellidos latinos.
- `birth_date`: nacimiento, almacenado como fecha ISO.
- `birth_place_ar`, `birth_place_latin`: lugar de nacimiento en las dos escrituras.
- `expiry_date`: fin de validez de la tarjeta, almacenado como fecha ISO.
- `filiation_ar`, `filiation_latin`: filiación completa, con estructura multilineal cuando corresponda.
- `address_ar`, `address_latin`: domicilio.
- `sex`: marcador impreso `M` o `F`, no inferido del nombre.

La extracción es local, geométrica y determinista. No traduce, translitera, reconstruye texto faltante por contexto ni autentica la tarjeta. Los valores brutos, confianza y polígonos son evidencias de trabajo, no datos que deban trasladarse al Word.

### 6.4 Revisión y aprobación

Cada revisión usa una revisión optimista y decisiones `confirmed`, `corrected` o `absent`. En el perfil actual los 14 campos son requeridos para la aprobación: no se acepta como ausente un campo requerido. Se comprueban el formato CIN, las fechas, el sexo y que la caducidad sea posterior al nacimiento. No confundir esta comprobación con un dictamen de vigencia jurídica de la tarjeta.

«No bloquear por campos documentales vacíos» se aplica a la preparación de Word, no elimina las garantías de aprobación CNIE. Tampoco desactiva autorizaciones, integridad de plantilla, límites de longitud o control de concurrencia.

La exportación JSON aprobada es explícita y exclusiva de Windows. Incluye los valores revisados y correcciones, no imágenes, OCR completo, tokens ni respuesta original de Google. El portapapeles intenta retirar el mismo valor copiado tras 60 segundos; no borra contenido nuevo que lo haya sustituido ni garantiza eliminar historiales o sincronizaciones del sistema.

## 7. Identidades temporales

Una aprobación produce una instantánea `ApprovedIdentity`: identificador técnico, propietario, documento origen, revisión aprobada, modelo, valores revisados, creación, caducidad y estado de liberación de imágenes. La generación solo usa esta instantánea, no los candidatos OCR sin revisar.

La capacidad es 64 identidades y la caducidad de identidad es 24 horas desde su aprobación. No se renueva automáticamente porque el operador modifique un expediente que la utiliza. Cerrar el motor limpia su memoria después de persistir el estado cifrado recuperable; ya no implica destruir inmediatamente todo el trabajo.

«Conservar identidad y liberar imágenes» exige aprobación, está disponible para Windows o el móvil propietario y elimina originales, rectificadas, OCR y evidencias administradas por la aplicación. Conserva los datos aprobados hasta su caducidad original y permite capturar progresivamente más personas sin retener todas las imágenes. La operación es irreversible en el almacén activo; una nueva captura sería necesaria para obtener otra evidencia visual.

Eliminar, sustituir o caducar una identidad invalida las solicitudes parciales dependientes. En completo, deben corregirse asignaciones inválidas antes de generar. Los DOCX ya guardados fuera del almacén no se modifican ni eliminan.

## 8. Documentos parciales y completos

### 8.1 Relleno parcial

Rellena personas asignadas desde identidades aprobadas. Los campos jurídicos `manual.*` permanecen disponibles para el operador en Word. Se prepara una solicitud fijada a la versión de plantilla; Windows puede corregir roles y guardarla. Cancelar el diálogo conserva la solicitud. Solo después de confirmar guardado se retira la revisión correspondiente.

### 8.2 Relleno completo

Permite introducir los campos jurídicos declarados en el formulario, además de asignar personas. «Completo» es el modo de edición de esos campos, no una obligación de rellenarlos todos. Los vacíos recomendados aparecen en readiness y en avisos; no requieren una confirmación bloqueante para generar.

El expediente `CaseDraft` fija plantilla, versión y modo. Conserva propietario, revisión, campos, asignaciones, estado, creación, actualización y caducidad. Los estados son `editing`, `final_review` y `completed`. La revisión final bloquea cambios; Windows puede reabrir. Descargar/generar no completa: la confirmación posterior al guardado es la que completa el expediente.

### 8.3 Personas y roles

Matrimonio `ma.marriage` 1.7.0 admite esposo 0–1, esposa 0–1 y padre de la esposa 0–1. No tiene rol separado de madre. Herencia `ma.inheritance` 1.5.1 admite solicitante 0–1, herederos 0–12 y testigos 0–12. El causante no se asigna desde una CNIE; en completo se escribe en el campo jurídico y en parcial queda para Word.

Todas las cardinalidades mínimas actuales son cero. Los máximos siguen siendo límites. No se repite una identidad dentro de un rol; puede aparecer en roles distintos con advertencia visible. Los grupos repetibles tienen búsqueda, casillas y lista ordenada. Quitar una persona conserva el orden restante.

### 8.4 Filiación, caducidad y fechas

La filiación llega aprobada como valor completo, incluidos los progenitores y su `و`. No se separa ni se añade otra `و`. Al componer la persona se evita repetir un prefijo inicial `ابن` o `بنت`. En matrimonio la gramática procede del rol; en herencia procede del sexo revisado.

La forma personal combina nombre, filiación, nacimiento y lugar, CIN, cláusula de validez cuando está declarada y domicilio. No se inventan datos. El espaciado de los controles impide unir una palabra insertada a la palabra jurídica adyacente.

La decisión final de formato es **`AAAA/MM/DD` con cifras normales `0–9`**, por ejemplo `2026/09/17`. Aplica a las fechas insertadas desde CNIE y a los campos jurídicos de fecha. Los valores internos siguen siendo ISO `YYYY-MM-DD`. Marcas invisibles LRM preservan el orden visual dentro del contexto RTL y no consumen la capacidad visible del campo.

La caducidad se añade como `الصالحة إلى غاية` después del CIN en los enlaces actuales de matrimonio y en solicitante/herederos de herencia. Desde herencia 1.5.1, los doce testigos también declaran `expiry_date` e insertan esa cláusula después del CIN. La versión 1.5.0 conserva su comportamiento original y permanece disponible para expedientes ya fijados.

### 8.5 Relación con el causante

`صلة الإرث` es una relación introducida por el operador para cada heredero: por ejemplo `ابن`, `بنت`, `زوجة` o `أخ`. No es un porcentaje, cuota ni cálculo sucesorio. El formulario identifica «Relación con el causante» junto al heredero concreto; Word inserta `صلة الإرث: ...` cuando hay valor.

Los valores se reasocian por identidad al añadir, retirar o reordenar herederos. Un heredero nuevo comienza vacío. Cada parche aporta el contexto de asignación utilizado por el editor y una respuesta obsoleta se rechaza; así no se traslada una relación a otra persona por cambiar el orden.

## 9. Perfiles profesionales

Windows administra hasta 64 perfiles persistentes. Incluyen identificador, nombre árabe, nombre francés y función opcionales, estado activo y revisión. Un campo como primer adoul puede seleccionar un perfil frecuente o elegir «Escribir directamente» para introducir un nombre puntual sin crear una entrada de catálogo.

La referencia a un perfil se resuelve a su nombre árabe al generar. Un nombre directo pertenece solo al expediente. Corregir un perfil puede afectar a la siguiente generación de expedientes que lo referencien; nunca cambia documentos guardados previamente.

No se permite desactivar o borrar un perfil en uso por expedientes retenidos, incluidos completados que todavía pueden reabrirse. Para borrar se exige desactivación previa; primero sustituya sus referencias. El UUID de creación se mantiene en reintentos para no duplicar perfiles tras una respuesta perdida. Las escrituras se publican atómicamente y un fallo revierte también la mutación en memoria.

## 10. Colaboración y concurrencia

Windows y el móvil propietario pueden editar un expediente en `editing`. Cada campo y rol usa un arrendamiento de 45 segundos; el cliente renueva cada 15 segundos mientras tiene foco y lo libera al salir. Otro dispositivo ve quién está editando. Campos distintos pueden guardarse mediante parches atómicos sin sobrescribir el resto del expediente.

Las revisiones optimistas evitan sobrescrituras. La revisión final exige ausencia de editores activos. Cambiar de expediente o abandonar la pantalla espera guardado y liberación; si hay un fallo, el valor local permanece visible y no se presenta como confirmado.

Respuestas de adquisiciones antiguas se descartan por ciclo de vida del editor. Si se concedió un bloqueo después de cerrar, se intenta liberar; la caducidad limita su duración ante caída de red. Los bloqueos son locales al proceso y no se restauran como activos tras reiniciar.

Los eventos WebSocket notifican `changed`; el cliente recarga recursos autorizados. No transmiten por broadcast una instantánea global con PII. No equivalen a historial de auditoría, presencia empresarial duradera ni sincronización con Word.

## 11. Persistencia, retención y limpieza

### 11.1 Ubicación

La configuración y almacenes del usuario viven bajo `%LOCALAPPDATA%\e-notario-v2`. El destino de instalación es independiente. Los ejemplos de QA usan una raíz aislada, nunca una copia de datos reales para pruebas sintéticas.

### 11.2 Almacenes

- `temporary-workspace.sqlite3`: instantánea cifrada de capturas, imágenes, OCR, revisiones, identidades, solicitudes, sesiones e idempotencia. El contenido se cifra con AES-256-GCM y la clave se protege mediante DPAPI.
- `temporary-cases.sqlite3`: expedientes, con una clave AES-256-GCM distinta por expediente y envoltura DPAPI.
- `professional-profiles.dpapi`: catálogo persistente protegido, no temporal.
- `saved-case-receipts.dpapi`: recibos de guardado temporal, sin valores CNIE ni bytes DOCX.
- `google-vision.credential.dpapi`: cuenta de servicio protegida mediante DPAPI CurrentUser.
- `ocr-usage.json`: fecha y cantidades agregadas de llamadas.
- `lan.json` y `tls`: dirección y certificados de oficina. Las claves TLS son archivos privados, no blobs DPAPI; deben protegerse con la cuenta, permisos del sistema y política de TI.

No se afirma que todo SQLite esté cifrado como un volumen: los identificadores técnicos, revisión y tiempos necesarios quedan fuera del ciphertext. Los valores sensibles forman parte del contenido cifrado. DPAPI vincula el descifrado al usuario Windows; copiar los blobs a otra cuenta no constituye una migración válida.

### 11.3 Caducidades

Capturas e identidades: hasta 24 horas según sus marcas de creación/aprobación. Expedientes: 24 horas desde su última modificación. Recibos: 24 horas desde el guardado. Sesiones móviles: cuatro horas. QR: dos minutos, un solo uso. Los datos se podan mientras el motor funciona y al recuperarlos; no se ejecuta borrado de la aplicación mientras el PC o la aplicación están apagados.

Una instantánea nueva usa una clave nueva. SQLite activa `secure_delete` y trunca WAL para no conservar una copia anterior descifrable con la clave vigente. Esto no garantiza borrado forense de sectores SSD, copias externas, restauraciones del sistema o backups.

### 11.4 Limpiar sesión

La acción Windows exige confirmación y elimina datos temporales administrados: capturas, OCR, identidades, solicitudes, expedientes, sesiones, cola, idempotencia y recibos. Conserva plantillas, perfiles profesionales y configuración OCR/red. Nunca elimina DOCX elegidos y guardados por el operador.

Una copia preventiva hecha antes de instalar puede seguir conteniendo datos temporales cifrados. Limpiar sesión no borra backups externos; TI debe aplicar su propia caducidad y eliminación autorizada.

## 12. Seguridad y límites

### 12.1 Límites de confianza

El servicio local `127.0.0.1:8787` es exclusivo del PC; la LAN usa HTTPS privado en 8788. No se publica el puesto mediante port forwarding ni se expone el loopback. El token de escritorio nunca se entrega al móvil. HTTPS depende de la CA de oficina confiada en teléfonos autorizados.

Las respuestas llevan `Cache-Control: no-store`, `nosniff`, `no-referrer` y CSP. Se permite cámara propia y se deshabilitan micrófono y geolocalización. Swagger/OpenAPI público está deshabilitado. Los logs normales no deben revelar contenido OCR, CIN, nombres, tokens, claves o rutas internas.

El cifrado protege datos en reposo, no un Windows comprometido, administrador malicioso, malware, capturas de pantalla o documentos que el operador exporte. Deben aplicarse bloqueo de sesión, permisos, cifrado del dispositivo y control de copias conforme a la política del despacho.

### 12.2 Capacidades del puesto

- 30 capturas retenidas y presupuesto de 160 MiB para bytes de originales/rectificadas, con margen al admitir un archivo. No es un límite de RSS total del proceso.
- 64 identidades, 64 solicitudes parciales, 64 expedientes y 64 perfiles profesionales.
- Hasta ocho sesiones móviles y 16 sockets de eventos.
- Hasta 12 asignaciones por rol repetible.
- Hasta 96 claves de campos por expediente; límite estructural 4.096 caracteres por valor, además de la capacidad menor declarada por cada plantilla.
- Salida DOCX y plantilla: máximo 25 MiB; suma descomprimida del paquete limitada a cuatro veces ese tamaño.
- Instantánea serializada: máximo 220 MiB; catálogo de recibos nativo: 1 MiB y 64 recibos.

La liberación progresiva de imágenes permite reunir 25 personas de herencia sin retener simultáneamente 50 caras. Los máximos y errores de recursos siguen siendo bloqueantes; mínimos cero no significa capacidad ilimitada.

## 13. Plantillas y OOXML

Cada paquete contiene `template.docx`, `manifest.json` y `legal.txt`, con versiones y hashes SHA-256. El catálogo valida al iniciar y selecciona la SemVer más alta para nuevas operaciones. Un expediente conserva su versión exacta; versiones archivadas permanecen inmutables y pueden mantener cardinalidades históricas distintas.

`enotario.document-template/v2` declara roles, fuentes CNIE, campos jurídicos, tipos, etiquetas, dirección, capacidades e índices. Se conserva compatibilidad de lectura v1. Los controles automáticos usan `enotario.*`; los jurídicos usan `manual.*`. En parcial no se rellenan estos últimos; en completo solo se rellenan los declarados.

Los controles son editables, sin protección y con apariencia oculta, no marcadores visibles. Grupos repetibles tienen doce posiciones preautorizadas; no se clonan bloques dinámicamente. Vacíos conservan zonas editables. Se rechazan macros, ActiveX, OLE, relaciones externas, comentarios, cambios pendientes, rutas ZIP inseguras, controles duplicados, etiquetas desconocidas, manifiestos incoherentes, hashes y texto jurídico incorrectos.

El cuerpo conserva la secuencia jurídica original, sin convertirlo en fichas o tablas. En herencia la lista después de `شهد بذلك السادة` es de testigos, no herederos. El diseño es A4 y RTL; `p1` contiene encabezado y título personalizados y `p2` se usa únicamente en continuación. Matrimonio conserva la aleya exacta editable con Amiri Quran 1.003 embebida y licencia OFL. No se afirma que sea la fuente oficial de un organismo coránico.

El generador limpia autor y última persona modificadora; conserva las propiedades no personales `eNotarioTemplate` y `eNotarioGenerator`. El DOCX no recibe imágenes CNIE, valores brutos, OCR completo, polígonos, tokens ni rutas internas.

Para añadir o versionar modelos siga [Guía DOCX](DOCX_TEMPLATES.md). No existe importación de plantillas desde UI ni actualización central del catálogo.

### 13.1 Inventario del formulario jurídico vigente

Las claves de campo enlazan controles `manual.<clave>` del DOCX. La bandera de manifiesto `required` se conserva como recomendación/readiness, no como bloqueo por vacío en el comportamiento actual. Todos los campos siguientes son recomendados salvo `heir_relation`, que es opcional; las capacidades sí se validan cuando hay valor.

| Campos comunes a los dos pilotos | Tipo | Capacidad por valor |
|---|---|---|
| `registry_number` — número de registro | `text` | 64 |
| `page` — página | `number` | 24 |
| `book_number` — libro | `text` | 64 |
| `registry_date` — fecha de registro | `date` | 10 |
| `notary_1`, `notary_2`, `notary_3` — primer, segundo y tercer profesional | `professional_profile` | 160 cada uno |

| Campos exclusivos de matrimonio | Tipo | Capacidad |
|---|---|---|
| `case_number` — referencia del expediente judicial | `text` | 64 |
| `case_date` — fecha de la referencia | `date` | 10 |
| `dowry` — dote | `amount` | 256 |

| Campos exclusivos de herencia | Tipo | Capacidad |
|---|---|---|
| `deceased` — datos manuales del causante | `arabic_text` | 512 |
| `death_date` — fallecimiento | `date` | 10 |
| `death_record` — referencia del acta | `text` | 64 |
| `death_record_date` — fecha del acta | `date` | 10 |
| `heir_relation` — relación por heredero, índices 1–12 | `arabic_text` | 160 por heredero |
| `estate_basis` — texto jurídico sobre la base de la herencia | `arabic_text` | 1.024 |

Son diez definiciones de campo en matrimonio y trece en herencia; una definición puede tener doce posiciones. `amount` no constituye cálculo financiero y los textos jurídicos no se deducen de OCR. Consulte las etiquetas originales del manifiesto al revisar una traducción de interfaz.

### 13.2 Aleya y fidelidad del contenido

La secuencia Unicode matrimonial que se conserva en el constructor y en la referencia jurídica es:

> وَمِنْ ءَايَـٰتِهِۦٓ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَٰجًۭا لِّتَسْكُنُوٓا۟ إِلَيْهَا وَجَعَلَ بَيْنَكُم مَّوَدَّةًۭ وَرَحْمَةً ۚ إِنَّ فِى ذَٰلِكَ لَـَٔايَـٰتٍۢ لِّقَوْمٍۢ يَتَفَكَّرُونَ

Se compone como texto, no se confía su exactitud a una imagen generada por IA. El nombre de archivo gráfico matrimonial `template_zawaj-p2-v2.png` es histórico: en la plantilla vigente se utiliza como arte inicial `p1` corregido, no como razón para aplicarlo solo a una segunda página. El cuerpo usa tipografía compatible con Windows y escritura compleja RTL; la fuente coránica embebida pertenece al bloque de la aleya.

El texto legal completo de cada modelo permanece en su `legal.txt`; esta guía no crea una segunda versión jurídica editable que compita con esa autoridad. Cualquier cambio del texto o composición requiere nueva versión de plantilla y render, no un parche informal al paquete existente.

## 14. Guardado y recuperación

El nombre predeterminado no contiene PII: `matrimonio-20260917-150000.docx` o `herencia-20260917-150000.docx`. Tauri abre el diálogo nativo, exige `.docx`, escribe un temporal en la misma carpeta, fuerza la escritura y lo publica atómicamente. Cancelar no completa ni retira el recurso.

Un recibo protegido se prepara antes del commit del archivo y se confirma después, antes de abrir Word. Contiene identificador, tipo parcial/completo, revisión, destino, hash y tiempos. Si se interrumpe entre commit y confirmación, se compara el archivo con el hash. Una vez confirmado, las ediciones posteriores de Word no invalidan el guardado inicial.

Si falla abrir la aplicación asociada, el archivo queda guardado y se ofrece mostrarlo en Explorador. Si falla cerrar el expediente o retirar la solicitud después del guardado, se recupera el recibo y se reintenta únicamente esa confirmación. No se vuelve a generar ni guardar otro archivo. Una revisión diferente nunca se cierra automáticamente.

En «Guardados recuperables» pueden aparecer recibos aunque la bandeja esté vacía. El catálogo caducado se limpia al arrancar y cada 30 segundos mientras la app está abierta. Un catálogo ilegible bloquea generación para no fingir recuperación correcta. Retirar un recibo no borra su DOCX.

## 15. Instalación y configuración

### 15.1 Puesto Windows

El paquete actual es NSIS x64 con Tauri y sidecar; puede obtener WebView2 mediante bootstrapper si falta. El usuario final no necesita instalar Python, Node o Rust. Requiere Windows compatible, permisos sobre destino/configuración y conexión al proveedor OCR. La generación de DOCX no exige Word; abrirlo y editarlo requiere una aplicación asociada compatible.

No se acredita una matriz universal de versiones de Windows ni rendimiento de hardware mínimo. La versión de Word utilizada para QA fue 16.0.20326.20144; deberán probarse los entornos soportados elegidos para comercializar.

### 15.2 LAN y móviles

Asigne reserva DHCP y permita TCP 8788 solo en red privada/subred autorizada. e-notario detecta la ruta privada activa y configura HTTPS; ante ambigüedad permite dirección manual. La CA dura dos años y el certificado servidor 90 días, con renovación cuando cambia IP o quedan menos de 14 días.

Solo se distribuye `office-ca.crt`, nunca `office-ca.key` o `server.key`. Confíe la CA únicamente en móviles autorizados; compruebe hora, red y ausencia de aislamiento Wi-Fi. Genere QR desde Windows, indique operador/dispositivo y conceda cámara al sitio HTTPS. [Guía Windows/móvil](WINDOWS_MOBILE_SETUP.md) contiene el procedimiento completo.

### 15.3 OCR

Importe una cuenta de servicio dedicada con permisos mínimos y endpoint europeo. Configure cuotas locales mediante `CNIE_OCR_DAILY_LIMIT` y `CNIE_OCR_MONTHLY_LIMIT` y cuotas del proveedor. No se incluyen credenciales de ejemplo funcionales ni claves en Git. Las obligaciones de tratamiento, contratación y conservación deben decidirse antes de clientes; el endpoint UE no es por sí solo una certificación de cumplimiento.

## 16. Operación y soporte

Al inicio compruebe versión, disponibilidad OCR y dirección móvil. Durante el trabajo corrija datos visibles, no utilice confianza OCR como sustituto de lectura, vigile la caducidad y libere imágenes innecesarias. Al cierre decida si reanudar trabajo cifrado o limpiar sesión; asegure los Word conforme a la política documental del despacho.

### 16.1 Incidencias habituales

- Cámara no disponible: HTTPS/CA, permiso, IP, reloj, firewall y aislamiento Wi-Fi; no habilitar HTTP como atajo.
- `PAIRING_EXPIRED` o `SESSION_EXPIRED`: generar nuevo QR; el usado no se reutiliza.
- OCR no configurado/proveedor indisponible/límite alcanzado: revisar configuración o cuota; reintentar solo si se ofrece y no supera tres intentos.
- Modelo/caras incompatibles: nueva CNIE con perfil correcto o repetir cara; no aprobar ignorando el conflicto.
- Revisión obsoleta: recargar recurso; no forzar sobrescritura.
- Campo bloqueado: esperar liberación/caducidad o terminar edición del otro dispositivo.
- Identidad caducada: nueva aprobación/captura y reasignación; no prolongar TTL manualmente en la base.
- Capacidad de valor excedida: abreviar legítimamente o completar en Word; no reducir automáticamente la fuente ni saltar validación.
- Plantilla manipulada: detener generación y reparar desde paquete íntegro.
- Persistencia corrupta/no descifrable: preservar evidencia protegida y consultar TI; no borrar silenciosamente para mostrar un puesto vacío.
- Guardado cancelado: solicitud/expediente permanece disponible.
- Archivo guardado pero no abierto: usar Explorador y corregir asociación.
- Guardado confirmado pero cierre pendiente: recuperación del recibo, no segunda generación.

### 16.2 Información de soporte permitida

Versión, API, código público, etapa, estado técnico y métricas agregadas. No solicitar tokens, claves, OCR completo, bases descifradas o capturas reales por canales no aprobados. Diagnósticos y exportaciones explícitas pueden contener datos sensibles; el operador y TI deben controlarlos.

## 17. API y contratos

La [Referencia API](PHASE1_API.md) enumera rutas, superficies autorizadas, idempotencia, revisión, encabezados y ejemplos sintéticos. La API es local al puesto, no una API SaaS pública. El motor alpha.3 devuelve `status: ok`, `version: 0.8.0-alpha.3`, `api_version: 2` y el estado técnico de OCR/mantenimiento en `/api/health`. El puesto instalado conserva alpha.2 hasta su actualización.

Los contratos CNIE permanecen separados e intactos. El formulario de plantilla es v2, la instantánea temporal v1 y los recibos v1. API 2 exige contexto de asignación para parches jurídicos vinculados a personas. No se modifica un contrato silenciosamente para simplificar UI.

## 18. Desarrollo, construcción y publicación

### 18.1 Desarrollo

Requisitos del repositorio: Python `>=3.11,<3.14`, Node 22+, pnpm 9.15.9, Rust y herramientas Windows para Tauri. El lockfile JS/Cargo fija resoluciones; las dependencias Python se declaran en rangos y no equivalen todavía a un lock de publicación completamente reproducible.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[capture,dev]" pyinstaller
pnpm install
pnpm build
.\scripts\start-workspace.ps1
```

La UI web de desarrollo no reemplaza la verificación del diálogo nativo. Para Tauri use `pnpm desktop`. Los CLI `cnie-rectifier`, `cnie-ocr` y `cnie-capture` permiten inspección, benchmark y configuración LAN; sus entradas con PII viven fuera de Git.

### 18.2 Compilación preliminar

```powershell
pnpm build
.\scripts\build-sidecar.ps1
pnpm desktop:build
```

PyInstaller empaqueta interfaces, modelo y plantillas en `apps/desktop/src-tauri/binaries/cnie-capture`. El script verifica recursos y hashes antes/después; no ejecutar builds web paralelos durante su empaquetado. Tauri produce el setup bajo `apps/desktop/src-tauri/target/release/bundle/nsis`.

Si C: no tiene espacio, limite los cambios al proceso y coloque TEMP/TMP en un directorio de build de D:. No borre datos del usuario para compilar. Un binario suelto actualizado en el puesto no convierte un instalador anterior en un paquete nuevo.

### 18.3 Publicación comercial

`scripts/build-release.ps1` exige certificado Authenticode de organización y timestamp RFC 3161, ejecuta verificaciones, construye y firma sidecar, app e instalador, y exige firmas válidas del firmante previsto. Sin certificado no existe una release comercial firmada.

La actualización se instala sobre la versión previa sin desinstalar, conservando configuración. El actualizador remoto firmado todavía no está implementado. Consulte [Publicación](RELEASE_WINDOWS.md), [Actualizaciones](UPDATES.md) y [QA Windows](WINDOWS_INSTALLATION_QA.md).

## 19. Evidencia y cierre de Fase 1

### 19.1 Evidencia disponible

Las suites existentes cubren rectificación, OCR, extracción, almacenamiento, perfiles, plantillas, API, roles, aislamiento, concurrencia y recuperación. La última corrección de fechas pasó 39 pruebas focalizadas de documentos, casos y relaciones. Se verificaron los tipos y builds de interfaces y se construyó el sidecar con 50 recursos web/plantillas comprobados.

Fixtures sintéticos mínimos/máximos se abrieron en Word y sus páginas completas se inspeccionaron: matrimonio mínimo/máximo en una página, herencia mínima en una y máxima en dos; `p1` inicial y `p2` solo en continuación. Se verificaron controles editables y documentos sin protección. Tras las correcciones se renderizaron de nuevo los dos casos completos con fechas occidentales `AAAA/MM/DD`, sin cortes ni solapes.

El renderer estándar de QA `render_docx.py` se intentó, pero no había `soffice.exe` en el runtime. Se documenta la alternativa realmente ejecutada: Word en lectura/exportación a PDF y Poppler para rasterizar. No se afirma que LibreOffice pasara una prueba que no pudo ejecutarse.

Se probó API PC–móvil con datos sintéticos, aislamiento y rechazo 403 de generar/completar/reabrir desde móvil. La evidencia móvil incluye recuperación y formularios a 360, 390 y 430 px, no todos los teléfonos físicos ni todas las cámaras.

### 19.2 Estado real del puesto y del instalador

En este puesto se actualizó `0.7.2 → 0.8.0-alpha.1` y después se instaló `0.8.0-alpha.2` en `D:\e-notario`. Se comprobaron acceso directo, versión, arranque, plantillas y conservación de credencial, perfiles, red y certificados. Existe copia preventiva bajo `build/install-backups`; es evidencia local recuperable, no un recurso distribuible.

Después de crear el setup alpha.2 se corrigió dos veces el formato de fechas según decisión del producto. El sidecar reconstruido final se copió al puesto y se comprobó SHA-256 contra el origen y salud API 2. Por ello, **el puesto instalado contiene `AAAA/MM/DD`, pero el setup alpha.2 anterior no acredita esos cambios finales**. Antes de distribuir se debe reconstruir el instalador completo, verificar sus recursos y registrar su hash; no entregar el setup previo como si fuera idéntico.

Los kits Sandbox están preparados pero no ejecutados: este puesto no tiene Sandbox disponible. No se eludió la protección del runner. La actualización real de un puesto no sustituye instalación limpia, reparación ni prueba en cuenta estándar.

### 19.3 Significado del cierre

El cierre aceptado corresponde a la base local y a las funcionalidades implementadas. Se conserva `alpha.2` y se transfieren a industrialización las validaciones externas y discrepancias enumeradas. No se declara una firma, dictamen jurídico, prueba manual o corpus representativo por el simple hecho de cerrar esta fase.

### 19.4 Revisión posterior de OpenCV/OCR

Después de esta consolidación se ejecutaron 69 pruebas específicas de rectificación, geometría, decodificación, modelo, OCR, captura y extracción; todas pasaron. Reproducciones sintéticas adicionales confirmaron tres defectos no cubiertos: un fallo de persistencia termina la tarea de la cola OCR, el modo híbrido acepta una captura muy desenfocada porque no hay gate de nitidez, y el contador OCR interpreta un archivo corrupto/no legible como consumo cero. No se modificó código ni se enviaron imágenes a Google en ese diagnóstico.

Los tres estaban pendientes en el traspaso inicial del 18 de septiembre. En el saneamiento posterior se corrigieron la cola OCR y el contador; se añadió medición de nitidez sobre tarjeta y un gate configurable, todavía sin umbral de producción calibrado. Origen, resultados y propuestas de resolución se registran en el [dossier de Fase 2](PHASE2_HANDOFF.md). Esta adenda corrige las afirmaciones sobre legibilidad y evita confundir pruebas normales correctas con ausencia de fallos.

## 20. Pendientes trazables antes de clientes

La lista siguiente conserva el inventario de cierre alpha.2. El estado actualizado, con las correcciones realizadas y los gates todavía abiertos, está en [Saneamiento de Fase 1](SANEAMIENTO_FASE1.md). No interpretar los puntos ya corregidos como defectos vigentes.

1. Reconstruir setup con el sidecar final `AAAA/MM/DD`, validar instalación/actualización/reparación y registrar hashes.
2. Firma de producción de organización, canal de distribución y matriz Windows/Word soportada.
3. Corpus autorizado representativo de CNIE antigua/moderna, negativos y estados de conservación; benchmark sellado por identidad.
4. Aprobación jurídica del texto y render final de cada modelo y autorización de uso de sus recursos visuales.
5. Flujo físico de operador: cámara móvil, confirmación, cancelación, guardado, fallo de asociación y edición/guardado manual en Word.
6. Corregir o aceptar explícitamente que los testigos de herencia no declaran caducidad en el manifiesto actual.
7. Homogeneizar la versión Python del paquete, que todavía declara `0.8.0a1` en `pyproject.toml`, con la app/API `0.8.0-alpha.2` antes de publicación; no se cambió como parte de esta tarea documental.
8. Política empresarial de tratamiento, backups, soporte, incidentes y autorización de dispositivos, con responsables y evidencia, no solo recomendaciones de desarrollo.
9. Resolver los tres defectos posteriores de OpenCV/OCR y comprobar los fallos/reintentos correspondientes antes de tratar la base como operativamente robusta para clientes.

Esta lista limita las afirmaciones comerciales; no invalida el cierre funcional acordado. Los documentos históricos de QA mantienen sus fechas y hashes como evidencia histórica, no aprobación vigente.

## 21. Continuidad hacia SaaS híbrido

La dirección aceptada es SaaS híbrido: conservar el procesamiento sensible local y añadir una capa remota de control. Es una decisión de producto, no una infraestructura ya entregada. El detalle de las Fases 2 y 3 debe acordarse en planes independientes.

La próxima fase deberá definir organización/despacho, usuarios y dispositivos, permisos, activación/licencia, canal de actualización, gestión de versiones de plantillas, observabilidad sin PII y operación del servicio. No se subirán CNIE, OCR o Word por defecto para construir esa capa. Facturación, catálogo ampliado y escalado comercial deberán tener criterios de aceptación propios.

La base de Fase 1 aporta dominios separados y contratos fijados. No implica multiempresa por añadir un identificador al workspace ni garantiza escalabilidad empresarial sin aislamiento, autenticación y pruebas específicas.

La continuidad entre chats se prepara en [Traspaso a Fase 2](PHASE2_HANDOFF.md), con decisiones aceptadas, preguntas todavía abiertas, estado del árbol Git y un mensaje de inicio. Es contexto de planificación, no autorización de implementación automática.

## 22. Mantenimiento de la documentación

Actualizar esta referencia y las guías especializadas cuando cambien retención, permisos, campos, fechas, plantillas o recuperación. Las referencias 0.6.1 y 0.7.0 se conservan como históricas, no se reescriben para fingir que tenían las funciones actuales.

No publicar artefactos QA personales, copias de configuración, credenciales, TLS privadas o bases de datos en Git. Una nueva plantilla exige revisión de texto, hash, versión y render. Un cierre de fase o aprobación de producción debe declarar qué evidencia se obtuvo, qué entorno se utilizó y qué queda pendiente.

## 23. Referencias

- [Índice documental](README.md).
- [Arquitectura de Fase 1](PHASE1_ARCHITECTURE.md).
- [API de Fase 1](PHASE1_API.md).
- [Captura](CAPTURE_PROTOCOL.md), [benchmark](BENCHMARK.md) y [extracción](STRUCTURED_EXTRACTION.md).
- [CNIE antigua](CNIE_LEGACY.md) y [Vision](GOOGLE_VISION_SETUP.md).
- [Plantillas DOCX](DOCX_TEMPLATES.md).
- [Windows/móvil](WINDOWS_MOBILE_SETUP.md), [actualizaciones](UPDATES.md), [publicación](RELEASE_WINDOWS.md) y [QA instalación](WINDOWS_INSTALLATION_QA.md).
- [Changelog](../CHANGELOG.md), [modelo](../models/README.md) y [terceros](../THIRD_PARTY_NOTICES.md).
