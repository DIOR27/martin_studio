# MARTIN Studio

Extensión inicial para Visual Studio Code que consume el catálogo de widgets de `martin.studio` y ofrece:

- palette visual de widgets
- canvas con drag & drop
- inspector de propiedades
- vista de código generada para MARTIN

## Desarrollo

1. Abre esta carpeta en VS Code.
2. Ejecuta la extensión en modo debug (`F5`).
3. La configuración incluida abre como workspace objetivo `C:\Users\diego\OneDrive\Documentos\Python\martin_framework`.
4. En la ventana de Extension Development Host, lanza el comando `MARTIN Studio: Open Designer`.

## Configuración

La extensión intenta detectar `martin_framework` automáticamente. También puedes fijarlo desde ajustes de VS Code:

- `martinStudio.frameworkPath`
- `martinStudio.pythonPath`

Esto permite desarrollar la extensión fuera del repo principal y seguir consumiendo `martin.studio`.

## Archivo de diseño

La extensión guarda el documento fuente en:

`martin-studio.design.json`

Ese archivo es el estado editable del diseñador. El panel de código genera Python MARTIN a partir de ese árbol.
