# Google Cloud Vision · configuración de la estación

## Preparación por TI

1. Utilizar el proyecto corporativo aprobado para el tratamiento de CNIE.
2. Habilitar facturación y Cloud Vision API.
3. Crear una cuenta de servicio dedicada a esta estación, con permisos mínimos para invocar Vision; no asignar roles generales de propietario o editor.
4. Establecer alertas y cuotas también en Google Cloud. Los límites locales iniciales de e-notario son 60 llamadas diarias y 900 mensuales.
5. Entregar temporalmente el JSON al usuario Windows autorizado mediante el procedimiento seguro de la organización.

## Importación

En **Diagnóstico del motor → Google Cloud Vision · UE**, pulse **Importar credencial Google**. La aplicación valida el tipo, proyecto, correo, clave privada y token URI; después guarda exclusivamente un blob cifrado con Windows DPAPI `CurrentUser` en `%LOCALAPPDATA%\e-notario-v2\google-vision.credential.dpapi`.

Pulse **Probar conexión**. La prueba envía una imagen sintética sin datos personales al endpoint europeo y cuenta como una llamada. Cuando termine, TI debe retirar el archivo JSON original: e-notario no lo borra automáticamente.

La credencial queda ligada al usuario Windows que la importó. Otro usuario no puede descifrarla. Para rotarla, use **Sustituir credencial**; para revocarla localmente, use **Eliminar credencial** y revoque también la clave en Google Cloud cuando corresponda.

## Límites administrados

Los valores predeterminados se pueden sustituir al iniciar el servicio mediante `CNIE_OCR_DAILY_LIMIT` y `CNIE_OCR_MONTHLY_LIMIT`. No existe control de operador en la interfaz. El contador persistente contiene únicamente fecha y número agregado de llamadas; no contiene identificadores, imágenes ni texto.

## Piloto

El manifiesto del CLI es un array JSON con entradas como:

```json
[{"id":"muestra-01","image":"rectificada-01.jpg","arabic_truth":"transcripción árabe autorizada"}]
```

`cnie-ocr benchmark` ejecuta por separado autodetección y el experimento `ar + fr`, y calcula CER árabe y latencias. Cada modo realiza una llamada por imagen, por lo que debe presupuestarse el doble de solicitudes. El manifiesto, las imágenes, las transcripciones y el informe deben permanecer fuera del repositorio.
