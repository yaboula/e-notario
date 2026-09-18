# Fase 1 — arquitectura, seguridad y ciclo del expediente

Actualización del 18 de septiembre: consultar [Saneamiento de Fase 1](SANEAMIENTO_FASE1.md) para alpha.3, sus correcciones y evidencia vigente. Las evidencias alpha.1/alpha.2 siguientes mantienen su carácter histórico.

Estado documentado: `0.8.0-alpha.2`, 17 de septiembre de 2026.

Esta guía especializada complementa la [documentación integral de Fase 1](DOCUMENTACION_FASE1.md) y la [referencia API](PHASE1_API.md). El responsable del producto aceptó el cierre funcional local tras sus pruebas y correcciones. Se conserva la etiqueta alfa y no se dan por acreditados los gates externos de comercialización.

## Objetivo

La Fase 1 convierte el núcleo de captura en una estación local de producción para un único despacho. El flujo principal es continuo: capturar la CNIE, confirmar sus 14 valores, elegir una plantilla, completar los datos jurídicos, revisar y guardar el DOCX. El archivo final se edita posteriormente en Microsoft Word y no se sincroniza de vuelta.

Esta fase no es todavía el SaaS multiempresa. No incluye cuentas remotas, facturación, catálogo jurídico central ni almacenamiento de expedientes en la nube. Es la base local que debe estabilizarse antes de introducir aislamiento entre organizaciones.

## Límites de confianza

| Zona | Responsabilidad | Datos permitidos |
|---|---|---|
| Aplicación Windows | Control del expediente, OCR, extracción, revisión, perfiles, DOCX y borrado | Todos los datos temporales del puesto |
| Móvil autorizado | Captura y edición de los expedientes creados por su sesión | Solo capturas, identidades y expedientes propios; nunca DOCX ni identidades ajenas |
| Google Vision UE | OCR de una imagen rectificada aceptada | Imagen rectificada; no recibe plantillas, perfiles ni DOCX |
| Microsoft Word | Edición posterior al guardado | Únicamente el DOCX elegido por el operador |

La conexión móvil utiliza HTTPS en la LAN y un código QR de un solo uso. El token de escritorio no se entrega al móvil. Los endpoints de generación, configuración, perfiles y borrado global son exclusivos de Windows.

Los listeners HTTP local y HTTPS LAN comparten una sola aplicación y un único ciclo de vida coordinado por el proceso. Uvicorn tiene su gestión de lifespan desactivada para cada listener: el coordinador arranca una vez el mantenimiento y el trabajador OCR, detiene ambos servidores ante una señal de cierre y guarda una sola instantánea antes de limpiar la memoria. También restaura los manejadores de señales previos. La limpieza del lifespan se ejecuta en `finally` y espera la cancelación de los trabajadores; una salida excepcional no omite la persistencia final ni la limpieza de memoria. Esto evita que un segundo cierre sobre memoria ya vacía destruya la copia recuperable.

## Almacenamiento temporal cifrado

Hay cuatro almacenes separados:

1. `temporary-cases.sqlite3`: un registro por expediente, con una clave AES-256-GCM distinta por expediente. La clave de datos se envuelve mediante DPAPI del usuario actual de Windows.
2. `temporary-workspace.sqlite3`: instantánea cifrada de capturas, rectificaciones, OCR, revisiones, identidades aprobadas, solicitudes parciales, sesiones móviles e idempotencia de captura. Permite reanudar y recuperar una cola OCR interrumpida.
3. `professional-profiles.dpapi`: catálogo persistente de perfiles profesionales. No es dato temporal y no se elimina al limpiar una sesión. Cada sustitución se escribe en un archivo temporal único, se fuerza al disco y se publica mediante reemplazo atómico. Si cifrado, escritura o reemplazo fallan, la mutación se revierte también en memoria y la API informa del fallo sin revelar rutas.
4. `saved-case-receipts.dpapi`: recibos temporales de guardado de ambos modos, protegidos con DPAPI del usuario actual. Contienen identificadores técnicos, revisión, ruta elegida, fechas, confirmación y hash del archivo; nunca valores CNIE ni bytes del documento. El discriminador `kind` distingue expedientes completos de solicitudes parciales; los recibos anteriores sin ese campo se leen como expedientes completos. Se mantiene el nombre del archivo y la clave de referencia v1 `case_id` para recuperar datos existentes. Expiran a las 24 horas y se retiran después del cierre confirmado o al limpiar la sesión. El DOCX guardado por el operador no se elimina.

