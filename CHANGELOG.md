# Changelog

## 0.8.0-alpha.3 — Saneamiento de la base local, 2026-09-18

- Recupera la cola OCR y el mantenimiento ante fallos de persistencia con espera progresiva de 1 a 30 segundos; conserva resultados pendientes sin repetir la llamada al proveedor y descarta capturas sustituidas antes de enviar.
- No anuncia ni entrega un resultado OCR pendiente de persistir. Expone salud de las tareas y fallo de almacenamiento, con aviso visible en Windows.
- Distingue un contador OCR inexistente de un archivo corrupto o ilegible; los errores de lectura/escritura bloquean el envío con códigos propios, sin reiniciar consumo. Escritura atómica con archivo único y flush/fsync.
- Publica herencia `1.5.1` con validez CNIE para los doce testigos, conservando `1.5.0` intacta para expedientes existentes.
- Mide nitidez sobre el interior de la tarjeta rectificada a tamaño fijo, sin fondo ni borde, y permite configurar un gate calibrado. Permanece desactivado por defecto hasta disponer de corpus autorizado representativo; no se declara resuelto el rechazo automático de desenfoque.
- Homogeneiza versión Python `0.8.0a3`, aplicación/motor `0.8.0-alpha.3` y metadatos DOCX; conserva API 2 y los contratos CNIE.

## 0.8.0-alpha.2 — Correcciones de generación documental, 2026-09-17

- Consolida la documentación integral de cierre funcional de Fase 1 y la referencia API 2, con flujos, almacenamiento, permisos, concurrencia, Word, operación y evidencia real de QA.
- Actualiza las guías vigentes de extracción, móvil y plantillas; separa la retención cifrada de 24 horas del comportamiento histórico y registra el formato final `AAAA/MM/DD`.
- Documenta los límites de distribución: reconstruir setup tras los hotfixes del motor, completar validaciones externas y resolver la caducidad no declarada para testigos de herencia. El cierre funcional no convierte automáticamente la alfa en release comercial estable.

- Separa de forma segura el contenido de los controles Word y el texto jurídico contiguo, evitando palabras pegadas en el relleno completo y parcial.
- Evita duplicar `بنت` o `ابن` cuando la filiación OCR de una CNIE antigua ya incluye ese prefijo.
- Añade la fecha de validez de la CNIE después de su número en matrimonio y en solicitante/herederos de herencia; representa las fechas insertadas como `AAAA/MM/DD` con cifras occidentales. El patrón de testigos de herencia aún no declara esa fecha de validez.
- Permite seleccionar un perfil profesional frecuente o escribir directamente un nombre de uso puntual, sin añadirlo al catálogo persistente.
- Convierte las cardinalidades mínimas de las plantillas actuales en cero y conserva los campos recomendados como avisos no bloqueantes.
- Presenta `صلة الإرث` como relación individual con el causante, vinculada visualmente a cada heredero e insertada con una etiqueta explícita en Word.
- Publica matrimonio `1.7.0` y herencia `1.5.0`, conservando las versiones anteriores para expedientes ya fijados.

## 0.8.0-alpha.1 — Fase 1, 2026-09-16

