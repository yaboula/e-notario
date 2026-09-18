# e-notario 0.7.0 — Documentación integral

## Alcance

La versión 0.7.0 amplía el núcleo 0.6.1 con generación profesional de documentos Word. El contrato de extracción `cnie.ma.2020/v2` no cambia. Los 14 valores revisados se copian a una `ApprovedIdentity` temporal e inmutable y el módulo independiente `cnie_documents` los enlaza con controles de contenido OOXML.

Se entregan dos pilotos. Matrimonio usa `husband` 1, `wife` 1 y `wife_father` 1; la madre no constituye un rol separado. Herencia usa `applicant` 0–1, `heir` 1–12 y `witness` 0–12; el causante permanece manual. Los datos registrales, notarios, fechas jurídicas y demás extremos no procedentes de CNIE también permanecen manuales. e-notario no traduce, translitera ni infiere valores.

Cada persona automática se redacta en una frase árabe completa: nombre, filiación, fecha y lugar de nacimiento, CIN y domicilio. `filiation_ar` se consume exactamente como llega aprobado —incluido el enlace `و` entre progenitores— y nunca se divide ni se vuelve a unir artificialmente. El género CNIE selecciona de forma determinista `السيد/السيدة`, `ابن/بنت`, `المزداد/المزدادة`, `الحامل/الحاملة` y `الساكن/الساكنة`. La falta de cualquiera de estos valores bloquea la generación.

## Arquitectura y ciclo de vida

El sidecar FastAPI conserva en memoria capturas, documentos, identidades y solicitudes. Aprobar una extracción crea una identidad con propietario, revisión, origen y caducidad. Puede haber hasta 64 identidades y 64 solicitudes. Todo se elimina al cerrar el motor.

Una cara que supera la comprobación local de geometría y calidad se marca `accepted` automáticamente en el mismo `POST /api/captures` y entra en la cola OCR sin pulsación adicional. Una cara rechazada queda en `retake` y no se envía al proveedor. La automatización solo afecta a la imagen: los 14 datos siguen exigiendo revisión y aprobación explícitas. El operador puede repetir una cara y sustituirla; la sustitución invalida la revisión y la identidad anteriores.

La acción confirmada «Conservar identidad y liberar imágenes» borra original, rectificada, OCR y evidencias, retira el documento de captura y conserva la ficha hasta completar sus 60 minutos. Sustituir una cara elimina la identidad asociada. Caducar o eliminar una identidad retira automáticamente todas las solicitudes que la usan.

Las plantillas se cargan al iniciar. Su integridad y estructura se validan antes de aceptar tráfico. La generación abre el ZIP DOCX, modifica únicamente controles declarados con `lxml`, sanea metadatos y vuelve a empaquetar. Producción no depende de Word, COM o LibreOffice.

## Contratos HTTP

- `GET /api/document-templates`: catálogo disponible para Windows y móvil autenticado.
- `POST /api/documents/{id}/release-images`: Windows o móvil propietario; irreversible.
- `POST /api/document-generation-requests`: crea una solicitud fijada a plantilla y versión; exige `Idempotency-Key` UUID.
- `PATCH /api/document-generation-requests/{id}`: reemplaza asignaciones con revisión optimista e idempotencia.
- `DELETE /api/document-generation-requests/{id}`: retira una solicitud con idempotencia.
- `POST /api/document-generation-requests/{id}/generate`: exclusivo de Windows; devuelve DOCX con `Cache-Control: no-store`.

`Workspace` publica `approved_identities` y `document_generation_requests`. Windows obtiene la vista global. Un móvil solo obtiene sus identidades y solicitudes; si Windows incorpora a una solicitud móvil una identidad de otro propietario, su identificador también se filtra de la respuesta móvil.

## Interfaces

El recorrido principal es captura de ambas caras → confirmación de los 14 datos → preparación Word. El OCR árabe y el texto completo no son pantallas de trabajo; el OCR permanece interno para extraer campos. El formulario conserva accesos a las imágenes rectificadas de anverso y reverso. Un error de lectura se muestra como estado de atención, con reintento por cara en Windows o nueva fotografía.

Tras aprobar, Windows y móvil muestran una tarjeta de entrada con dos modos. **Relleno parcial** está disponible y usa solo identidades CNIE aprobadas; los demás huecos se editarán en Word. **Relleno completo** se presenta desactivado y no envía ninguna operación: una versión futura incorporará formularios y validación de los campos hoy manuales. Estos modos son una decisión de interfaz; el contrato de generación 0.7.0 solo implementa relleno parcial.

