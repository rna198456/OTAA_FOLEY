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

La tecla **Espacio** se utiliza exclusivamente durante la grabación para disparar la combinación seleccionada.

Cada evento conserva:

- posición temporal;
- calzado;
- superficies;
- nivel general;
- nivel de cada superficie;
- sample/paso utilizado en cada capa.

### 5. REPRODUCCIÓN

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

### Selección múltiple

Arrastrando sobre una **zona vacía de la timeline** se crea una selección temporal. Todos los eventos incluidos en ese rango quedan resaltados para que sea evidente cuáles están seleccionados.

Cuando existe una selección aparece **BORRAR SELECCIÓN**. También se puede usar **Supr** o **Backspace** para borrar las instrucciones seleccionadas.

### Cambio de combinación / sample

El botón **⇄** del menú del evento abre el editor de combinación.

Desde allí se puede cambiar:

- calzado;
- superficies;
- nivel de cada superficie;
- paso/sample exacto de cada capa.

El evento conserva su **posición temporal, identidad y nivel general** al aplicar los cambios.

### Zoom

La timeline tiene zoom progresivo hasta **128×**.

Los botones de zoom mantienen enfocada la posición del evento seleccionado o, en su defecto, el playhead. El zoom con rueda sigue la posición del cursor.

### Undo / Redo

- **Ctrl/Cmd + Z** → deshacer
- **Ctrl/Cmd + Shift + Z** → rehacer
- **Ctrl/Cmd + Y** → rehacer

El historial cubre las principales operaciones de edición de la sesión.

### Punch-in

**PUNCH-IN** permite reemplazar solamente una parte de la sesión definiendo **IN** y **OUT** en segundos.

## Motor de audio

El audio se gestiona mediante **Web Audio API**.

El sistema:

- carga y decodifica los WAV;
- mantiene los samples en caché;
- reproduce capas en tiempo real;
- conserva el sample usado por cada evento;
- renderiza offline para exportación.

Si un WAV no puede cargarse, existe un fallback sintético procedural.

## Exportación WAV

La exportación genera un **WAV estéreo PCM de 48 kHz / 24 bits**.

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
├── workflow-guard.js
├── rehearsal-playback.js
├── final-fixes.js
├── interaction-polish.js
├── library.json
├── README.md
└── samples/
```

`workflow-guard.js` y `rehearsal-playback.js` se conservan en el repositorio por compatibilidad histórica, pero ya no participan del flujo cargado por `index.html`.

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
