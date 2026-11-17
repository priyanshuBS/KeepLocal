# Keeplocal notes

Keeplocal converts files **entirely in your browser**.

## What it can do

- Images: PNG, JPEG, WebP, SVG → PNG, JPEG, WebP, PDF
- PDF: pages → images, or extract text
- Video: MP4, WebM, GIF, or the soundtrack as MP3
- Audio: MP3, WAV, OGG, M4A, FLAC
- Data: CSV ⇄ JSON ⇄ YAML

> Convert anything. Upload nothing.

| Converter | Engine |
| --- | --- |
| Images | Canvas API |
| PDF | pdf.js |
| Audio / Video | ffmpeg.wasm |

```js
console.log('Nothing leaves your device');
```