- Añade expedientes de relleno completo fijados a una versión de plantilla, con revisión final y confirmación expresa de campos jurídicos ausentes.
- Persiste expedientes, capturas, OCR, identidades y cola recuperable en almacenes SQLite cifrados con AES-256-GCM y claves protegidas mediante Windows DPAPI; la retención máxima pasa a 24 horas.
- Incorpora perfiles profesionales protegidos y reutilizables para los comparecientes institucionales de las plantillas.
- Completa su gestión antes o durante el expediente: creación, edición, activación y borrado en dos pasos; impide desactivar o borrar perfiles todavía referenciados y muestra su uso. El catálogo se escribe de forma atómica y revierte también en memoria ante cualquier fallo de persistencia.
- Sincroniza los perfiles activos con el móvil en tiempo real y mantiene visible una referencia inactiva histórica para que el operador pueda sustituirla explícitamente.
- Asigna a cada creación de perfil un UUID estable conservado hasta confirmar la respuesta; un reintento, incluso después de reiniciar, recupera el mismo recurso y evita duplicados.
- Reconoce de forma idempotente el reintento exacto de una edición de perfil cuya respuesta se perdió y sigue rechazando contenido distinto sobre una revisión antigua.
- Unifica las acciones de relleno completo y gestión de perfiles en español en Windows y móvil, conservando las etiquetas jurídicas árabe/francés de los manifiestos. Advierte de expedientes sin finalizar antes de crear otro y mantiene el indicador obligatorio dentro de su etiqueta.
- Dimensiona los controles de documentos con `border-box` para evitar solapes entre columnas y distingue explícitamente éxito, cancelación y archivo guardado con fallo de apertura, sin deducir el estado a partir del texto del aviso.
- Permite preparar el expediente completo desde móvil sin exponer el DOCX y generarlo únicamente en Windows.
- Restringe también en la API la reapertura de expedientes en revisión final o completados a Windows; comprueba el flujo móvil → DOCX con tres personas en matrimonio y con 25 personas en herencia, sin confundir generación con guardado nativo.
- Recupera desde el móvil los expedientes propios aunque no quede una identidad aprobada; añade selección explícita, guardado previo al cambiar o salir, identificador estable y aviso de roles incompletos antes de la revisión final. La creación conserva su clave de idempotencia ante una respuesta perdida y los avisos de éxito no dependen de palabras del mensaje.
- Descarta las respuestas de colaboración de editores cerrados o sustituidos y libera un bloqueo concedido después del cierre, incluso al reabrir el mismo expediente. Unifica también la pantalla de vinculación móvil en español.
- Coordina HTTP local y HTTPS LAN bajo un único ciclo de vida y cierre: evita dos trabajadores OCR y dos cierres sobre la misma memoria, así como la sobrescritura de la instantánea recuperable con un estado vacío. Detiene ambos listeners ante la misma señal y garantiza limpieza también ante una salida excepcional.
- Añade bloqueos temporales por campo, guardado atómico y actualización en tiempo real para evitar sobrescrituras entre Windows y móvil.
- Serializa la liberación de cada bloqueo entre pérdida de foco y guardado explícito; una nueva adquisición espera a la liberación pendiente y el cierre de edición espera las adquisiciones en curso, evitando dobles liberaciones y bloqueos rezagados con respuestas lentas.
- Sustituye las listas de selección múltiple de herederos y testigos por un selector compartido con búsqueda árabe/latina, casillas, orden numerado y límite visible. Conserva el bloqueo del rol al mover el foco entre sus controles.
- Publica herencia 1.4.1 con vínculo explícito entre heredero y relación sucesoria; conserva 1.4.0 para expedientes existentes y mantiene los valores por identidad al añadir, retirar, ordenar o editar concurrentemente.
- Eleva el contrato local de interfaz–motor a API 2 para rechazar instalaciones mezcladas que no puedan proteger campos jurídicos vinculados a personas.
- Añade borrado criptográfico desde «Limpiar sesión», conservando plantillas, configuración y perfiles profesionales.
- Publica el contrato de plantillas `enotario.document-template/v2` y mantiene compatibilidad con el relleno parcial v1.
- Añade recibos DPAPI de guardado para ambos modos, recuperación tras reinicio sin regenerar el Word, comprobación de hash ante una interrupción y cierre idempotente vinculado a la revisión generada. Limpiar sesión retira los recibos sin eliminar los DOCX del operador.
- Rechaza solicitudes modificadas durante el renderizado y expone sus revisiones en el contrato DOCX; los reintentos idempotentes vuelven a confirmar la persistencia antes de responder correctamente tras un fallo de almacenamiento.
- Condiciona la publicación firmada a las suites Python, UI, tipos y pruebas nativas; verifica los recursos empaquetados y busca el compilador de recursos del Windows SDK.
- Añade kits de QA por escenario para instalar en Windows Sandbox sin tocar el puesto del desarrollador: comprueba versión, hashes de todos los recursos, actualización desde 0.7.2, conservación de configuración sintética y recuperación de perfil/expediente tras reparación. La preparación y las pruebas de seguridad del runner no se presentan como instalación funcional ya aprobada.
- Verifica en Microsoft Word los cuatro fixtures DOCX sintéticos: cinco páginas inspeccionadas, uso correcto de `p1`/`p2`, matrimonio en una página, herencia máxima en dos y todos los controles desbloqueados; la edición manual y aprobación jurídica permanecen pendientes.