El móvil entra en la preparación parcial desde la revisión aprobada, sin un diálogo superpuesto. Permite escoger plantilla, asignar únicamente identidades propias y enviar la solicitud. También presenta la confirmación irreversible para liberar imágenes. Si las imágenes ya se liberaron, salir de preparación vuelve a captura en vez de abrir una revisión eliminada; la pantalla inicial conserva una entrada Word para identidades aprobadas aún vigentes. Nunca descarga el DOCX.

Windows sitúa el centro «Documentos Word» inmediatamente después de la revisión, antes del listado secundario de CNIE. La composición parcial se despliega al seleccionarla; la bandeja conserva solicitudes procedentes de móvil o escritorio, revisión/corrección de asignaciones y advertencia cuando una identidad ocupa roles diferentes. «Guardar y abrir en Word» genera el archivo, muestra el diálogo nativo, escribe mediante un temporal en el directorio final y abre la ruta con la aplicación asociada. Cancelar mantiene la solicitud. Un guardado correcto la elimina; un fallo de apertura conserva el archivo y ofrece mostrarlo en el Explorador.

El nombre predeterminado usa solo slug y fecha (`matrimonio-AAAAMMDD-HHMMSS.docx`), sin PII. Después del guardado el documento vive fuera de e-notario y no existe sincronización de retorno.

## Seguridad y privacidad

Los manifiestos y DOCX están empaquetados e inmutables. Se rechazan macros, ActiveX, OLE, relaciones externas, comentarios, cambios pendientes, etiquetas desconocidas y duplicados. La salida se limita a 25 MiB y contiene únicamente valores aprobados: nunca imágenes, OCR completo, valores brutos, polígonos, tokens o rutas internas.

Los controles automáticos usan etiquetas explícitas, son editables y visualmente ocultos. Las propiedades personales de autor y máquina se vacían; las únicas propiedades propias son versión de plantilla y versión del generador. Las respuestas sensibles usan `no-store` y los errores públicos no incluyen PII.

## Diseño documental

Ambos modelos usan A4, Arial en el cuerpo, párrafos RTL nativos, jerarquía formal y tamaño legible. El encabezado se organiza en tres zonas con el escudo de Marruecos embebido entre los datos de la المحكمة الابتدائية y los de المملكة المغربية. La aleya matrimonial exacta conserva su primera posición y usa Amiri Quran 1.003 embebida en el DOCX.

La estructura jurídica procede de los `.doc` originales y no se sustituye por fichas ni tablas. Matrimonio mantiene un único párrafo y rellena esposo, esposa y padre de la esposa en sus huecos jurídicos. Herencia mantiene el causante como control manual: los herederos se insertan después de `فأحاط بإرثه` y los doce testigos siguen inmediatamente a `شهد بذلك السادة`, sin el rótulo añadido `الورثة`. La única tabla del cuerpo visual carece de bordes y sirve exclusivamente para estabilizar el encabezado. Los modelos vacíos conservan una página; el contenido generado puede continuar de forma natural sin reducir artificialmente la fuente.

Los dos modelos incorporan marco ornamental repetido, escudo oficial embebido, marca de agua tenue, jerarquía verde y oro, separadores y pie institucional. Matrimonio añade el panel de la aleya y pie bilingüe; herencia usa marco verde, pie árabe y un encabezado compacto en las páginas de continuación. Todo el texto jurídico continúa siendo texto Word nativo y editable: ninguna página se rasteriza como imagen.

El texto jurídico normalizado se conserva junto a cada plantilla y queda protegido por SHA-256. La guía [DOCX_TEMPLATES.md](DOCX_TEMPLATES.md) documenta evolución y QA. Antes de producción, una persona jurídicamente responsable debe aprobar el texto y el render final en Microsoft Word.

## Verificación

La suite cubre manifiestos, hashes, controles ocultos, cardinalidades, fecha `dd/MM/yyyy`, árabe, multilinealidad, regiones manuales intactas, integridad ZIP, metadatos, 12 herederos y 12 testigos, aislamiento móvil, idempotencia, revisión obsoleta, liberación de imágenes y generación Windows. La publicación exige además renderizar fixtures sintéticos y revisar visualmente todas las páginas.