SQLite solo conserva fuera del cifrado identificadores técnicos, revisiones y marcas temporales necesarias para expirar y ordenar registros. Los valores de CNIE, imágenes, texto OCR, tokens y campos jurídicos forman parte del contenido cifrado. La autenticación AES-GCM detecta cualquier manipulación.

La retención del expediente es de 24 horas desde su última modificación; las identidades aprobadas caducan a las 24 horas desde aprobación y no prolongan su vida al editar un expediente. «Conservar identidad y liberar imágenes» elimina original, rectificada, OCR y evidencias y mantiene cifrados solo los valores aprobados hasta esa caducidad. «Limpiar sesión» elimina registros, claves envueltas, sesiones, cola y memoria; conserva configuración, plantillas y perfiles profesionales.

Cada sustitución de la instantánea utiliza una nueva clave de datos. SQLite activa `secure_delete` y trunca su WAL después de retirar claves, evitando conservar una instantánea antigua descifrable con la clave vigente. Este borrado se refiere al almacén administrado por e-notario; no constituye una garantía de borrado forense de copias externas, backups del sistema o sectores históricos de un SSD.

## Modelo de expediente

Un `CaseDraft` fija `template_id`, `template_version` y modo (`partial` o `complete`) desde su creación. Sus estados son:

1. `editing`: Windows y el móvil propietario pueden modificar asignaciones y campos.
2. `final_review`: el contenido queda bloqueado; Windows comprueba faltantes y genera el DOCX.
3. `completed`: solo se alcanza después de que Tauri confirme un guardado correcto. Cancelar el diálogo conserva `final_review`.

Las actualizaciones globales usan revisión optimista e idempotencia; las transiciones de estado usan revisión y el cierre completo reconoce el reintento exacto ya completado. Para edición concurrente, cada campo jurídico y cada rol obtiene un arrendamiento efímero de 45 segundos. Otro dispositivo ve el campo bloqueado; campos diferentes se guardan mediante parches atómicos idempotentes sobre la revisión más reciente. El editor compartido guarda tras una pausa de escritura, renueva el arrendamiento cada 15 segundos mientras el campo tiene foco y lo libera al abandonarlo. La revisión final rechaza cualquier editor activo. Un fallo de red conserva el valor local sin presentarlo como guardado; abandonar el expediente exige guardar los cambios pendientes.

La pérdida de foco y el guardado explícito comparten una única liberación pendiente por campo. Una nueva adquisición espera esa liberación antes de solicitar un token, y el guardado espera las adquisiciones en curso antes de liberar los tokens y devolver el expediente. Así, una respuesta lenta al enfocar no deja un bloqueo rezagado al salir del campo ni provoca una doble liberación al pulsar «Guardar borrador».

Cada instancia del editor tiene una generación de ciclo de vida. Las respuestas de lectura o adquisición de una instancia anterior se descartan, incluso si el operador vuelve a abrir el mismo expediente. Si el servidor concede un bloqueo después de cerrar la pantalla, el cliente solicita inmediatamente su liberación; ante pérdida de red permanece la caducidad de 45 segundos como límite del bloqueo. El cierre normal espera también una adquisición por foco que todavía no haya modificado valores.

El móvil ofrece recuperación de sus expedientes desde la pantalla principal sin depender de una identidad aprobada disponible. Su selector utiliza una referencia técnica estable, permite recuperar otro borrador o preparar uno nuevo y guarda/libera la edición anterior antes de cambiar. Un fallo de guardado mantiene el expediente y los valores locales. Las plantillas actuales declaran cardinalidad mínima cero: las personas o campos pendientes se avisan, pero no bloquean el envío a revisión ni la generación. La revisión final se identifica como bloqueada y solo Windows puede reabrirla o guardar el DOCX. Una creación fallida conserva su clave de idempotencia hasta confirmar la respuesta o cambiar expresamente de plantilla.

## Plantillas y generación

