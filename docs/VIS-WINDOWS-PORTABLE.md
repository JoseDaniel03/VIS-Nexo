# VIS Nexo para Windows — portable, sin instalador

## Para jugadores

La distribución principal de **Windows 10/11 x64** es un paquete **ZIP portable**.

1. Descargar `vis-nexo-windows-portable` desde **Actions → VIS Nexo Native Build → Artifacts** o `VIS-Nexo-Windows-x64-Portable.zip` desde una versión oficial de **Releases**.
2. Extraer **todo** el contenido a una carpeta propia, por ejemplo `C:\\Juegos\\VIS Nexo\\`.
3. Hacer doble clic en **`VIS Nexo.exe`**. No abrir `horizon-client.exe` ni `horizon-prepare.exe`.
4. Mantener la carpeta `horizon/` al lado del ejecutable. Contiene el juego Rust compilado y su manifiesto de integridad.
5. Para actualizar, cerrar VIS Nexo y sustituir los archivos del programa por el ZIP nuevo, conservando instalaciones y mundos.

**No hay setup.exe, asistente NSIS, MSI ni cambios de registro exigidos por VIS Nexo.** El frontend está incluido en el ejecutable de Tauri. No hay que instalar Rust, Node.js ni herramientas de desarrollo.

**Dependencias del sistema:** Tauri utiliza **Microsoft Edge WebView2 Runtime**, que normalmente ya existe en instalaciones modernas de Windows 10/11. Si Windows no tiene ese componente, es necesario instalarlo desde Microsoft. Windows SmartScreen puede mostrar advertencias con binarios sin certificado Authenticode. No se debe desactivar la protección del equipo para usar el programa.

**Datos y mundos:** la carpeta extraída contiene solo la aplicación y los recursos oficiales compilados. Las cuentas, configuraciones, instancias y mundos siguen en las rutas de datos del usuario gestionadas por VIS Nexo; el ZIP no los incluye ni los borra. Por esta razón, `portable` significa **sin instalador**, no necesariamente que los mundos viajen en un pendrive con el ejecutable.

**Actualizaciones:** la edición portable trae el marcador `.vis-portable`, que **deshabilita el actualizador de instaladores NSIS**. Por ahora se actualiza sustituyendo la carpeta completa con la aplicación cerrada.

## Para desarrollo y CI

Después de `npm run horizon:source` y `npm run horizon:verify`:

```powershell
npm ci
npm run build -- --no-bundle --config src-tauri/tauri.unsigned.json
python tools/package_windows_portable.py
```

Se producen:

- `target/release/portable/app/VIS Nexo.exe` y `target/release/portable/app/horizon/*` (carpeta para el artefacto de Actions, sin ZIP anidado).
- `target/release/portable/VIS-Nexo-Windows-x64-Portable.zip` (para versiones oficiales).

El script exige un ejecutable PE, verifica SHA-256 de los recursos Horizon compilados a partir del repositorio oficial y valida que el ZIP contiene todos los archivos obligatorios. Incluye DLLs existentes en el directorio de compilación y se niega a empaquetar enlaces simbólicos.

Pruebas independientes de generación de paquetes:

```powershell
python tools/test_windows_portable.py
```

En Linux se siguen ofreciendo AppImage y DEB. En Windows **no se genera un instalador** en la compilación CI ni en los releases etiquetados.

La compilación y las comprobaciones estáticas no sustituyen probar manualmente en una máquina real con Windows 10/11, WebView2 y una instalación real de Minecraft Java.
