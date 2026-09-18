# Soporte de la CNIE marroquí anterior a 2020

El perfil `CNIE_MA_LEGACY` es independiente de `CNIE_MA_2020`; no modifica sus regiones ni el contrato `cnie.ma.2020/v2`. Una ficha antigua aprobada se exporta como `cnie.ma.legacy/v1` y conserva los mismos 14 campos revisados, por lo que puede alimentar los pilotos DOCX cuando están completos. La interfaz identifica explícitamente la generación detectada.

## Clasificación conservadora

Antes de capturar se selecciona «CNIE 2020» (inicial) o «CNIE antigua» en Windows o móvil. La elección queda fijada en el documento para ambas caras. Si el operador se equivoca, inicia otra CNIE; no se cambia el perfil de una captura existente. El motor compara la generación extraída con la elección y bloquea la revisión con `EXTRACTION_CARD_MODEL_MISMATCH` si no coinciden. Una señal de generaciones mezcladas conserva `EXTRACTION_MIXED_LAYOUT`.

El anverso requiere leyendas propias del modelo antiguo y geometría compatible: nombres latinos en la izquierda o CIN visual bajo el retrato. El reverso requiere la línea de estado civil y la zona inferior de sexo, filiación y domicilio. Si solo una cara cumple, la extracción se detiene con `EXTRACTION_MIXED_LAYOUT`; nunca se aplican regiones de una generación a la otra. Un formato desconocido sigue sin aprobarse automáticamente.

La captura y rectificación OpenCV siguen el flujo común. Vision UE lee únicamente la imagen rectificada válida. El extractor no lee ni guarda el código de barras, número de estado civil, firma, retrato, marcas de seguridad o datos no incluidos en los 14 campos. CIN impreso en ambas caras se compara y una discrepancia bloquea la aprobación.

## Revisión

Los 14 valores siguen sujetos a confirmación humana. El OCR no traduce ni translitera árabe o latino. El operador ve anverso y reverso, corrige cualquier valor impreciso y aprueba la ficha antes de generar Word. Cada identidad temporal conserva el identificador de perfil en `card_template`; liberar imágenes elimina originales, rectificaciones, OCR y evidencias como en la CNIE 2020.

Las zonas antiguas se ajustaron para evitar letras espurias de los fondos de seguridad. Una prueba controlada de las dos imágenes aportadas para el piloto detectó el perfil antiguo y propuso los 14 campos sin líneas contaminantes. Esa prueba transmitió las imágenes al Vision UE configurado como el flujo ordinario; no guardó ni registró valores personales. No demuestra por sí sola compatibilidad con todas las tiradas, estados de conservación o cámaras. Antes de distribución se requieren casos de distintas tarjetas antiguas, variaciones de luz, caras mezcladas y aprobación visual de los valores reales por un operador autorizado.

El script [`qa-legacy-ocr.py`](../scripts/qa-legacy-ocr.py) permite repetir la prueba con imágenes canónicas `1600 × 1008`. Solo imprime estado, cobertura, confianza, número de palabras y geometría; no imprime datos de identidad.