## 0.7.2 — selección profesional de modelo, 2026-09-15

- Presenta «CNIE 2020» inicialmente y «CNIE antigua» como opción explícita antes de capturar en Windows y móvil.
- Fija el modelo para las dos caras, rechaza cambios a mitad del documento y contrasta el perfil extraído con la selección antes de permitir la revisión.
- Muestra errores específicos para elección incompatible y caras mezcladas; no crea una identidad aprobada en esos casos.
- Mantiene la detección automática como control y conserva intacto el contrato exportado `cnie.ma.2020/v2`.

## 0.7.1 — piloto local, 2026-09-15

- Añade el extractor `CNIE_MA_LEGACY` sin modificar la geometría ni el contrato `cnie.ma.2020/v2`.
- Clasifica las dos caras de forma conservadora y rechaza mezclas de generaciones; propone los 14 valores y contrasta el CIN visual con el del reverso.
- Exporta fichas antiguas bajo `cnie.ma.legacy/v1` y conserva el perfil de origen en la identidad temporal.
- Excluye código de barras, número de estado civil y fondos de seguridad. La revisión humana y los enlaces DOCX permanecen obligatorios.
- Añade pruebas sintéticas y una QA controlada con Vision UE que no registra imágenes ni valores personales. Falta una muestra diversa de tarjetas antiguas antes de distribución empresarial.

## 0.7.0 — 2026-09-14

- Añade `cnie_documents`, un motor OOXML independiente con catálogo inmutable, validación de seguridad, enlaces deterministas y límite de salida de 25 MiB.
- Incorpora plantillas A4 RTL de matrimonio y herencia, esta última con 12 herederos y 12 testigos preautorizados.
- Amplía cada persona automática con nombre, filiación indivisible, nacimiento, CIN y domicilio; matrimonio exige esposo, esposa y padre de la esposa, mientras el causante de herencia permanece manual.
- Restaura la secuencia de los `.doc` jurídicos originales, retira las tablas de identidad y corrige herencia para situar herederos tras `فأحاط بإرثه` y testigos tras `شهد بذلك السادة`.
- Rediseña el documento con marco ornamental, paleta verde y oro, escudo embebido, marca de agua, encabezado institucional, separadores y pies oficiales; la aleya matrimonial recibe jerarquía propia.
- Compone la aleya matrimonial exacta en Amiri Quran 1.003, con signos coránicos conservados y fuente OFL embebida en el DOCX para Word sin instalación adicional.
- Crea identidades aprobadas temporales y la acción irreversible para conservar sus 14 valores mientras se liberan imágenes, OCR y evidencias.
- Añade solicitudes versionadas con idempotencia, revisión optimista, cardinalidades e aislamiento por propietario.
- Permite preparar solicitudes desde móvil y revisarlas, guardarlas atómicamente y abrirlas con Word desde Windows.
- Verifica hashes, controles, transformaciones, metadatos, seguridad OOXML y capacidad máxima mediante pruebas automáticas.
- Simplifica el recorrido CNIE → datos → Word: las caras válidas se aceptan automáticamente tras la comprobación local, las vistas de OCR crudo salen del flujo y la preparación parcial aparece inmediatamente después de aprobar. El relleno completo se anuncia como futuro y permanece inaccesible.

## 0.6.1 — 2026-09-14

- Corrige la extracción de sexo: solo admite un marcador `M/F` alineado con la etiqueta impresa y evita confundir elementos gráficos alejados.
- Presenta el sexo como selector explícito `F/M` para una corrección humana inequívoca.
- Equilibra la aceptación de capturas de oficina con tolerancia moderada de luz y bordes, conservando los controles duros de geometría, tamaño, legibilidad y falsos rectángulos.
- Sustituye la confirmación campo a campo por acciones completas por categoría y por una aprobación global de los 14 campos.
- Conserva listas multilínea de filiación y domicilio durante la revisión masiva.
- Evita la recarga periódica del visor de anverso/reverso y mantiene sincronizada la revisión entre Windows y el móvil propietario.

## 0.6.0 — 2026-09-14

