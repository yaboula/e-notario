# Extracción estructurada de CNIE 2020

La versión 0.6.1 interpreta localmente el `OcrResult` de anverso y reverso. No vuelve a enviar imágenes o texto a Google y no afirma la autenticidad del documento.

## Flujo del operador

1. Capturar y aceptar las dos caras.
2. Esperar a que termine el OCR europeo de ambas imágenes.
3. Abrir **Datos estructurados**.
4. Abrir el anverso o reverso en el visor cuando sea necesario.
5. Confirmar o corregir los 14 campos, individualmente o por sección cuando no existan incidencias.
6. Aprobar el documento desde Windows o desde el móvil que realizó la captura.
7. Exportar el JSON UTF-8 exclusivamente mediante el diálogo explícito de Windows.

Los campos, revisiones y aprobaciones se descartan al sustituir una cara, al cerrar el servicio o al cumplirse 60 minutos. Copiar un valor muestra un aviso y el cliente intenta retirar ese mismo contenido del portapapeles después de 60 segundos.

## Contrato de salida

El JSON aprobado usa `schema_version: cnie.ma.2020/v2`. Contiene únicamente los 14 datos confirmados, la versión de plantilla y extractor y la lista de correcciones. No contiene autoridad emisora, CAN, acta civil, mención conyugal, MRZ, imágenes, credenciales, texto OCR completo ni respuesta original de Google.

## Límites

- Solo se admite el diseño CNIE marroquí introducido en 2020.
- No hay traducción, transliteración, reconocimiento facial, firma, biometría ni lectura NFC.
- Un valor ausente permanece vacío; el extractor no completa datos por contexto.
- La extracción estructurada no procesa ni utiliza la zona óptica; el OCR completo conserva fielmente el texto reconocido.
- La promoción a producción requiere el corpus y los umbrales definidos para la Fase 3.
