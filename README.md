# OTAA_FOLEY 👣

**Foley Recorder · Oficios y Técnicas de las Artes Audiovisuales · Cátedra Corti**

OTAA_FOLEY es una herramienta web para **practicar, grabar y editar Foley sincronizado con video** desde el navegador.

La herramienta está pensada especialmente para el trabajo pedagógico: permite experimentar rápidamente con distintas combinaciones de **calzado + superficie**, dispararlas mientras se reproduce una imagen y construir una sesión de eventos sonoros que luego puede revisarse, editarse y exportarse como WAV.

No requiere instalación ni dependencias externas. Funciona con JavaScript nativo y Web Audio API.

---

## ¿Cómo funciona?

El flujo básico es:

**VIDEO → SELECCIÓN → ENSAYO → GRABACIÓN → TIMELINE → ESCUCHA → EDICIÓN → WAV**

### 1. Cargar un video

Se puede cargar un archivo de video mediante el botón **+ Video** o seleccionándolo desde la zona de carga.

Una vez cargado, la aplicación muestra el video, el timecode y la timeline.

### 2. Elegir el calzado

En la biblioteca se selecciona un tipo de calzado, por ejemplo:

- Botas
- Zapatillas
- Tacos
- Descalzo

La selección queda visible en el bloque **SELECCIÓN** para que la combinación activa siempre sea clara.

### 3. Elegir una o más superficies

Las superficies funcionan como capas. Se puede seleccionar una sola o combinar varias, por ejemplo:

**Botas + Agua + Hojas**

Cada superficie tiene un fader individual de nivel. Esto permite construir una combinación de Foley con diferentes proporciones de textura y presencia.

La selección activa también se refleja en el botón principal de disparo.

### 4. Modo ENSAYO

**ENSAYO** permite probar las combinaciones sin crear eventos en la timeline.

Los botones reproducen los sonidos normalmente, pero los disparos no quedan registrados.

Es útil para:

- encontrar una combinación adecuada;
- probar niveles de superficie;
- familiarizarse con la relación entre imagen y sonido;
- preparar la interpretación antes de grabar.

### 5. Modo GRABACIÓN

En **GRABACIÓN**, cada disparo realizado mientras avanza el video genera un evento en la timeline.

También se puede utilizar la tecla **Espacio** para disparar la combinación seleccionada.

Cada evento conserva:

- posición temporal;
- combinación de calzado y superficies;
- nivel general del evento;
- nivel individual de cada capa;
- sample utilizado en cada capa.

### 6. Timeline

La timeline muestra los eventos registrados y el playhead del video.

Incluye:

- zoom;
- navegación temporal;
- selección de eventos;
- movimiento horizontal de eventos para corregir sincronía;
- modificación vertical del nivel del evento;
- información del playhead;
- cantidad de eventos;
- información detallada del evento seleccionado.

Al seleccionar un evento se muestra información adicional sobre sus capas y niveles.

El nivel general se presenta tanto como porcentaje como en dB aproximados.

### 7. Escucha / Preview

**▶ ESCUCHAR** reproduce el resultado a partir de la posición actual del video.

La reproducción utiliza los samples que quedaron registrados en cada evento, por lo que el resultado del preview coincide con la sesión grabada.

### 8. Undo / Redo

La timeline dispone de **↶ Deshacer** y **↷ Rehacer**.

También funcionan los atajos:

- **Ctrl/Cmd + Z** → deshacer
- **Ctrl/Cmd + Shift + Z** → rehacer
- **Ctrl/Cmd + Y** → rehacer

El historial contempla las principales modificaciones de la sesión, entre ellas:

- creación de eventos;
- eliminación de eventos;
- movimiento temporal;
- cambios de ganancia;
- cambios de combinación de un evento;
- operaciones de Punch-in.

El historial pertenece a la sesión actual y se reinicia al cargar un video nuevo.

### 9. Punch-in

**PUNCH-IN** permite volver a trabajar únicamente sobre una parte de la sesión.

Se define un punto **IN** y un punto **OUT**, en segundos, y luego se utiliza **GRABAR**.

El comportamiento es de reemplazo del segmento: los eventos que se encuentren dentro del rango indicado se eliminan y pueden volver a grabarse.

Los botones **←** permiten tomar rápidamente la posición actual del video como IN u OUT.

Por ejemplo:

**IN 12.50 s → OUT 18.00 s**

Esto permite corregir una sección sin tener que reconstruir toda la sesión.

---

## Selección aleatoria de samples

Cada combinación de **calzado + superficie** dispone de varios samples.

El motor realiza una **selección aleatoria sin repetición inmediata**, evitando que el mismo archivo se reproduzca dos veces consecutivas dentro de una misma combinación.

El sample utilizado queda registrado en el evento. De esta manera, el preview y el render final pueden reproducir exactamente la misma elección.

---

## Motor de audio

El audio está gestionado mediante **Web Audio API**.

El sistema:

- carga y decodifica los WAV;
- mantiene los samples en caché;
- reproduce las capas en tiempo real;
- permite niveles individuales por superficie;
- conserva el sample usado en cada evento;
- realiza un render offline para la exportación.

