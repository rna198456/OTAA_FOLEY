# Foley Recorder 👣

Herramienta web para grabación de Foley sincronizada con video.  
**Oficios y Técnicas de las Artes Audiovisuales · Cátedra Corti**

---

## Cómo funciona

1. **Cargá un video** (arrastrando o con el selector)
2. **Elegí un sample** de la biblioteca (o cargá tus propios WAV/MP3)
3. Presioná **● GRABAR** → el video arranca desde el inicio
4. **Clickeá los samples** (o usá `Espacio` para el último seleccionado) en sincronía con la imagen
5. Presioná **■ DETENER**
6. Presioná **↓ EXPORTAR WAV** → descarga un `.wav` renderizado offline, sin latencia

## Por qué no hay latencia en el export

El audio que escuchás durante la grabación es solo **monitoreo en tiempo real**.  
Lo que se guarda es el **log de eventos**: qué sample se disparó y en qué segundo del video.  
Al exportar, se usa `OfflineAudioContext` para renderizar todos los eventos en sus posiciones exactas — sin pasar por el event loop del browser.

## Estructura de archivos

```
foley-recorder/
├── index.html   — UI principal
├── style.css    — Estilos
├── audio.js     — Motor de audio: síntesis, carga de usuario, render offline, encoder WAV
├── app.js       — Lógica de app: video, biblioteca, grabación, waveform, export
└── README.md
```

No tiene dependencias externas ni build step. Vanilla JS puro.

---

## Deploy en GitHub Pages

### Opción A — Repositorio nuevo

```bash
git init
git add .
git commit -m "init: foley recorder"
git remote add origin https://github.com/TU_USUARIO/foley-recorder.git
git push -u origin main
```

Luego en GitHub:  
`Settings → Pages → Source: Deploy from branch → Branch: main / (root) → Save`

La URL será: `https://TU_USUARIO.github.io/foley-recorder/`

### Opción B — Carpeta dentro de un repo existente

Subí la carpeta como `docs/` o cualquier subdirectorio y configurá Pages desde esa carpeta.

---

## Compatibilidad

| Feature | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|
| Video drag & drop | ✅ | ✅ | ✅ | ✅ |
| Web Audio API | ✅ | ✅ | ✅ | ✅ |
| OfflineAudioContext | ✅ | ✅ | ✅ | ✅ |
| Export WAV | ✅ | ✅ | ✅ | ✅ |

> Safari requiere interacción de usuario antes de reproducir audio (ya contemplado).

---

## Samples builtin

| ID | Nombre | Tipo |
|---|---|---|
| w1 | Tablón seco | Madera |
| w2 | Parquet viejo | Madera |
| w3 | Escalera | Madera |
| c1 | Interior liso | Cemento |
| c2 | Exterior rugoso | Cemento |
| g1 | Grava fina | Grava |
| g2 | Cascajo | Grava |
| m1 | Chapa | Metal |
| m2 | Escalera metálica | Metal |

Los samples builtin son síntesis procedural (WebAudio).  
Para Foley real, cargá tus propios WAV con **+ Agregar WAV/MP3**.

---

## Próximas features posibles

- [ ] Control de ganancia individual por sample
- [ ] Múltiples tracks / capas de Foley
- [ ] Export del log de eventos como CSV (para importar en Reaper)
- [ ] Waveform del audio del video superpuesta en la timeline
- [ ] Modo "punch-in": sobrescribir una sección sin perder el resto
