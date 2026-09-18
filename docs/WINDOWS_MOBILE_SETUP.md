# Instalación Windows y captura móvil en la oficina

## 1. Preparar el PC

e-notario detecta al arrancar la IPv4 privada utilizada por la ruta activa. Genera el certificado HTTPS automáticamente y muestra la dirección efectiva en **Dispositivos**. Si la IP cambia, renueva únicamente el certificado del servidor y conserva la autoridad certificadora de la oficina.

Para que la dirección sea predecible, asigne al PC una reserva DHCP en el router. Si existen varias redes activas o una VPN y Windows no puede determinar una ruta inequívoca, la aplicación muestra el campo manual como respaldo.

En un entorno de desarrollo puede ejecutar la operación equivalente desde PowerShell:

```powershell
.\.venv\Scripts\python.exe -m cnie_capture setup-lan --ip 192.168.1.50
```

Sustituya el ejemplo por la IP real. También puede inspeccionar la selección automática con `python -m cnie_capture detect-lan`. La configuración crea:

- una autoridad certificadora de oficina válida durante dos años;
- un certificado HTTPS del servidor válido durante 90 días;
- la configuración local en `%LOCALAPPDATA%\e-notario-v2`.

Los archivos `office-ca.key` y `server.key` son privados: deben quedarse en ese PC, protegidos por la cuenta de Windows y por las copias de seguridad autorizadas. Solo `office-ca.crt` se distribuye a los teléfonos.

## 2. Autorizar el puerto en Windows

Permita TCP `8788` únicamente en el perfil **Privado** de Windows Defender Firewall. No lo habilite en perfiles Público o Dominio salvo que TI haya definido una política equivalente. El puerto `8787` debe permanecer limitado a `127.0.0.1` y nunca exponerse en la red.

En un despliegue empresarial, TI debe distribuir esta regla mediante Intune, GPO o su herramienta de administración y limitar el alcance a la subred de la oficina.

## 3. Confiar la CA pública en móviles administrados

Copie solo `%LOCALAPPDATA%\e-notario-v2\tls\office-ca.crt` mediante el canal interno aprobado.

- **iPhone/iPad**: instale el perfil y active la confianza completa para la CA en Ajustes > General > Información > Ajustes de confianza de certificados.
- **Android administrado**: instale el certificado como CA para aplicaciones desde el perfil de trabajo/MDM. La ruta exacta depende del fabricante y de la política corporativa.

No instale esta CA en dispositivos personales. Elimine el perfil si un teléfono deja de pertenecer al equipo.

## 4. Emparejar y capturar

1. Reinicie e-notario después de configurar la LAN.
2. Compruebe que PC y móvil están en la misma Wi-Fi de oficina y sin aislamiento entre clientes.
3. En la estación Windows, genere el QR.
4. Escanéelo con el teléfono autorizado y confirme el emparejamiento.
5. Conceda permiso de cámara solo al sitio HTTPS mostrado.

El código QR es de un solo uso y expira a los 120 segundos. Cada móvil recibe una sesión separada de cuatro horas; el puesto admite hasta ocho. Desde 0.8.0, imágenes, OCR y trabajo temporal se conservan cifrados bajo la cuenta Windows durante su retención de 24 horas y pueden recuperarse al reiniciar: cerrar la app no los destruye inmediatamente. Las identidades aprobadas caducan 24 horas desde aprobación.

Antes de capturar, seleccione «CNIE 2020» o «CNIE antigua»; la elección queda fijada para ambas caras. La imagen válida se acepta automáticamente, pero los 14 datos deben revisarse y aprobarse expresamente. El móvil solo ve sus recursos y prepara documentos; Windows genera, guarda y abre Word. Use «Conservar identidad y liberar imágenes» después de aprobar o «Limpiar sesión» en Windows para eliminar los temporales. Esta limpieza no elimina perfiles, configuración ni DOCX guardados por el operador. Consulte la [documentación integral](DOCUMENTACION_FASE1.md).

## 5. Rotación y diagnóstico

El servicio renueva el certificado HTTPS si quedan menos de 14 días de validez o si cambia la dirección detectada. La CA pública se reutiliza mientras siga vigente, por lo que normalmente no hay que reinstalarla en los teléfonos.

Si la cámara no aparece:

- abra manualmente `https://IP_DEL_PC:8788/capture/` y confirme que no hay advertencia de certificado;
- verifique fecha y hora del PC y del móvil;
- confirme que la IP coincide con el certificado y con `lan.json`;
- compruebe la regla de firewall y que la Wi-Fi no aísla clientes;
- regenere el QR: un enlace usado o caducado no vuelve a ser válido.

Si el PC se pierde o se sospecha que la clave privada salió de control, elimine la CA de todos los móviles, retire `%LOCALAPPDATA%\e-notario-v2\tls` mediante el procedimiento de TI y genere una autoridad nueva.