La selección de personas utiliza un componente compartido en Windows y móvil. Los roles de una persona conservan un selector simple; los grupos repetibles ofrecen búsqueda, casillas y una lista numerada. Las nuevas selecciones se añaden al final y quitar una persona conserva el orden de las restantes. El máximo declarado impide añadir más personas, pero nunca impide retirarlas. El bloqueo de edición abarca todo el selector, no cada control interno por separado.

`enotario.document-template/v2` declara campos jurídicos, tipos, obligatoriedad, dirección de texto, capacidad y controles OOXML. El motor valida el hash, rechaza contenido activo o externo y rellena directamente los controles de contenido mediante `zipfile` y `lxml`.

Las transformaciones son deterministas. No existe traducción, transliteración ni inferencia jurídica. Los perfiles profesionales se resuelven a su nombre árabe en el momento de generar; un nombre puntual puede guardarse directamente en el expediente sin incorporarse al catálogo. Los campos ausentes se presentan como avisos no bloqueantes y permanecen editables en Word.

Windows administra los perfiles persistentes antes o durante un expediente. Su vista del contrato expone si un perfil está referenciado y por cuántos expedientes todavía conservados, incluidos los completados que pueden reabrirse durante su retención. Bajo el mismo bloqueo que protege las mutaciones de expedientes, la API impide desactivarlo o borrarlo mientras esté en uso; la corrección del nombre o función sí permanece disponible y se aplica en la generación posterior. El borrado exige primero la desactivación, de modo que una acción accidental no combine ambas decisiones. Windows y móvil permiten alternativamente escribir un nombre de uso puntual que solo pertenece al expediente. El móvil recibe los perfiles activos sin contadores globales y actualiza su catálogo por eventos.

La creación lleva un UUID estable generado por Windows y conservado mientras la operación no confirme éxito. Repetir la misma creación —también después de reiniciar el motor— devuelve el recurso existente; reutilizar el UUID con otros datos se rechaza. Así, una respuesta perdida no duplica perfiles sin necesitar almacenar datos personales en un registro HTTP adicional.

Una actualización repetida con la revisión inmediatamente anterior devuelve éxito únicamente si todos los valores normalizados coinciden con la modificación ya confirmada. Cualquier contenido distinto conserva el rechazo por revisión obsoleta. Por tanto, una respuesta perdida no obliga a duplicar ni a repetir manualmente una corrección, pero tampoco convierte una edición concurrente en válida.

El DOCX no contiene imágenes CNIE, OCR completo, polígonos, tokens, rutas internas ni metadatos personales. Tauri usa un diálogo nativo, escribe atómicamente y abre la ruta con la aplicación asociada. El expediente solo pasa a `completed` después del guardado confirmado.

## Recuperación y fallo seguro

- Una operación HTTP repetida con la misma clave de idempotencia devuelve el mismo resultado o rechaza un cuerpo diferente.
- Si falla la escritura de la instantánea, la API responde `503 TEMPORARY_STORAGE_WRITE_FAILED`, sin publicar excepciones o rutas de almacenamiento. Un reintento idempotente vuelve a confirmar la persistencia antes de devolver éxito; una respuesta que solo estaba en memoria no basta para retirar un recibo nativo.
- Las capturas en estado OCR `queued` o `processing` se vuelven a encolar al arrancar, respetando el límite de intentos.
- Una revisión obsoleta no sobrescribe datos; el cliente recarga el expediente.
- Un bloqueo de campo ajeno o caducado impide guardar ese campo.
- Un almacén manipulado o que no puede descifrarse detiene la apertura de los datos en lugar de tratarlos como válidos.
- La falta de Word no elimina el archivo ya guardado.
- Si el guardado nativo termina pero falla la respuesta de cierre del expediente, la interfaz conserva la ruta y ofrece reintentar únicamente el cierre. No vuelve a generar ni guardar el archivo. El cambio de expediente y la navegación a otras pantallas quedan bloqueados durante ese estado, las operaciones en curso y los cambios pendientes de guardar. La confirmación de cierre es idempotente ante una respuesta perdida.

La protección de cierre de la ventana del navegador usa `beforeunload`. El guardado nativo de ambos modos prepara un recibo cifrado antes de sustituir el archivo de destino y lo confirma después del guardado atómico, antes de abrir Word. Si se interrumpe entre esas dos operaciones, la recuperación compara el SHA-256 del archivo con el recibo preparado. Un archivo ausente o diferente no se considera guardado. Una vez confirmado, las modificaciones posteriores del operador en Word no invalidan el hecho del guardado inicial.

