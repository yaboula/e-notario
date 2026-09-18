# Fase 1 — referencia de API local

Referencia: `0.8.0-alpha.3`, API 2, 18 de septiembre de 2026. Complementa la [documentación integral](DOCUMENTACION_FASE1.md). Las rutas implementadas y los modelos de entrada se encuentran en `src/cnie_capture/api.py`; los contratos del cliente están en `packages/api-client/src/index.ts`.

## 1. Transporte, autenticación y alcance

El motor atiende `http://127.0.0.1:8787` para Windows y `https://IP_PRIVADA:8788` para la LAN configurada. Es una API del puesto, no un servicio SaaS público. Swagger, ReDoc y OpenAPI HTTP están deshabilitados.

Excepto salud y canje de emparejamiento, HTTP exige `Authorization: Bearer <token>`. Tauri obtiene el token privado de escritorio; el móvil recibe otro token al canjear un código de un solo uso. Nunca se entrega el token de escritorio al móvil. Los ejemplos de esta guía omiten credenciales reales.

En las tablas, **usuario** significa Windows o móvil autenticado; **propio** significa recursos de la sesión móvil, mientras Windows tiene alcance global sobre el puesto. Consultar un expediente ajeno devuelve 404. Operaciones reservadas a escritorio devuelven 403 al móvil. La lista de perfiles activos es compartida deliberadamente, sin contadores globales de uso para móviles.

Todas las respuestas HTTP llevan `Cache-Control: no-store`; se añaden protecciones `nosniff`, política de referente y políticas de contenido/permisos. CORS admite los orígenes locales/Tauri previstos, no cualquier dominio. El acceso LAN se protege con HTTPS y la CA del despacho; no debe publicarse a Internet.

## 2. Salud, catálogo y espacio de trabajo

| Método y ruta | Acceso | Resultado o entrada relevante |
|---|---|---|
| `GET /api/health` | Sin token | `status`, `version`, `api_version` |
| `GET /api/workspace` | Usuario, propio | Capturas/documentos, identidades aprobadas, solicitudes y borradores; URL LAN/configuración global solo en Windows |
| `GET /api/document-templates` | Usuario | Resúmenes de versiones vigentes, roles, campos y capacidades |
| `GET /api/document-templates/{template_id}?version=...` | Usuario | Resumen de la versión exacta, también histórica si está empaquetada |
| `GET /api/model` | Windows | Información del detector/modelo |
| `DELETE /api/temporary-data` | Windows | JSON `{"confirmation":"CLEAR_TEMPORARY_DATA"}`; limpia temporales, no perfiles/configuración/DOCX guardados |

Salud actual (`status` acredita respuesta del servicio; `background` permite distinguir tareas detenidas y almacenamiento fallido):

```json
{"status":"ok","version":"0.8.0-alpha.3","api_version":2,"background":{"ocr_worker":"running","maintenance":"running","storage_error":null}}
```

La interfaz valida API 2 antes de abrir el puesto. El número de versión por sí solo no acredita que un setup anterior incluya un hotfix: consulte [estado de distribución](UPDATES.md).

Errores OCR locales añadidos: `OCR_USAGE_READ_FAILED` si el consumo no puede verificarse y `OCR_USAGE_WRITE_FAILED` si no puede confirmarse su escritura. Consultar configuración/consumo ilegible devuelve HTTP 503; la prueba de conexión conserva HTTP 409 para resultados fallidos reintentables y el código específico de almacenamiento. La ausencia inicial del fichero no es corrupción. En OCR, estos fallos se conservan también en el resultado con reintento permitido tras reparar almacenamiento y sin llamada al proveedor. Un resultado pendiente de persistir se presenta como `processing`; consultar su OCR bruto o solicitar un reintento devuelve `503 TEMPORARY_STORAGE_WRITE_FAILED`.

## 3. Emparejamiento y sesiones

| Método y ruta | Acceso | Contrato |
|---|---|---|
| `POST /api/pairing` | Windows | Crea código/URL de emparejamiento; requiere LAN HTTPS configurada |
| `POST /api/pair` | Sin token previo | `code`, `operator_name`, `device_name`; canjea código y devuelve autorización móvil |
| `DELETE /api/pairing` | Windows | Revoca las sesiones móviles del puesto |

Código de un uso, vigencia 120 segundos; máximo ocho sesiones móviles y vigencia de sesión cuatro horas. `operator_name` y `device_name` tienen 1–48 caracteres; `code`, 20–128. Estos nombres son etiquetas operativas, no cuentas empresariales ni verificación de identidad del usuario.

