# Plantillas DOCX: creación, validación y versionado

Referencia vigente: matrimonio `1.7.0`, herencia `1.5.1`, generador `0.8.0-alpha.3`. Herencia 1.5.1 añade caducidad CNIE a testigos; 1.5.0 permanece archivada sin cambios. Complementa la [documentación integral](DOCUMENTACION_FASE1.md). Las versiones históricas conservan sus capacidades y hashes; no se actualizan silenciosamente.

## Paquete de plantilla

La versión vigente de cada plantilla vive en `src/cnie_documents/templates/<nombre>/` y contiene `template.docx`, `manifest.json` y `legal.txt`. Una versión todavía referenciada por expedientes se conserva de forma inmutable en `<nombre>-v<versión>/`; el catálogo selecciona la SemVer más alta para nuevas operaciones y resuelve la versión exacta para expedientes existentes. Los recursos visuales compartidos se conservan en `src/cnie_documents/assets/`. El manifiesto `enotario.document-template/v2` fija un identificador estable, una versión SemVer, roles, campos de formulario, cardinalidades, enlaces y los SHA-256 del DOCX y del texto jurídico normalizado. El catálogo conserva lectura de v1 para migraciones controladas.

`legal.txt` es la referencia revisable del texto jurídico. Los `.doc` históricos no se empaquetan. Cualquier cambio jurídico exige nueva aprobación humana, actualización del archivo normalizado, reconstrucción del DOCX y aumento de versión. Un cambio de composición sin cambio jurídico también genera una versión nueva para que las solicitudes existentes permanezcan fijadas.

Un campo repetible que describe a las personas de un rol declara `"role": "<clave>"`. Sus índices deben cubrir exactamente la capacidad máxima del rol. El expediente conserva sus valores por identidad, no por posición visible; un cliente debe enviar la asignación utilizada al editarlo y el motor rechaza contextos obsoletos.

## Etiquetas y enlaces

- Las regiones automáticas usan `enotario.<rol>.<índice>.<campo>` y deben aparecer una sola vez, salvo enlaces adicionales declarados explícitamente dentro del cuerpo jurídico.
- Las regiones jurídicas usan `manual.*`: en parcial quedan para Word; en completo solo se rellenan las declaradas como campos de formulario mediante enlaces del manifiesto. Cualquier región no declarada sigue sin gestionarse automáticamente.
- Los grupos repetibles declaran todos los índices `1..12`; no se clonan regiones durante la generación.
- `prefix` y `suffix` permiten añadir puntuación determinista únicamente cuando un control recibe valor; se usan, por ejemplo, para separar herederos sin dejar comas huérfanas.
- Solo se admiten fuentes CNIE declaradas. Las transformaciones válidas son texto, unión ordenada, fecha ISO, mapas cerrados y composición árabe `person_ar` con variantes de género sin título. El nombre interno histórico `date_dmy` se conserva, pero la salida vigente de fechas es `AAAA/MM/DD` con cifras normales 0–9 y marcas invisibles LRM para conservar el orden en RTL.
- `person_ar` utiliza nombre, filiación, nacimiento, CIN, domicilio y sexo, añadiendo validez cuando sus fuentes declaran `expiry_date`. La filiación aprobada se trata como un valor indivisible: no separa progenitores ni introduce una segunda `و`, y evita duplicar un prefijo inicial `ابن` o `بنت`. En matrimonio, la gramática masculina o femenina procede del rol asignado; reutilizar una identidad en roles distintos muestra advertencia.
- Los límites `maximum_characters` forman parte del contrato y bloquean la generación antes de deformar el documento.

Los controles deben ser editables, tener apariencia Word `hidden` y mostrar un contenido vacío cuando están sin asignar. El operador puede completar en Word tanto controles automáticos no usados como regiones `manual.*`.

Los controles rellenados preservan espaciado con el texto contiguo. Los mínimos actuales son cero: matrimonio, esposo/esposa/padre de la esposa 0–1; herencia, solicitante 0–1, herederos/testigos 0–12. Los datos recomendados faltantes avisan sin bloquear, pero máximos, formato, identidades aprobadas, revisión e integridad siguen siendo condiciones obligatorias.

Los enlaces de matrimonio y solicitante/herederos de herencia incluyen la validez después del CIN. El patrón de testigos de herencia todavía no declara `expiry_date`; se registra esta discrepancia antes de distribución, sin afirmar que la cláusula esté presente universalmente. El causante no tiene rol CNIE; es campo jurídico manual. `heir_relation` es texto introducido por heredero, no cálculo de cuotas sucesorias.

## Fidelidad al original

Los `.doc` históricos son la autoridad de estructura y secuencia jurídica, aunque no se distribuyan. Antes de crear o revisar una plantilla se convierten copias de trabajo a DOCX, se extraen todos sus párrafos, tablas y encabezados, y se renderiza cada página. El cuerpo no se reorganiza para presentar los datos como fichas o tablas.

