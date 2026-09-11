# OTAA_FOLEY 👣

**Foley Recorder · Oficios y Técnicas de las Artes Audiovisuales · Cátedra Corti**

OTAA_FOLEY es una herramienta web para **practicar, grabar, revisar y editar Foley sincronizado con video** desde el navegador.

Está pensada para el trabajo pedagógico: permite experimentar con combinaciones de **calzado + superficie**, registrar pasos sobre un video y editar después su posición, nivel y combinación antes de exportar un WAV.

No requiere instalación ni dependencias externas. Funciona con JavaScript nativo y Web Audio API.

## Flujo de trabajo

**VIDEO → SELECCIÓN → GRABACIÓN → REPRODUCCIÓN → EDICIÓN → WAV**

### 1. Cargar un video

Usá **+ Video** o la zona de carga. Una vez cargado, aparecen el video, el timecode y la timeline.

### 2. Seleccionar calzado y superficies

La biblioteca incluye:

- Botas
- Zapatillas
- Tacos
- Descalzo

Se pueden combinar una o más superficies y ajustar individualmente su nivel.

### 3. Probar antes de grabar

**REPRODUCCIÓN** funciona aunque todavía no haya eventos grabados: reproduce y pausa el video desde la posición actual del playhead. Así se pueden probar las combinaciones con el botón grande de disparo sin crear eventos.

### 4. Grabar Foley

Al pulsar **GRABAR**, el video comienza desde la posición actual. Cada disparo crea una instrucción en la timeline.

La grabación es **incremental**: iniciar una nueva pasada no borra los eventos ya registrados en la misma sesión.

La tecla **Espacio** se utiliza durante la grabación para disparar la combinación seleccionada.

Cada evento conserva:

- posición temporal;
- calzado;
- superficies;
- nivel general;
- nivel de cada superficie;
- índice del sample utilizado por cada capa.

### 5. Selección aleatoria de samples

Cada combinación de **calzado + superficie** dispone de un **shuffle-bag independiente**.

El sistema:

- utiliza todos los samples disponibles antes de repetir;
- evita repetir inmediatamente el último sample al comenzar una nueva ronda;
- mantiene una secuencia independiente para cada combinación;
- guarda en cada evento el sample realmente utilizado para que la reproducción y la exportación sean deterministas.

Al cambiar el calzado o las superficies de un grupo de instrucciones, los eventos editados vuelven a tomar samples mediante el mismo shuffle-bag de la nueva combinación. No se expone un selector manual de sample en la edición de grupo.

### 6. REPRODUCCIÓN

**REPRODUCCIÓN** es el único control de transporte.

- Sin eventos: reproduce y pausa únicamente el video.
- Con eventos: reproduce y pausa video + Foley.
- Comienza siempre desde la posición actual del playhead.
- Detener conserva la posición alcanzada.

## Timeline

La timeline permite revisar y corregir la interpretación.

### Selección individual y edición

Un **click sobre un evento** lo selecciona y abre su menú.

Un **click sostenido y arrastre** sobre el evento permite editarlo directamente:

- arrastre horizontal → cambia la posición temporal;
- arrastre vertical → cambia el volumen general del evento.

La dirección inicial del movimiento determina el parámetro que se edita.

El volumen también puede modificarse desde el fader del menú del evento.

El botón **⇄** permite cambiar la combinación de un evento conservando su posición temporal, identidad y nivel general.

### Selección múltiple

Arrastrando sobre una **zona vacía de la timeline** se crea una selección temporal. Todos los eventos incluidos en ese rango quedan resaltados para que sea evidente cuáles están seleccionados.

Cuando existe una selección aparecen las herramientas de grupo para:

- ajustar el volumen del grupo;
- cambiar calzado y superficies;
- limpiar la selección.

También se puede usar **Supr** o **Backspace** para borrar las instrucciones seleccionadas.

### Cambio de combinación en grupo

**CAMBIAR GRUPO** permite modificar simultáneamente las instrucciones seleccionadas.

Se puede cambiar:

- calzado;
- una o más superficies;
- nivel de cada superficie.

El sistema conserva el tiempo y el volumen de cada evento. Al aplicar una nueva combinación, cada evento recibe el siguiente sample correspondiente a esa combinación mediante el shuffle-bag compartido con el sistema de grabación.

### Zoom

La timeline tiene zoom progresivo hasta **128×**.

Los controles de zoom mantienen enfocada la posición del evento seleccionado o, en su defecto, el playhead. El zoom con rueda sigue la posición del cursor.

### Undo / Redo

- **Ctrl/Cmd + Z** → deshacer
- **Ctrl/Cmd + Shift + Z** → rehacer
- **Ctrl/Cmd + Y** → rehacer

El historial cubre las principales operaciones de edición de la sesión.

## Motor de audio

El audio se gestiona mediante **Web Audio API**.

El sistema:

- carga y decodifica los WAV;
- mantiene los samples en caché;
- precarga las capas necesarias;
- reproduce las capas seleccionadas simultáneamente;
- conserva el sample usado por cada evento;
- renderiza offline para exportación.

Si un WAV no puede cargarse, existe un fallback sintético procedural.

## Exportación WAV

La exportación genera un **WAV estéreo PCM de 48 kHz / 16 bits**.

Los archivos se numeran consecutivamente y se descargan con nombres como:

`Foley Recorder OTAA 1.wav`

`Foley Recorder OTAA 2.wav`

`Foley Recorder OTAA 3.wav`

La numeración se conserva en el navegador mediante almacenamiento local.

## Uso en smartphones

La interfaz es responsive y la biblioteca dispone de desplazamiento táctil. Los gestos de swipe en la biblioteca no deberían activar accidentalmente los botones.

La timeline utiliza interacción mediante pointer events para unificar mouse y touch.

## Estructura de archivos

```text
OTAA_FOLEY/
├── index.html
├── style.css
├── credits.css
├── enhancements.css
├── timeline-ui.css
├── app.js
├── audio.js
├── mobile-fix.js
├── enhancements.js
├── final-fixes.js
├── interaction-polish.js
├── group-edit.js
├── runtime-fixes.js
├── reliable-trigger.js
├── punch-in-removal.js
├── library.json
├── README.md
└── samples/
```

`workflow-guard.js` y `rehearsal-playback.js` se conservan en el repositorio por compatibilidad histórica, pero ya no participan del flujo cargado por `index.html`.

`punch-in-removal.js` forma parte de la capa de compatibilidad y elimina cualquier control de Punch-In legado. El flujo actual utiliza únicamente **GRABAR / DETENER / REPRODUCCIÓN / WAV**.

## Funciones pendientes

Se mantienen fuera de esta versión las funciones más cercanas a un DAW, entre ellas:

- exportación directa de sesión para Reaper;
- waveform del audio original del video;
- múltiples tracks;
- perspectiva / distancia sonora;
- presets;
- microvariaciones temporales;
- optimizaciones avanzadas de precarga.

## Deploy en GitHub Pages

En GitHub:

**Settings → Pages → Source: `main / (root)`**

## Autoría

**Diseñado y creado por Ramiro N. Alvarez · con herramientas de IA.**
