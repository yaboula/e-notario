# Documentación de e-notario

La referencia actual es la [documentación integral de Fase 1](DOCUMENTACION_FASE1.md), actualizada para `0.8.0-alpha.3`, API 2, el 18 de septiembre de 2026, junto con el [estado del saneamiento](SANEAMIENTO_FASE1.md). El cierre funcional local está aceptado por el responsable del producto; no equivale a aprobación jurídica, publicación estable firmada ni SaaS comercial ya desplegado.

## Referencias principales

- [Saneamiento previo a Fase 2: correcciones, evidencia y gates abiertos](SANEAMIENTO_FASE1.md)
- [Traspaso al nuevo chat de Fase 2: contexto, decisiones y pendientes](PHASE2_HANDOFF.md)
- [Documentación integral de Fase 1: producto, ingeniería y operación](DOCUMENTACION_FASE1.md)
- [API local: rutas, permisos, contratos y concurrencia](PHASE1_API.md)
- [Arquitectura, seguridad, recuperación y evidencias de Fase 1](PHASE1_ARCHITECTURE.md)

## Guías especializadas

- [Protocolo de captura y códigos de rechazo](CAPTURE_PROTOCOL.md)
- [Fase 1 — arquitectura, seguridad y ciclo del expediente](PHASE1_ARCHITECTURE.md)
- [Benchmark y gate de fase](BENCHMARK.md)
- [Google Cloud Vision — configuración segura](GOOGLE_VISION_SETUP.md)
- [Extracción estructurada y aprobación CNIE](STRUCTURED_EXTRACTION.md)
- [Soporte CNIE antigua y límites de validación del corpus](CNIE_LEGACY.md)
- [Creación y versionado de plantillas DOCX](DOCX_TEMPLATES.md)
- [Instalación Windows y captura móvil](WINDOWS_MOBILE_SETUP.md)
- [Actualizaciones Windows](UPDATES.md)
- [Publicación Windows firmada](RELEASE_WINDOWS.md)
- [QA aislada de instalación, actualización y reparación](WINDOWS_INSTALLATION_QA.md)
- [Decisiones de arquitectura](decisions/README.md)

## Referencias del repositorio

- [README principal](../README.md)
- [Historial de versiones](../CHANGELOG.md)
- [Modelo DocQuadNet incluido](../models/README.md)
- [Avisos y licencias de terceros](../THIRD_PARTY_NOTICES.md)

## Referencias históricas

- [Documentación integral 0.7.0](DOCUMENTACION_V0.7.0.md): módulo DOCX inicial.
- [Documentación integral 0.6.1](DOCUMENTACION_V0.6.1.md): línea base del núcleo CNIE.

No usar sus límites de retención ni sus flujos como instrucciones vigentes. Las evidencias de QA conservan fechas y hashes históricos: los cambios posteriores no se atribuyen retroactivamente a un paquete anterior.

## Política documental

- La documentación versionada describe únicamente comportamiento implementado.
- Las ideas futuras se identifican expresamente como hoja de ruta.
- Todo cambio público de API, datos, seguridad o operación debe actualizar la documentación en el mismo commit.
- Los ejemplos nunca deben contener una CNIE, credencial o dato personal real.