## 4. Captura y revisión CNIE

| Método y ruta | Acceso | Contrato |
|---|---|---|
| `POST /api/captures` | Usuario | Cuerpo binario JPEG/PNG; query `side=front\|back`, `document_id` opcional, `card_model=2020\|legacy`; clave de idempotencia UUID |
| `GET /api/captures/{capture_id}/{variant}` | Usuario, propio | `metadata`, `original` o `rectified`; `ocr` solo Windows |
| `POST /api/captures/{capture_id}/review` | Windows | `decision: accepted\|retake`; ruta de revisión conservada aunque el flujo normal acepta automáticamente la imagen válida |
| `POST /api/captures/{capture_id}/ocr/retry` | Usuario, propio | Solicita reintento cuando el estado y límite de intentos lo permiten |
| `DELETE /api/captures/{capture_id}` | Usuario, propio | Elimina captura y actualiza/invalida datos derivados |
| `GET /api/documents/{document_id}/extraction` | Usuario, propio | Campos, estado y revisión de extracción |
| `PATCH /api/documents/{document_id}/extraction/review` | Usuario, propio | `revision`, `fields` con decisiones/valores revisados |
| `POST /api/documents/{document_id}/extraction/approve` | Usuario, propio | `revision`; valida 14 campos y crea identidad aprobada temporal |
| `POST /api/documents/{document_id}/release-images` | Usuario, propio | Requiere aprobación; elimina imágenes/OCR/evidencias, conserva identidad aprobada |
| `GET /api/documents/{document_id}/export` | Windows | JSON aprobado UTF-8, descarga explícita |

Cada valor revisado admite `decision: confirmed\|corrected\|absent` y `value: string\|string[]\|null`. La categoría ausente no equivale a una identidad aprobable: aprobar exige los 14 valores, formatos válidos y ausencia de conflictos bloqueantes. No se confunde esta validación CNIE con los avisos no bloqueantes de los formularios Word.

Los contratos de extracción son `cnie.ma.2020/v2` y `cnie.ma.legacy/v1`, separados. `card_model` lo selecciona el operador antes de capturar; queda fijado para ambas caras y el extractor contrasta el diseño. No existe detección automática silenciosa que cambie el modelo elegido.

Límites: 20 MiB por subida, 50 millones de píxeles decodificados, 30 capturas conservadas, presupuesto de imágenes de 160 MiB y tres intentos OCR. El cuerpo no es `multipart/form-data`. La identidad tiene caducidad de 24 horas desde aprobación; sustituir/eliminar una cara invalida los derivados que dependían de ella. Liberar imágenes no renueva esa caducidad.

## 5. Solicitudes parciales

| Método y ruta | Acceso | Contrato |
|---|---|---|
| `POST /api/document-generation-requests` | Usuario | `template_id`, `template_version`, `assignments`; idempotencia obligatoria |
| `PATCH /api/document-generation-requests/{request_id}` | Usuario, propio | `revision`, `assignments`; idempotencia obligatoria |
| `DELETE /api/document-generation-requests/{request_id}` | Usuario, propio | Idempotencia obligatoria; retiro explícito |
| `POST /api/document-generation-requests/{request_id}/generate` | Windows | `revision` recomendada y enviada por la UI; respuesta DOCX, no retira solicitud |
| `POST /api/document-generation-requests/{request_id}/complete` | Windows | `revision` e idempotencia obligatorias; retira solo solicitud guardada de esa revisión |

El cuerpo de generación es opcional por compatibilidad en esta ruta; los clientes actuales deben enviar la revisión esperada y comprobar la devuelta. Las solicitudes se consultan dentro de `/api/workspace`, no mediante una ruta GET adicional.

Ejemplo sin datos personales, con las cardinalidades actuales mínimas cero:

```json
{
  "template_id": "ma.marriage",
  "template_version": "1.7.0",
  "assignments": {"husband": [], "wife": [], "wife_father": []}
}
```

Cada lista contiene UUID de identidades aprobadas, no números CNIE ni valores OCR. Matrimonio admite una identidad por rol. Herencia `1.5.0` admite `applicant` hasta uno, `heir` hasta doce y `witness` hasta doce. No repetir una identidad dentro del mismo rol; aparecer en roles distintos genera advertencia, no inferencia ni bloqueo por sí mismo. El móvil solo puede asignar sus identidades. Versiones históricas pueden declarar otros mínimos: no se alteran sus manifiestos.

