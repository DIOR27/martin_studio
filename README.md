# MARTIN Studio

MARTIN Studio es una extension para Visual Studio Code para editar proyectos MARTIN de forma visual.

Abre una pagina Python del proyecto, muestra su estructura en un canvas, permite modificar widgets y propiedades, revisar codigo relacionado y guardar cambios al archivo fuente.

## Incluye

- apertura directa desde archivos `.py`
- canvas visual con drag & drop
- palette de widgets con busqueda
- inspector de propiedades
- reordenacion de widgets dentro del editor
- vistas de `Frontend`, `Backend` y `Design JSON`
- preview en el navegador interno de VS Code
- control de `martin run`
- selector de assets para `Image` y `Video`
- guardado con `Save to source`

## Uso

1. Abre esta carpeta en VS Code.
2. Pulsa `F5`.
3. En la ventana `Extension Development Host`, abre tu proyecto MARTIN.
4. Abre una pagina como `pages/home.py`.
5. Usa `Open in MARTIN Studio`.

## Configuracion

- `martinStudio.frameworkPath`
- `martinStudio.pythonPath`
- `martinStudio.previewBaseUrl`

## Estado

Version actual: `0.1.0`

Es una version temprana, pero ya sirve para trabajar visualmente con paginas MARTIN reales.
