# Changelog

## 0.6.1 — 2026-09-14

- Corrige la extracción de sexo: solo admite un marcador `M/F` alineado con la etiqueta impresa y evita confundir elementos gráficos alejados.
- Presenta el sexo como selector explícito `F/M` para una corrección humana inequívoca.
- Equilibra la aceptación de capturas de oficina con tolerancia moderada de luz y bordes, conservando los controles duros de geometría, tamaño, legibilidad y falsos rectángulos.
- Sustituye la confirmación campo a campo por acciones completas por categoría y por una aprobación global de los 14 campos.
- Conserva listas multilínea de filiación y domicilio durante la revisión masiva.
- Evita la recarga periódica del visor de anverso/reverso y mantiene sincronizada la revisión entre Windows y el móvil propietario.

## 0.6.0 — 2026-09-14

- Reduce la revisión estructurada a 14 campos y publica el contrato `cnie.ma.2020/v2`.
- Retira de extracción, validación y exportación autoridad emisora, CAN, acta civil, mención opcional y MRZ.
- Sustituye el panel de evidencia por un formulario Windows de ancho completo con visor de caras y confirmación por sección.
- Permite que el móvil propietario revise y apruebe su CNIE sin exponer OCR completo, diagnósticos ni exportación.
- Registra en memoria el origen y la fecha de cada revisión y protege ediciones simultáneas mediante revisiones optimistas.
- Sincroniza confirmaciones y aprobación entre móvil y Windows por eventos, con refresco de respaldo y conservación de borradores no guardados.

## 0.5.1 — 2026-09-14

- Evita mezclar campos vecinos mediante líneas de lectura y regiones conservadoras.
- Conserva los saltos de línea de filiación y domicilio y contrasta los nombres con la MRZ.
- Mantiene incompleta una línea MRZ de 29 caracteres y bloquea la aprobación hasta su revisión.
- Actualiza los controles MRZ mostrados después de una corrección humana.

## 0.5.0 — 2026-09-14

- Añade extracción estructurada local y determinista para la CNIE marroquí de 2020.
- Valida la MRZ TD1, sus dígitos de control y la coherencia de CIN, nacimiento, sexo y caducidad.
- Incorpora revisión humana campo por campo, correcciones versionadas y exportación JSON aprobada.
- Mantiene imágenes, OCR, datos y correcciones exclusivamente en memoria durante 60 minutos.
- Impide que las sesiones móviles consulten texto OCR, campos extraídos o exportaciones.
- Conserva sin cambios la captura, rectificación y comunicación europea con Google Vision.
- Ajusta la plantilla geométrica a las cajas reales de Vision para evitar mezclar nombres,
  fechas, domicilio, filiación, CAN y acta; reconstruye la MRZ desde sus palabras y
  recupera únicamente un dígito compuesto cuando el checksum lo determina sin ambigüedad.

## 0.4.0 — 2026-09-14

- Añade OCR árabe/francés con Google Cloud Vision mediante el endpoint europeo y solo después de la aceptación humana.
- Agrupa anverso y reverso en una sola CNIE, con cola asíncrona y resultados temporales durante 60 minutos.
- Protege la cuenta de servicio mediante Windows DPAPI y limita su administración a la estación Windows.
- Añade vistas de imagen, OCR árabe RTL, texto completo, geometría por palabra y exportación explícita UTF-8/JSON.
- Conserva sin cambios la captura y rectificación aceptadas en la Fase 1.

## 0.3.2 — 2026-09-14

- Restaura la captura móvil probada en 0.2.1: fotograma completo, sin recorte, zoom ni selector efectivo.
- Conserva la detección automática de la estación y la actualización Windows en sitio.

## 0.3.1 — 2026-09-14

- Convierte el marco del escáner móvil en el selector real del archivo enviado.
- Solicita la máxima resolución fotográfica que expone la cámara y elimina el zoom variable.
- Recorta en coordenadas nativas sin reescalar y conserva un margen técnico para no cortar esquinas.
- Muestra antes del envío el recorte exacto junto con sus dimensiones nativas y útiles.

## 0.3.0 — 2026-09-14

- Captura fotografías nativas del sensor mediante `ImageCapture` cuando el móvil lo permite.
- Añade zoom real de cámara con valor inicial 1,5× y evita diferencias entre vista previa y archivo enviado.
- Detecta automáticamente la dirección IPv4 privada de la estación y renueva el certificado de servidor cuando cambia.
- Conserva una configuración manual para equipos con varias redes o VPN.
- Formaliza las actualizaciones Windows sobre la instalación existente, sin desinstalación previa.

## 0.2.1 — 2026-09-14

- Corrige el falso rechazo de CNIE horizontales capturadas en encuadres verticales.
- Combina evidencia de bordes en luminancia y color con la máscara y los heatmaps de DocQuadNet.
- Rechaza de forma conservadora escenas ambiguas con varios rectángulos.
- Corrige la conversión de coordenadas al refinar cuadriláteros en imágenes reducidas.
- Añade códigos de recaptura accionables y pruebas de regresión sin datos personales.
