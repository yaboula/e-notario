# Protocolo de captura y códigos de rechazo

El operador debe colocar una sola CNIE sobre un fondo mate, liso y contrastante. La tarjeta debe ocupar aproximadamente entre 50 % y 90 % del encuadre, medido de forma independiente de la orientación mediante la relación entre la diagonal de la tarjeta y la diagonal de la fotografía. Debe conservar visibles las cuatro esquinas y tener al menos 1.000 píxeles en su lado corto. Usar luz difusa, sin flash directo; no apoyar dedos ni otros objetos sobre la tarjeta.

Acciones asociadas a los códigos:

- `EMPTY_IMAGE`, `IMAGE_DECODE_FAILED`: repetir o volver a transferir la fotografía.
- `UNSUPPORTED_IMAGE_FORMAT`: capturar o exportar como JPEG/PNG; HEIC no está admitido.
- `IMAGE_TOO_SMALL`, `INSUFFICIENT_CARD_RESOLUTION`: acercar la cámara o aumentar la resolución.
- `IMAGE_TOO_LARGE`: reducir la resolución del archivo antes de procesarlo.
- `NO_DOCUMENT_QUADRILATERAL`: usar fondo más contrastante y mostrar las cuatro esquinas.
- `CARD_TOO_SMALL_IN_FRAME`: acercar la cámara.
- `CARD_TOO_CLOSE_TO_FRAME`, `CORNERS_TOO_CLOSE_TO_IMAGE_BORDER`: alejar ligeramente la cámara y dejar margen alrededor.
- `INSUFFICIENT_EDGE_SUPPORT`, `LOW_CLASSICAL_CONFIDENCE`, `LOW_MODEL_SCORE`: mejorar contraste, enfoque e iluminación y repetir.
- `WEAK_CORNER_EVIDENCE`: mostrar completamente las cuatro esquinas y acercar ligeramente la cámara.
- `AMBIGUOUS_CORNER_EVIDENCE`: retirar otros objetos rectangulares y dejar una sola tarjeta.
- `MODEL_MASK_DISAGREEMENT`: usar un fondo despejado y comprobar que nada toque o solape la tarjeta.
- `EXCESSIVE_GLARE`: retirar flash directo, cambiar el ángulo o difuminar la luz.
- `IMAGE_TOO_DARK`, `IMAGE_TOO_BRIGHT`: corregir la iluminación y repetir.
- `DETECTOR_DISAGREEMENT`: repetir la captura con la tarjeta más frontal y el fondo despejado.
- `QUADRILATERAL_OUT_OF_BOUNDS`, `INVALID_QUADRILATERAL_GEOMETRY`, `DEGENERATE_HOMOGRAPHY`, `MATERIAL_BLACK_BORDER`: asegurar que toda la tarjeta quede dentro del encuadre y repetir.
- `MODEL_UNAVAILABLE`, `CLASSICAL_DETECTOR_ERROR`: incidencia técnica; no seguir con OCR y notificar al responsable.

`CLASSICAL_DETECTOR_MISSED`, `MODEL_DETECTOR_MISSED`, `DETECTOR_SOFT_DISAGREEMENT` y `STRONG_CLASSICAL_OVERRIDE` son advertencias de fallback, no rechazos. Deben contabilizarse en el benchmark para detectar cambios de dominio. El perfil 0.6.1 tolera variación moderada de luz y borde, pero conserva como controles duros la geometría, presencia completa, resolución, legibilidad y ausencia de bordes negros materiales.


## Captura asistida y corrección de bordes — alpha.4

El móvil intenta obtener una fotografía mediante `ImageCapture` y conserva el fotograma completo como fallback. No recorta con el marco de pantalla ni aplica zoom. La disponibilidad, resolución y enfoque dependen del navegador y del dispositivo; «Seleccionar fotografía» sigue disponible. La fotografía completa se muestra antes de enviarla.

Durante la cámara, se envía como máximo una vista cada ciclo de aproximadamente 900 ms más su latencia, con lado máximo de 640 píxeles, al PC autenticado. OpenCV devuelve un contorno y consejos de distancia, margen e iluminación. Una sola inferencia de vista previa se ejecuta simultáneamente por estación; se omite mientras se procesa una captura. Las vistas no se conservan, no crean documentos ni consumen OCR. Son orientación de encuadre, no aceptación, comprobación de nitidez ni captura automática. Si no se detecta un contorno o la red falla, el disparo manual sigue disponible.

«Ajustar bordes» permite arrastrar las cuatro esquinas sobre el original. También está disponible tras un rechazo con imagen decodificada. Los puntos se expresan como fracciones de la imagen ya orientada con EXIF, sin modificar ni recomprimir el original. La estación valida orden, convexidad, presencia dentro de imagen, ocupación, resolución, iluminación y bordes negros. La evidencia automática de contraste del borde se sustituye por la selección del operador; ningún otro gate se omite. Texto tapado, desenfoque o reflejos destructivos necesitan otra foto; el editor no reconstruye contenido ausente.

La salida sigue siendo JPEG 95 de `1600 × 1008`. Tras rectificar se aplica, solo si existe variación amplia de iluminación, una corrección suave acotada a ±12 niveles del canal L de Lab. La nitidez se mide antes de la mejora. El original se conserva bajo la misma protección y retención. No se usa upscale neuronal; el reescalado continúa mediante interpolación bicúbica de la homografía.

La captura manual produce `detector_used: manual` y advertencia `MANUAL_CORNERS`; una selección cruzada, fuera de imagen o inválida produce `INVALID_MANUAL_CORNERS`. El benchmark automático no debe contar las correcciones humanas como detecciones automáticas.

La validación sintética compara el tag alpha.3 con alpha.4 en las mismas escenas: tarjeta redondeada con color, IoU de 0,97417 a 0,99672; su variante oscurecida pasa de rechazo a aceptación; la escena con varios rectángulos conserva el rechazo. No mide tasa de rechazo real ni superioridad respecto a otras apps. Siguen pendientes corpus autorizado, calibración de reflejos/desenfoque y pruebas físicas Android/iOS.