Si un sample no puede cargarse, la herramienta dispone de un **fallback sintético procedural**, de modo que una combinación no queda completamente inutilizada por la ausencia de un WAV.

---

## Exportación WAV

**↓ WAV** genera un render offline del proyecto completo.

La exportación actual es:

- **48 kHz**
- **PCM 16-bit**
- **Stereo WAV**

El archivo final se genera a partir de los eventos registrados y sus parámetros, en lugar de depender de la reproducción en tiempo real.

---

## Uso en smartphones

La interfaz incluye un diseño específico para pantallas pequeñas.

En móvil:

- la biblioteca ocupa el área disponible debajo del video y la timeline;
- las superficies y faders tienen objetivos táctiles mayores;
- la biblioteca dispone de desplazamiento vertical;
- los gestos de swipe no deberían activar accidentalmente botones;
- la timeline permite zoom mediante botones y pinch.

La separación entre **tap** y **swipe** es gestionada por una capa específica de interacción táctil.

---

## Estructura de archivos

```text
OTAA_FOLEY/
├── index.html            ← interfaz principal
├── style.css             ← estilos generales y responsive
├── credits.css           ← crédito del creador
├── enhancements.css      ← estilos de las funciones añadidas
├── app.js                ← interfaz, grabación, timeline y edición
├── audio.js              ← motor Web Audio y render WAV
├── mobile-fix.js         ← comportamiento táctil de la biblioteca
├── enhancements.js       ← selección, timeline, modos, historial y Punch-in
├── workflow-guard.js     ← protecciones de flujo entre modos
├── library.json          ← biblioteca de calzado, superficies y samples
├── README.md             ← documentación
└── samples/              ← archivos WAV de la biblioteca
```

---

## Cómo agregar o reemplazar samples

La biblioteca se define en `library.json`.

Cada superficie declara sus archivos de audio, por ejemplo:

```json
{
  "id": "madera",
  "label": "Madera",
  "emoji": "🪵",
  "color": "#8B5E3C",
  "samples": [
    { "file": "samples/{{fw}}/madera-001.wav", "label": "Paso 1" },
    { "file": "samples/{{fw}}/madera-002.wav", "label": "Paso 2" },
    { "file": "samples/{{fw}}/madera-003.wav", "label": "Paso 3" }
  ]
}
```

`{{fw}}` se reemplaza automáticamente por el identificador del calzado seleccionado.

---

## Flujo pedagógico sugerido

Una forma de trabajar la herramienta en clase es:

**1. Ensayo**

Explorar diferentes combinaciones de calzado y superficies sin registrar eventos.

**2. Grabación**

Elegir una combinación y ejecutar el Foley siguiendo la imagen.

**3. Revisión**

Escuchar la sesión y observar la relación entre los eventos y el movimiento visual.

**4. Edición**

Mover eventos, corregir niveles, cambiar combinaciones y utilizar Undo/Redo cuando sea necesario.

**5. Corrección localizada**

Utilizar Punch-in para volver a grabar un fragmento específico.

**6. Exportación**

Generar el WAV final para continuar el trabajo en un DAW.

---

## Funciones actuales

- ✅ Carga de video local
- ✅ Biblioteca de calzado
- ✅ Selección múltiple de superficies
- ✅ Fader individual por superficie
- ✅ Selección aleatoria sin repetición inmediata
- ✅ Disparo en tiempo real
- ✅ Tecla Espacio para disparar durante la grabación
- ✅ Modo **Ensayo**
- ✅ Modo **Grabación**
- ✅ Timeline con zoom y navegación
- ✅ Edición temporal de eventos
- ✅ Edición de ganancia por evento
- ✅ Información ampliada del evento seleccionado
- ✅ Cambio de combinación de un evento
- ✅ Undo / Redo
- ✅ Punch-in por rango IN / OUT
- ✅ Preview sincronizado
- ✅ Render offline
- ✅ Exportación WAV 48 kHz / 16-bit stereo
- ✅ Interfaz responsive desktop / mobile
- ✅ Manejo táctil para evitar activaciones accidentales durante el scroll
- ✅ Fallback sintético cuando no está disponible un sample
- ✅ Crédito integrado: “Diseñado y creado por Ramiro N. Alvarez · con herramientas de IA.”

---

## Funciones pendientes / posibles futuras versiones

Estas funciones quedan deliberadamente fuera de esta versión para mantener la herramienta enfocada y simple:

- exportación directa de una sesión compatible con Reaper;
- waveform del audio original del video;
- múltiples tracks o categorías de capas;
- perspectiva / distancia sonora;
- presets de combinaciones Foley;
- microvariaciones temporales entre capas;
- optimización avanzada de precarga de samples;
- otras funciones de edición más cercanas a un DAW.

---

## Deploy en GitHub Pages

En GitHub:

**Settings → Pages → Source: `main / (root)`**

La aplicación puede utilizarse directamente desde la URL de GitHub Pages del repositorio.

---

## Autoría

**Diseñado y creado por Ramiro N. Alvarez · con herramientas de IA.**

OTAA_FOLEY forma parte del trabajo de desarrollo de herramientas y recursos para la enseñanza de sonido audiovisual.
