# Foley Recorder v2 👣
**Oficios y Técnicas de las Artes Audiovisuales · Cátedra Corti**

Herramienta web para grabación de Foley sincronizada con video.  
Sin dependencias externas. Vanilla JS puro. Funciona en desktop y mobile.

---

## Flujo de trabajo

1. **Cargá un video** (drag & drop o botón)
2. **Seleccioná una superficie** de la biblioteca
3. **● GRABAR** → el video arranca desde el inicio
4. **Tocá los botones** (o `Espacio` para el último seleccionado) en sincronía
5. **■ DETENER**
6. **▶ ESCUCHAR** → preview del resultado
7. **Editá en la timeline** si necesitás ajustar timing
8. **↓ WAV** → exporta el audio renderizado offline, sin latencia

---

## Estructura de archivos

```
foley-recorder/
├── index.html
├── style.css
├── audio.js         ← motor de audio: síntesis, carga, render offline, encoder WAV
├── app.js           ← UI, grabación, edición, timeline, modal
├── library.json     ← declara las categorías y archivos de samples
├── README.md
└── samples/
    ├── madera/
    │   ├── tablon_01.wav
    │   ├── tablon_02.wav
    │   └── tablon_03.wav
    ├── cemento/
    │   ├── cemento_01.wav
    │   ├── cemento_02.wav
    │   └── cemento_03.wav
    ├── grava/
    │   ├── grava_01.wav
    │   ├── grava_02.wav
    │   └── grava_03.wav
    └── metal/
        ├── metal_01.wav
        └── metal_02.wav
```

---

## Cómo agregar tus samples al servidor

1. Copiá tus archivos WAV en la carpeta correspondiente de `samples/`
2. Editá `library.json` y declaralos:

```json
{
  "id": "madera",
  "label": "Madera",
  "emoji": "🪵",
  "color": "#8B5E3C",
  "samples": [
    { "file": "samples/madera/paso_a.wav", "label": "Paso A" },
    { "file": "samples/madera/paso_b.wav", "label": "Paso B" },
    { "file": "samples/madera/paso_c.wav", "label": "Paso C" }
  ]
}
```

El motor usa **round-robin automático**: cada vez que disparás esa superficie,
rota entre los archivos declarados para evitar el efecto de "máquina de coser".

Si un archivo no se encuentra (HTTP 404), la app cae automáticamente al
sintetizador procedural WebAudio — así siempre funciona aunque falten WAVs.

---

## Deploy en GitHub Pages

```bash
git init
git add .
git commit -m "init: foley recorder v2"
git remote add origin https://github.com/TU_USUARIO/foley-recorder.git
git push -u origin main
```

En GitHub → Settings → Pages → Source: `main / (root)` → Save.

URL resultante: `https://TU_USUARIO.github.io/foley-recorder/`

> **Nota CORS:** GitHub Pages sirve los archivos con los headers correctos.
> Si usás otro servidor, asegurate de que los WAV se sirvan con
> `Access-Control-Allow-Origin: *` para que el AudioContext pueda decodificarlos.

---

## Features de edición en timeline

- **Click** sobre un impulso → lo selecciona (aparece tooltip)
- **Drag** horizontal → mueve el evento en el tiempo
- Tooltip **⇄** → abre modal para cambiar la superficie
- Tooltip **✕** (o `Delete`/`Backspace`) → elimina el evento
- Click en área vacía → deselecciona / busca en el video
- `Escape` → cierra tooltip y modal

---

## Round-robin

El sistema mantiene un contador por categoría. Cada disparo avanza el contador,
rotando entre todos los archivos declarados.

El índice exacto usado en cada disparo se guarda en el evento, de modo que el
render offline reproduce **exactamente** el mismo sample que sonó durante la grabación.

---

## Compatibilidad

| Feature | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|
| Video drag & drop | ✅ | ✅ | ✅ | ✅ |
| Web Audio / OfflineAudioContext | ✅ | ✅ | ✅ | ✅ |
| Export WAV 16-bit | ✅ | ✅ | ✅ | ✅ |
| Touch / Mobile | ✅ | ✅ | ✅ | ✅ |

---

## Próximas features posibles

- [ ] Ganancia individual por evento (knob en tooltip)
- [ ] Export log de eventos como CSV para importar en Reaper
- [ ] Múltiples tracks (Foley + efectos de sala + ambiente)
- [ ] Waveform del audio original del video superpuesta
- [ ] Modo punch-in: regrabar sólo un rango de tiempo
