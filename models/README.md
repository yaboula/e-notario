# DocQuadNet-256 ONNX

`src/cnie_rectifier/models/docquadnet256_trained_opset17.onnx` procede de `egdels/makeacopy`, commit `5d08804af3a2fe6d25c09f85366a19ca4fac0a04`.

- SHA-256 upstream: `2426e05fc268b6110502000679b2be9b448579f8ecec4acf7a32b7053ca181cf`
- SHA-256 local reparado: `b4727efbeedeb0e751cc03ae96572ccb1c7f891ee00e62278eca98826fd20abb`
- Entrada: `input`, `float32`, `[1,3,256,256]`
- Salidas: `corner_heatmaps` `[1,4,64,64]`, `mask_logits` `[1,1,64,64]`
- Opset: 17
- Proveedor previsto: `CPUExecutionProvider`

Preprocesamiento: letterbox RGB a 256×256, padding negro, interpolación bilineal, NCHW float32 dividido por 255. El postprocesamiento sigue la implementación del mismo commit.