La solicitud fija versión, propietario y revisión. Expira o se invalida si una identidad asignada caduca, desaparece o se sustituye. Hay capacidad para 64 solicitudes y 64 identidades aprobadas.

## 6. Expedientes y relleno completo

| Método y ruta | Acceso | Contrato |
|---|---|---|
| `GET /api/cases` | Usuario, propio | Lista de resúmenes |
| `POST /api/cases` | Usuario | `template_id`, `template_version`, `mode: partial\|complete`; idempotencia; 201 |
| `GET /api/cases/{case_id}` | Usuario, propio | Detalle con campos, asignaciones, estado y revisión |
| `PATCH /api/cases/{case_id}` | Usuario, propio | Revisión, campos/asignaciones opcionales; idempotencia; solo `editing` |
| `GET /api/cases/{case_id}/readiness` | Usuario, propio | Faltantes, revisión e indicadores de preparación |
| `POST /api/cases/{case_id}/final-review` | Usuario, propio | `revision`; exige edición y ningún arrendamiento activo |
| `POST /api/cases/{case_id}/reopen` | Windows | `revision`; vuelve de revisión final/completado a edición |
| `POST /api/cases/{case_id}/generate` | Windows | `revision`, `confirm_incomplete` opcional; exige revisión final; DOCX |
| `POST /api/cases/{case_id}/complete` | Windows | `revision`; marca completado después del guardado nativo |
| `DELETE /api/cases/{case_id}` | Usuario, propio | Borra borrador administrado, no el DOCX externo |

Creación sintética:

```json
{"template_id":"ma.inheritance","template_version":"1.5.0","mode":"complete"}
```

`fields` es un mapa de claves del manifiesto a `string|string[]|null`. Fechas de formulario se normalizan desde su formato de entrada; en Word se muestran `AAAA/MM/DD` con cifras 0–9. No enviar fechas arbitrarias ni texto jurídico inferido. Las capacidades de cada campo siguen vigentes aun cuando falte contenido: que un campo sea opcional no permite valores malformados o desproporcionados.

Las actualizaciones globales sustituyen los mapas suministrados normalizados; no deben tratarse como un parche de un único valor sin conservar los demás. Para colaboración se usan las rutas por campo/rol de la siguiente sección. El modo parcial no admite campos jurídicos no vacíos.

Estados: `editing → final_review → completed`. Generar/descargar no completa. Cancelar guardado conserva revisión final. La reapertura no importa las modificaciones externas de Word; una generación posterior crea contenido a partir del expediente de la app.

`readiness.ready` indica si faltan datos recomendados; no es una autorización de generación ni un bloqueo por sí solo. `confirm_incomplete` y `can_generate_with_confirmation` se conservan por compatibilidad; la generación actual no exige confirmar faltantes como condición. Siguen bloqueando las revisiones obsoletas, identidades inválidas, formato/capacidad, estado incorrecto y corrupción.

El cierre completo acepta el reintento cuando el recurso ya está `completed` con revisión igual a la solicitada más uno. No exige encabezado de idempotencia. El cierre parcial sí usa clave de idempotencia y retira la solicitud.

## 7. Edición colaborativa

| Método y ruta | Acceso | Contrato |
|---|---|---|
| `GET /api/cases/{case_id}/field-leases` | Usuario, propio | Bloqueos públicos y `owned_by_me`; no tokens ajenos |
| `POST /api/cases/{case_id}/field-leases` | Usuario, propio | `field_key`, `lease_token` opcional para renovación; devuelve token propio |
| `DELETE /api/cases/{case_id}/field-leases` | Usuario, propio | `field_key`, `lease_token`; libera bloqueo |
| `PATCH /api/cases/{case_id}/fields/{field_key}` | Usuario, propio | `value`, `lease_token`, `assignment_context` si procede; idempotencia |
| `PATCH /api/cases/{case_id}/assignments/{role_key}` | Usuario, propio | `value: UUID[]`, `lease_token`; idempotencia |

Un bloqueo de rol usa `field_key: role.heir`, por ejemplo; un campo jurídico usa su clave de manifiesto, como `heir_relation`. Arrendamiento 45 segundos, renovación UI cada 15 mientras hay foco. `actor_label` opcional del modelo de entrada no permite suplantar la etiqueta: el servidor obtiene la etiqueta de la sesión.