- Matrimonio conserva aleya, bloque institucional, título, registro y un único párrafo jurídico. Esposo, esposa y padre de la esposa se rellenan dentro de los huecos originales; la madre no es un rol independiente.
- Herencia conserva un único párrafo jurídico. Los herederos se insertan en el hueco inmediatamente posterior a `فأحاط بإرثه`; la lista posterior a `شهد بذلك السادة` corresponde a los testigos.
- No se añaden rótulos como `الورثة` o `الشهود` si no existen en el original.
- La única tabla admitida en el modelo actual es la tabla sin bordes usada para estabilizar el encabezado de tres zonas; el cuerpo no contiene tablas visibles.
- La primera página usa su arte `p1` y las páginas de continuación usan `p2`, empaquetados dentro del DOCX sin relaciones externas y con 5 mm de resguardo para impresión. La versión matrimonial 1.7.0 usa como `p1` la imagen corregida `template_zawaj-p2-v2.png`: conserva el encabezado, escudo, título, ornamentos y pie, pero deja la aleya vacía. La aleya exacta indicada por el usuario se compone como texto Unicode editable en el encabezado Word, con escritura compleja RTL y signos coránicos; también figura como texto OOXML oculto en el cuerpo para la comprobación de integridad jurídica. Su fuente es **Amiri Quran 1.003**, diseñada para composición coránica y embebida en el DOCX como parte OOXML ofuscada; no requiere instalación de la fuente en Windows. La fuente original y su licencia OFL-1.1 se conservan en `src/cnie_documents/assets/fonts/`. Es una alternativa tipográfica coránica, no la fuente oficial del Complejo Rey Fahd. El resto del cuerpo jurídico y los controles de datos siguen editables.

El recurso gráfico inicial procede del [escudo de Royaume du Maroc facilitado para el proyecto](https://images.seeklogo.com/logo-png/30/2/royaume-du-maroc-kingdom-of-morocco-logo-png_seeklogo-309860.png). Se guarda localmente para que la generación sea reproducible y no realice accesos de red.

## Construcción

La reconstrucción de los dos pilotos se realiza con:

```powershell
C:\Users\aboul\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\build-document-templates.py
```

El script produce identificadores OOXML estables derivados de SHA-256. Después se copian los hashes impresos a los manifiestos. El catálogo debe cargar sin excepciones y una segunda construcción debe producir los mismos hashes.

## Reglas de rechazo

El catálogo rechaza macros, ActiveX, OLE, relaciones externas, comentarios, cambios pendientes, rutas ZIP inseguras, etiquetas desconocidas, controles duplicados, manifiestos incoherentes, hashes incorrectos y paquetes descomprimidos desproporcionados. La generación elimina autor y última persona modificadora, y conserva únicamente `eNotarioTemplate` y `eNotarioGenerator` como propiedades no personales.

## QA obligatoria

Antes de publicar una versión:

1. Ejecutar todas las pruebas Python y TypeScript.
2. Generar fixtures sintéticos mínimos y máximos.
3. Renderizar cada DOCX con `render_docx.py`. Si falta su dependencia LibreOffice, registrar el impedimento y renderizar con Microsoft Word/exportación PDF y rasterización, sin afirmar una ejecución del renderer que no se produjo.
4. Inspeccionar todas las páginas: A4, RTL, cortes, solapes, encabezado, escudo, márgenes y legibilidad; confirmar que el cuerpo conserva la secuencia del original y no contiene tablas añadidas.
5. Abrir los pilotos en Microsoft Word para comprobar edición de controles, guardado y paginación.
6. Obtener aprobación del texto y del render final por una persona jurídicamente responsable.

La aprobación jurídica es un gate humano de producción; las pruebas automáticas detectan cambios accidentales, pero no sustituyen ese dictamen.

El 17 de septiembre de 2026, Microsoft Word 16.0.20326.20144 abrió y exportó los cuatro fixtures sintéticos de mínimo y máximo. La inspección de sus cinco páginas confirmó `p1` en todas las primeras páginas, `p2` solo en la segunda página de herencia máxima y ausencia de cortes, solapes, glifos ausentes o desbordamientos. Word informó 13 controles editables y documento sin protección en matrimonio, y 49 controles editables y documento sin protección en herencia. La edición manual por el operador y la aprobación jurídica continúan siendo gates separados.

Tras los cambios finales se renderizaron otra vez los dos fixtures completos con fechas `AAAA/MM/DD`; no se observaron cortes ni solapes. `render_docx.py` no pudo completar por falta de `soffice.exe`; la alternativa ejecutada fue Word y Poppler. La evidencia acredita ese entorno, no todas las versiones de Word ni la aprobación jurídica.
