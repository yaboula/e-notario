# Extracción estructurada y aprobación CNIE

Referencia vigente: `0.8.0-alpha.2`, API 2. La extracción interpreta localmente el `OcrResult` de anverso y reverso; no realiza una segunda llamada a Google ni afirma autenticidad. Complementa la [documentación integral de Fase 1](DOCUMENTACION_FASE1.md) y la [referencia API](PHASE1_API.md).

## Flujo del operador

1. Elegir «CNIE 2020» (opción inicial) o «CNIE antigua» antes de capturar; la elección queda fijada para ambas caras.
2. Capturar las dos caras. Una rectificación válida pasa automáticamente al OCR; un rechazo exige repetir, no confirmar una imagen inválida.
3. Esperar a que termine el OCR europeo y comprobar los 14 valores en la revisión de datos. El texto OCR completo no es una etapa del flujo normal.
4. Consultar las imágenes cuando sea necesario y corregir/confirmar los valores. La aprobación es siempre una acción humana explícita.
5. Aprobar desde Windows o desde el móvil propietario; corregir antes cualquier conflicto de caras/modelo o dato requerido inválido/ausente.
6. Elegir relleno parcial o completo para preparar Word. Opcionalmente conservar la identidad y liberar imágenes para seguir capturando personas.
7. Si se necesita JSON, exportarlo explícitamente en Windows; el móvil no recibe la exportación ni el DOCX.

Sustituir una cara invalida extracción, revisión e identidad derivadas. Desde 0.8.0, el estado temporal se persiste cifrado y puede reanudarse tras cerrar el motor hasta su caducidad de 24 horas. La identidad caduca 24 horas desde aprobación, sin renovarse al editar un expediente. Liberar imágenes elimina originales, rectificaciones, OCR y evidencias del almacén activo; conserva solo la ficha aprobada. «Limpiar sesión» elimina los temporales y sus claves, no perfiles/configuración ni Word guardados fuera de la app.

Copiar un valor muestra un aviso y el cliente intenta retirar ese mismo contenido del portapapeles después de 60 segundos. No garantiza borrar el historial de Windows, copias externas ni contenido que lo haya sustituido.

## Contrato de salida

El modelo moderno usa `schema_version: cnie.ma.2020/v2`; el antiguo usa `cnie.ma.legacy/v1`. No se modifica el contrato moderno para soportar el antiguo. Ambos contienen los 14 datos revisados, versiones de plantilla/extractor y correcciones: CIN, nombres/apellidos árabes y latinos, nacimiento, validez, sexo, lugares de nacimiento, filiaciones y domicilios en ambas escrituras.

La salida no contiene autoridad emisora, CAN, acta civil, mención conyugal, MRZ/código de barras, imágenes, credenciales, texto OCR completo ni respuesta original de Google. La filiación es un valor completo: no separar padre/madre ni introducir otra `و` en la generación.

## Aprobación frente a avisos documentales

Aprobar exige los 14 valores revisados, CIN/fechas/sexo válidos, caducidad posterior al nacimiento y ausencia de conflictos bloqueantes. Permitir campos jurídicos Word vacíos no elimina estas garantías CNIE. La aprobación no comprueba legalmente la vigencia o autenticidad de la tarjeta.

Las fechas internas son ISO `YYYY-MM-DD`; la generación Word muestra `AAAA/MM/DD`, con cifras normales 0–9 y protección de orden visual RTL. No se convierte el JSON a números árabes ni se traduce el contenido.

## Límites

- Se admiten los perfiles moderno y antiguo implementados; un diseño desconocido o mezclado se rechaza. Véase [CNIE antigua](CNIE_LEGACY.md).
- No hay traducción, transliteración, reconocimiento facial, firma, biometría ni lectura NFC.
- Un valor ausente permanece vacío; el extractor no completa datos por contexto.
- La extracción no utiliza MRZ, código de barras o biometría; el OCR puede reconocer otros textos, pero no alimentan la identidad aprobada.
- El cierre funcional de Fase 1 no sustituye el corpus representativo y umbrales de benchmark previos a distribución comercial; véanse [evidencias y pendientes](DOCUMENTACION_FASE1.md).