Los parches atómicos de campo/rol se aplican sobre la revisión actual bajo bloqueo válido, sin revisión global en el cuerpo. Así pueden convivir campos distintos. Para `heir_relation`, `assignment_context` debe contener en orden los UUID de herederos sobre los que se editó el array de valores. API 2 rechaza contexto obsoleto; no asocia una relación sucesoria a otra persona por su índice anterior.

Cambiar roles reasocia los campos vinculados por identidad: quitar conserva los valores de las personas restantes, reordenar mueve sus valores y añadir crea valores vacíos. No se calcula parentesco ni cuota de herencia a partir de filiación OCR.

## 8. Perfiles profesionales

| Método y ruta | Acceso | Contrato |
|---|---|---|
| `GET /api/professional-profiles` | Usuario | Windows: activos/inactivos y uso; móvil: activos sin uso global |
| `POST /api/professional-profiles` | Windows | `id` UUID opcional, `display_name_ar`, `display_name_fr`, `function_fr`; 201 |
| `PATCH /api/professional-profiles/{profile_id}` | Windows | Datos del perfil, `revision`, `active` |
| `DELETE /api/professional-profiles/{profile_id}` | Windows | Requiere inactivo y no referenciado |

Nombre árabe 1–160 caracteres, nombre francés y función hasta 160. La UI conserva un UUID estable al crear: repetirlo con los mismos datos recupera el recurso; datos distintos son conflicto. Sin UUID explícito no se garantiza esa deduplicación. No se requiere `Idempotency-Key` en estas rutas.

La actualización acepta el reintento de revisión inmediatamente anterior solo si todos los valores normalizados coinciden con el resultado actual. Un perfil en uso no puede desactivarse ni borrarse; sí corregirse. Los campos profesionales también aceptan nombre puntual directamente desde el formulario, sin alta de perfil. El catálogo es persistente; el nombre puntual solo pertenece al expediente temporal.

## 9. Configuración y consumo OCR

| Método y ruta | Acceso | Contrato |
|---|---|---|
| `GET /api/ocr/config` | Windows | Estado/configuración pública, nunca credencial completa |
| `PUT /api/ocr/config/credential` | Windows | JSON de cuenta de servicio, máximo 64 KiB; protegido con DPAPI |
| `POST /api/ocr/config/test` | Windows | Prueba sintética del proveedor; cuenta como consumo |
| `DELETE /api/ocr/config/credential` | Windows | Retira credencial configurada |
| `GET /api/ocr/usage` | Windows | Resumen de contadores agregados |

El OCR requiere proveedor configurado y conexión; la extracción estructurada y generación DOCX son locales. No incluir credenciales en query, logs, Git o ejemplos. Consulte [configuración segura](GOOGLE_VISION_SETUP.md).

## 10. Revisiones, idempotencia y persistencia

`revision` es un entero no negativo obtenido del recurso, no una marca de reloj. Un conflicto exige recargar y conciliar, no incrementar ciegamente la revisión.

`Idempotency-Key` debe ser UUID en capturas; crear/actualizar expedientes y parches por campo/rol; crear/actualizar/eliminar solicitudes parciales y confirmar su guardado. Conservar la misma clave para el mismo intento cuando se pierde respuesta. Cambiarla para una operación realmente distinta. La clave queda aislada por propietario; reutilizarla con otro cuerpo/acción produce `IDEMPOTENCY_CONFLICT`. El registro de mutaciones de casos y el de solicitudes admiten hasta 512 entradas cada uno y no constituyen un histórico ilimitado.

La instantánea conserva cifrada la información necesaria para reintentar tras reiniciar dentro de su retención. Si falla persistencia, un reintento idempotente debe volver a confirmar la escritura antes de devolver éxito. Un resultado solo en memoria no acredita cierre durable.

No todas las mutaciones usan el mismo mecanismo: transiciones de estado/extracción usan revisión; perfiles usan UUID/reintento exacto; arrendamientos usan tokens; borrado global usa confirmación literal. No añadir claves a una ruta sustituye sus condiciones específicas.

## 11. Descarga y guardado nativo

DOCX MIME: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Tamaño máximo 25 MiB. Encabezados de respuesta:

- `Content-Disposition`: nombre sin PII, basado en plantilla y fecha/hora técnica.
- `X-eNotario-Case-Revision`: expedientes.
- `X-eNotario-Document-Request-Revision`: solicitudes parciales.
- `Cache-Control: no-store`.