Al volver a abrir la interfaz, «Guardados recuperables» permite recuperar un recibo confirmado y reintentar únicamente el cierre. Se comprueba que corresponde a la misma revisión final, o a su cierre ya completado; una revisión diferente nunca se cierra automáticamente. Si no se puede leer o descifrar el catálogo, la generación permanece bloqueada. La eliminación expresa de un recibo no modifica el DOCX. La protección DPAPI no garantiza borrado forense de copias anteriores o backups del sistema.

La aplicación nativa comprueba la caducidad del catálogo al arrancar y cada 30 segundos mientras está abierta, sin depender de que se visite el editor. Con la aplicación cerrada no hay tareas de borrado ejecutándose; los recibos caducados se retiran al siguiente arranque y no se devuelven en la recuperación.

En el modo parcial, la generación recibe una revisión esperada y devuelve `X-eNotario-Document-Request-Revision`. Antes de devolver el DOCX se comprueba que la solicitud no haya cambiado, desaparecido o sido invalidada durante el renderizado. El cliente rechaza una revisión ausente, inválida o diferente. Los encabezados de nombre y revisión se exponen también a la estación web de desarrollo mediante CORS.

`POST /api/document-generation-requests/{id}/complete` es exclusivo de Windows, exige revisión e idempotencia y retira únicamente la revisión que se guardó. La clave estable es el UUID del recibo nativo. La respuesta de retiro se conserva cifrada en la instantánea durante 24 horas, dentro de la capacidad de 512 entradas del registro de idempotencia, permitiendo reintentar tras una respuesta perdida o reinicio. Si ese registro ya no está disponible, se devuelve un error de solicitud inexistente en lugar de declarar un cierre no probado; el operador conserva el Word y puede retirar expresamente el recibo local. «Guardados recuperables» se muestra incluso cuando la bandeja y las identidades ya están vacías. La recuperación no vuelve a generar ni modificar archivos.

## Contratos estables y evolución

Los contratos `cnie.ma.2020/v2` y `cnie.ma.legacy/v1` no cambian. Las plantillas v1 continúan disponibles para relleno parcial. La API local expone una versión de compatibilidad; el contrato 2 exige contexto de asignación para modificar campos jurídicos vinculados a personas. Cada expediente conserva la versión exacta de plantilla que lo creó y el catálogo puede resolver simultáneamente la versión vigente y las versiones históricas empaquetadas.

La Fase 1 está cerrada funcionalmente, pero no está declarada release comercial estable. La plantilla de herencia 1.5.0 declara que `heir_relation` pertenece al rol `heir`. La API reasocia esos valores mediante el identificador temporal de la identidad al añadir, retirar o reordenar herederos; los nuevos reciben un valor vacío. Cada parche del campo incluye la asignación sobre la que fue editado y se rechaza si quedó obsoleta. La interfaz muestra cada relación junto al heredero correspondiente y el Word la identifica como `صلة الإرث`. Las versiones 1.4.0 y 1.4.1 permanecen empaquetadas para expedientes existentes sin alterar sus manifiestos ni DOCX.

También faltan los gates externos: corpus representativo de CNIE antiguas, aprobación jurídica de cada plantilla, edición operativa y guardado manual del documento por un usuario, y firma del instalador con un certificado de la organización. Estos gates no se sustituyen por pruebas sintéticas.

## Evidencia de estabilización móvil — 17 de septiembre de 2026

Las pruebas de interfaz cubren recuperación sin identidad, cambio de expediente con cambios pendientes, fallo de almacenamiento sin pérdida local, reintento de creación con la misma clave, cierre con adquisición lenta y bloqueo de revisión final. La colaboración compartida comprueba además el cierre abrupto y la reapertura del mismo expediente con una adquisición antigua pendiente.

La comprobación con Playwright y el motor real utilizó exclusivamente datos sintéticos y almacenamiento local aislado. Se recuperó un expediente de matrimonio sin identidades, se guardaron un número de registro y un perfil profesional y se creó un expediente de herencia guardando texto árabe. Se capturó el formulario de matrimonio a 360, 390 y 430 px; en los tres casos el ancho del documento coincidió con el viewport y ningún control desbordó horizontalmente. Desde 0.8.0-alpha.2, una herencia sin personas asignadas puede avanzar con aviso porque todas las cardinalidades mínimas son cero.

