# VIS Nexo — una instancia, varias identidades

## Qué se comparte

Cuando elegís la misma **instancia instalada** desde dos cuentas VIS Nexo de la misma computadora, el juego debe recibir el mismo directorio de datos (`--gameDir` en Java, `--game-dir` y `--home` en Horizon). Esto conserva los mundos en `saves/`, el listado de servidores `servers.dat`, los ajustes `options.txt` / `optionsof.txt`, las pantallas de introducción y los resource packs/shaders de esa instancia.

La identidad Minecraft **no** se comparte: el nickname local del perfil activo o el nombre/UUID Premium verificado por Microsoft se pasan de manera independiente. Los tokens Microsoft permanecen bajo la protección del launcher. La cuenta offline no obtiene autenticación premium ni acceso a servidores `online-mode`.

En el editor de la instancia, `Compartir los datos de esta instancia entre cuentas` está habilitado de forma predeterminada, también al abrir configuraciones anteriores sin este campo. Puede deshabilitarse expresamente para volver a usar una carpeta de juego independiente por visitante.

**No** es una sincronización en la nube ni hace aparecer instancias de otro dispositivo: esta función unifica el contenido de la misma instalación local.

## Recuperar mundos de versiones anteriores

VIS 2.19-2.21 podía crear carpetas privadas por cuenta bajo `.vis/players/<visitante>/<propietario>/<proyecto>/<instancia>/`, o bajo `shared-player-data/`. Los archivos de estos perfiles **no** se borran.

1. Iniciar VIS con la cuenta que tenía los datos privados.
2. Abrir **Instancias**, buscar la instalación marcada como `Instalada por ...`.
3. Elegir **Recuperar datos antiguos**, revisar la cantidad de mundos/recursos y confirmar.
4. VIS copiará `saves/`, `resourcepacks/`, `shaderpacks/`, `servers.dat`, `options.txt` y `optionsof.txt` solo cuando sus nombres todavía no existan en el destino.
5. Si ya existe un mundo llamado igual, o ya hay `servers.dat`, **no reemplazar**: se mantiene la versión de la carpeta principal y la antigua queda disponible en su ubicación original para revisión manual.

Es una copia explícita, no una fusión inteligente de dos archivos NBT de servidores ni una migración destructiva. No ejecutar a la vez dos Minecraft que usen los mismos mundos; el launcher impide dos lanzamientos simultáneos dentro del mismo proceso.

## Qué se debe comprobar

- Instancia Java Vanilla y Fabric: A crea mundo y añade servidor; B abre la **misma instancia** y ve ambos, sin repetir onboarding; B modifica servidor y vuelve a A, que mantiene el cambio.
- Horizon 26.3: misma prueba con sesiones offline y Premium autorizadas, sin heredar tokens.
- Instalaciones anteriores: recuperar un mundo del visitante y comprobar que no sobreescribe otro con nombre igual.
- Carpeta de resource packs en Dolphin (CachyOS AppImage) y Explorer (Windows).
- Lanzamientos simultáneos dentro de VIS: el segundo se rechaza con un mensaje claro.
- Sesiones con mods que escriben estado por usuario: revisar la ubicación de datos privados sensibles; el contenido común de `config/` y `.vis/` no equivale a una credencial compartible.
- Dos ejecuciones separadas del launcher y recuperación ante cierre forzado: requieren pruebas adicionales, ya que el bloqueo actual es por proceso.

El diseño protege los mundos antiguos contra eliminación automática. La compilación aprobada no sustituye pruebas funcionales con juegos reales.