Los encabezados de nombre/revisión están expuestos al cliente mediante CORS. El cliente valida la revisión, muestra diálogo nativo y escribe atómicamente. Solo tras guardado correcto confirma cierre en la API; abrir Word puede fallar sin perder el archivo. La API de cierre confía en la estación Windows autorizada: no inspecciona remotamente el disco ni constituye una prueba criptográfica de firma del operador. El recibo DPAPI y la comprobación de hash pertenecen a la capa Tauri.

La generación vuelve a comprobar el recurso después del render: si cambió o desapareció, no entrega una salida como si correspondiera a la revisión actual. La descarga nunca envía DOCX al móvil.

## 12. Eventos

`WS /api/events`: tras aceptar conexión, enviar JSON `{"token":"<token_de_la_sesion>"}` en cinco segundos. El servidor autentica y devuelve `{"type":"connected"}`. Las notificaciones de cambio indican que el cliente debe recargar mediante HTTP autenticado; no transportan un volcado global de PII.

Enviar heartbeat de texto antes de 60 segundos; el servidor revalida la autorización. Máximo 16 sockets. Cierre `4401` por autorización inválida, caducidad o fallo de protocolo/tiempo; `4429` por capacidad. En LAN usar `wss`, no `ws`. No enviar token como query visible en URL.

## 13. Errores y respuesta del cliente

Los errores de dominio HTTP usan `{"detail":"CODIGO_PUBLICO"}`. La validación estructural de FastAPI puede devolver 422 con lista de detalles; no asumir que `detail` siempre es texto ni registrar cuerpos que contengan valores personales.

| Familia | Ejemplos | Acción |
|---|---|---|
| Autorización | `AUTH_REQUIRED`, `DESKTOP_ONLY`, `SESSION_EXPIRED` | Reautenticar/emparejar; no cambiar superficie para eludir permisos |
| Reintento | `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_CONFLICT` | Mantener intento original o corregir contrato; no duplicar a ciegas |
| CNIE | `DOCUMENT_CARD_MODEL_LOCKED`, `EXTRACTION_CARD_MODEL_MISMATCH`, `EXTRACTION_SIDE_MISMATCH`, `EXTRACTION_STALE_REVISION`, `EXTRACTION_REQUIRED_FIELD_MISSING` | Revisar caras/modelo/datos; recargar revisión |
| Identidad | `APPROVED_IDENTITY_EXPIRED`, `APPROVED_IDENTITY_FORBIDDEN` | Reaprobar/reasignar; no copiar datos de otra sesión |
| Plantilla | `DOCUMENT_TEMPLATE_NOT_FOUND`, `DOCUMENT_TEMPLATE_INTEGRITY_FAILED`, `DOCUMENT_ROLE_INVALID`, `DOCUMENT_TEMPLATE_VALUE_TOO_LONG`, `DOCUMENT_GENERATION_FAILED` | Reparar paquete o corregir asignación/capacidad |
| Expediente | `CASE_STALE_REVISION`, `CASE_NOT_EDITABLE`, `CASE_NOT_IN_FINAL_REVIEW`, `CASE_EDITORS_ACTIVE` | Recargar o terminar edición; reapertura solo Windows |
| Colaboración | `CASE_FIELD_LOCKED`, `CASE_FIELD_LEASE_INVALID`, `CASE_FIELD_LEASE_EXPIRED`, `CASE_ASSIGNMENT_CONTEXT_CHANGED` | Renovar/liberar/recargar, preservar valor local no guardado |
| Solicitud | `DOCUMENT_REQUEST_STALE_REVISION`, `DOCUMENT_REQUEST_NOT_FOUND` | No cerrar revisión distinta ni regenerar para recuperar un recibo |
| Perfil | `PROFILE_IN_USE`, `PROFILE_DELETE_REQUIRES_INACTIVE`, `PROFILE_STALE_REVISION` | Sustituir referencia/desactivar/recargar |
| Persistencia | `TEMPORARY_STORAGE_WRITE_FAILED`, errores de descifrado/corrupción | Detener confirmación de éxito; conservar evidencia y consultar TI |

Estados habituales: 400 contrato de idempotencia incorrecto; 401 sin autorización válida; 403 escritorio/propiedad prohibida; 404 recurso no disponible; 409 conflicto de estado/revisión/dominio; 422 estructura inválida; 500 plantilla/generación/integridad interna; 503 fallo de persistencia temporal. La lista de ejemplos no sustituye los códigos exactos del cliente y del motor.

Los avisos por personas o campos documentales ausentes no deben convertirse en errores bloqueantes en UI. Los errores de autenticación, aprobación, integridad, concurrencia y capacidad sí deben impedir la operación afectada.