Esta evidencia no sustituye la prueba completa con identidades aprobadas, las interacciones táctiles/cámara en teléfonos físicos, el guardado nativo ni la comprobación del Word final. Las capturas de QA son artefactos locales en `output/playwright/`, no datos del operador ni recursos distribuidos.

La misma QA descubrió y corrigió el doble lifespan de los listeners. Tras la corrección, HTTP y HTTPS devolvieron el mismo valor legal sintético y se verificaron dos reinicios consecutivos, incluido ejecutable empaquetado → ejecutable empaquetado: la sesión móvil siguió autorizada, su expediente conservó revisión y valor y la lista de bloqueos fue vacía. La comprobación real de aislamiento devolvió 404 al consultar un expediente ajeno y 403 al intentar generar Word desde el móvil. El empaquetado final verificó SHA-256 de sus 44 recursos web y de plantillas.

Las pruebas de integración API posteriores cubren el flujo desde identidades aprobadas sintéticas del propietario móvil hasta la generación Windows: matrimonio con esposo, esposa y padre de la esposa, y herencia con 1 solicitante, 12 herederos y 12 testigos. Comprueban reintento idempotente de asignaciones, aislamiento de otra sesión, bloqueo de edición en revisión final, prohibición móvil de generar o confirmar el guardado, presencia de todos los números CNIE asignados en el OOXML, ausencia de identificadores técnicos y tokens en el cuerpo del documento y respuesta `no-store` dentro del límite de 25 MiB. Descargar no completa el expediente: solo la confirmación Windows cambia el estado a `completed`. Estas pruebas no realizan OCR, interacción móvil real, guardado Tauri ni inspección visual de páginas.

Se corrigió además una divergencia entre la interfaz y la API: el endpoint de reapertura ahora exige autenticación de escritorio. Las pruebas reproducen el rechazo móvil tanto desde `final_review` como desde `completed` y verifican la reapertura Windows; ocultar la acción en la interfaz móvil no se considera una medida de autorización suficiente.

## Evidencia documental en Microsoft Word — 17 de septiembre de 2026

Se generaron de nuevo cuatro fixtures sin datos reales: matrimonio mínimo y con valores largos, herencia mínima y herencia con 1 solicitante, 12 herederos y 12 testigos. Microsoft Word 16.0.20326.20144 abrió cada DOCX en modo de solo lectura y lo exportó a PDF. Las cinco páginas resultantes se rasterizaron a 144 dpi y se inspeccionaron completas: matrimonio mínimo y máximo permanecieron en una página; herencia mínima ocupó una página y herencia máxima dos. La primera página utilizó siempre el arte `p1`; únicamente la segunda página de herencia máxima utilizó el encabezado y marco de continuación `p2`. No se observaron cortes, solapes, glifos ausentes, desbordamientos ni elementos fuera del marco.

Word expuso 13 controles en cada documento de matrimonio y 49 en cada documento de herencia. Ninguno tenía bloqueado el contenido ni el propio control, y los cuatro documentos devolvieron `wdNoProtection`. Esto acredita apertura, paginación, render y configuración editable en una versión soportada de Word. No acredita todavía la experiencia manual del operador, el diálogo nativo de guardado/apertura ni la aprobación del texto por la persona jurídicamente responsable. Los DOCX, PDF y PNG de esta verificación son artefactos sintéticos internos bajo `output/docx-qa-final` y no forman parte del instalador.

Tras los cambios finales de formato se renderizaron otra vez los casos completos de ambos pilotos con fechas occidentales `AAAA/MM/DD`, sin cortes ni solapes. Se usó Word/exportación PDF y Poppler; el intento con `render_docx.py` quedó impedido por falta de `soffice.exe`. El sidecar final está instalado y verificado en el puesto, pero el setup alpha.2 anterior a esos hotfixes debe reconstruirse antes de distribución. El inventario actual también registra que los testigos de herencia no declaran `expiry_date`, a diferencia de los otros roles. Estos límites se detallan en la [documentación integral](DOCUMENTACION_FASE1.md), sin atribuirles retrospectivamente aprobación a paquetes históricos.