- Reduce la revisión estructurada a 14 campos y publica el contrato `cnie.ma.2020/v2`.
- Retira de extracción, validación y exportación autoridad emisora, CAN, acta civil, mención opcional y MRZ.
- Sustituye el panel de evidencia por un formulario Windows de ancho completo con visor de caras y confirmación por sección.
- Permite que el móvil propietario revise y apruebe su CNIE sin exponer OCR completo, diagnósticos ni exportación.
- Registra en memoria el origen y la fecha de cada revisión y protege ediciones simultáneas mediante revisiones optimistas.
- Sincroniza confirmaciones y aprobación entre móvil y Windows por eventos, con refresco de respaldo y conservación de borradores no guardados.

## 0.5.1 — 2026-09-14

- Evita mezclar campos vecinos mediante líneas de lectura y regiones conservadoras.
- Conserva los saltos de línea de filiación y domicilio y contrasta los nombres con la MRZ.
- Mantiene incompleta una línea MRZ de 29 caracteres y bloquea la aprobación hasta su revisión.
- Actualiza los controles MRZ mostrados después de una corrección humana.

## 0.5.0 — 2026-09-14

- Añade extracción estructurada local y determinista para la CNIE marroquí de 2020.
- Valida la MRZ TD1, sus dígitos de control y la coherencia de CIN, nacimiento, sexo y caducidad.
- Incorpora revisión humana campo por campo, correcciones versionadas y exportación JSON aprobada.
- Mantiene imágenes, OCR, datos y correcciones exclusivamente en memoria durante 60 minutos.
- Impide que las sesiones móviles consulten texto OCR, campos extraídos o exportaciones.
- Conserva sin cambios la captura, rectificación y comunicación europea con Google Vision.
- Ajusta la plantilla geométrica a las cajas reales de Vision para evitar mezclar nombres,
  fechas, domicilio, filiación, CAN y acta; reconstruye la MRZ desde sus palabras y
  recupera únicamente un dígito compuesto cuando el checksum lo determina sin ambigüedad.

## 0.4.0 — 2026-09-14

- Añade OCR árabe/francés con Google Cloud Vision mediante el endpoint europeo y solo después de la aceptación humana.
- Agrupa anverso y reverso en una sola CNIE, con cola asíncrona y resultados temporales durante 60 minutos.
- Protege la cuenta de servicio mediante Windows DPAPI y limita su administración a la estación Windows.
- Añade vistas de imagen, OCR árabe RTL, texto completo, geometría por palabra y exportación explícita UTF-8/JSON.
- Conserva sin cambios la captura y rectificación aceptadas en la Fase 1.

## 0.3.2 — 2026-09-14

- Restaura la captura móvil probada en 0.2.1: fotograma completo, sin recorte, zoom ni selector efectivo.
- Conserva la detección automática de la estación y la actualización Windows en sitio.

## 0.3.1 — 2026-09-14

- Convierte el marco del escáner móvil en el selector real del archivo enviado.
- Solicita la máxima resolución fotográfica que expone la cámara y elimina el zoom variable.
- Recorta en coordenadas nativas sin reescalar y conserva un margen técnico para no cortar esquinas.
- Muestra antes del envío el recorte exacto junto con sus dimensiones nativas y útiles.

## 0.3.0 — 2026-09-14

- Captura fotografías nativas del sensor mediante `ImageCapture` cuando el móvil lo permite.
- Añade zoom real de cámara con valor inicial 1,5× y evita diferencias entre vista previa y archivo enviado.
- Detecta automáticamente la dirección IPv4 privada de la estación y renueva el certificado de servidor cuando cambia.
- Conserva una configuración manual para equipos con varias redes o VPN.
- Formaliza las actualizaciones Windows sobre la instalación existente, sin desinstalación previa.

## 0.2.1 — 2026-09-14

- Corrige el falso rechazo de CNIE horizontales capturadas en encuadres verticales.
- Combina evidencia de bordes en luminancia y color con la máscara y los heatmaps de DocQuadNet.
- Rechaza de forma conservadora escenas ambiguas con varios rectángulos.
- Corrige la conversión de coordenadas al refinar cuadriláteros en imágenes reducidas.
- Añade códigos de recaptura accionables y pruebas de regresión sin datos personales.
