# Benchmark y gate de fase

El dataset, sus anotaciones y cualquier visualización deben vivir fuera de este repositorio. Use al menos 100 fotografías autorizadas de anversos y reversos y 50 negativos. Reserve cinco tarjetas completas como test sellado por identidad de tarjeta, no por fotografía.

Cada línea del manifiesto es un objeto JSON:

```json
{"image":"sealed/card-001-front-01.jpg","corners":[[312,241],[2011,278],[1976,1320],[350,1292]],"conformant":true,"negative":false,"card_id":"sealed-001"}
{"image":"negatives/empty-table-01.jpg","conformant":false,"negative":true}
```

Las esquinas anotadas deben estar en la imagen una vez aplicada la orientación EXIF y en orden `top_left`, `top_right`, `bottom_right`, `bottom_left`.

Ejecutar:

```powershell
cnie-rectifier benchmark --manifest D:\cnie-dataset\sealed-test.jsonl --output D:\cnie-results\benchmark.json
```

El informe contiene resultados separados para `opencv`, `docquadnet` e `hybrid`, sin rutas de archivos. Calcula IoU, error de esquinas normalizado por diagonal, recall conforme, rechazo no conforme, falsas aceptaciones, latencias, desacuerdos y fallbacks. El campo `gate` aplica automáticamente los umbrales numéricos; la inspección visual de texto, bordes y ausencia de recortes sigue siendo obligatoria.

Para cada aceptación exclusiva de DocQuadNet, audite también `corner_peak_prominences`, `mask_quad_iou`, `mask_largest_component_ratio`, `color_edge_support` y `boundary_supported_sides`. Estos límites forman una admisión conjunta: no deben calibrarse de manera aislada para hacer pasar una fotografía concreta. Los negativos con varios rectángulos son especialmente importantes para verificar que un fallback OpenCV no oculte un desacuerdo estructural del modelo.

La primera inferencia incluye carga y optimización del grafo ONNX. Para estudiar latencia de servicio persistente, diferencie arranque en frío de p50/p95 en un proceso que reutiliza `CnieRectifier`.
