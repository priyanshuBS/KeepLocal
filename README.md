# Keeplocal

> **Convert anything. Upload nothing.**

Keeplocal is a file converter that runs **entirely in your web browser**.
Drop in a file, pick a format, download the result — your file never leaves your computer.

There is no server doing the work. The website is just static files (HTML, CSS, JavaScript
and WebAssembly), and every conversion happens on your own device.

---

## Contents

1. [Quick start](#quick-start)
2. [What it can convert](#what-it-can-convert)
3. [How your privacy is protected](#how-your-privacy-is-protected)
4. [Try it with the sample files](#try-it-with-the-sample-files)
5. [All commands](#all-commands)
6. [Project structure](#project-structure)
7. [Adding a new converter](#adding-a-new-converter)
8. [Deploying](#deploying)
9. [Limits and good to know](#limits-and-good-to-know)
10. [Libraries and licenses](#libraries-and-licenses)

---

## Quick start

**You need:** [Node.js](https://nodejs.org/) **22.13 or newer** (Node 24 recommended) and npm.

```bash
npm install     # 1. install dependencies (first time only)
npm run dev     # 2. start the app
```

Then open **http://localhost:5173** in your browser.

To stop the server, press `Ctrl + C` in the terminal.

---

## What it can convert

| Category       | From                                | To                                       |
| -------------- | ----------------------------------- | ---------------------------------------- |
| **Images**     | PNG, JPG, WebP, SVG, GIF, BMP, AVIF | PNG, JPG, WebP, PDF                      |
| **PDF & Docs** | PDF                                 | PNG or JPG (one image per page), TXT     |
|                | Markdown                            | HTML                                     |
| **Video**      | MP4, MOV, WebM, MKV, AVI            | MP4, WebM, animated GIF, MP3 (sound only) |
| **Audio**      | MP3, WAV, OGG, M4A, FLAC            | MP3, WAV, OGG, M4A, FLAC                 |
| **Data**       | CSV, JSON, YAML                     | CSV, JSON, YAML                          |

A PDF with several pages becomes a **ZIP file** containing one image per page.

---

## How your privacy is protected

| Promise               | How it's kept                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| **No uploads**        | Files are read straight into the browser tab's memory. There is no backend to send them to.     |
| **No tracking**       | No accounts, cookies or analytics. Nothing about you is stored.                                 |
| **Enforced by the browser** | A Content Security Policy in `index.html` blocks every request to other websites — so even a bug couldn't leak a file. |
| **No outside servers** | Fonts, the FFmpeg engine and the PDF engine are all served from the app itself, never from a CDN. |
| **Works offline**     | After your first visit the app is cached. Turn off Wi-Fi and it keeps working.                  |

**Check it yourself:** open your browser's DevTools → **Network** tab and convert a file.
You'll see no request carrying your file.

---

## Try it with the sample files

The `samples/` folder has small test files. Start the app, then drop each file in:

| File            | Convert to      | What you should see                                                    |
| --------------- | --------------- | ---------------------------------------------------------------------- |
| `people.csv`    | JSON            | 5 records; `age` as numbers, `active` as `true` / `false`              |
| `products.json` | CSV             | Nested values become columns like `dimensions.width`                   |
| `gradient.png`  | JPG             | The transparent circle turns white (choose Black to compare)           |
| `gradient.png`  | WebP            | Move the **Quality** slider — the output size changes                  |
| `sample.pdf`    | PNG             | A ZIP with 3 page images, plus page previews                           |
| `sample.pdf`    | TXT             | The text from all 3 pages                                              |
| `notes.md`      | HTML            | A styled web page                                                      |
| `tone.wav`      | MP3, FLAC, M4A  | A player to listen to the result                                       |
| `clip.mp4`      | GIF             | An animated preview                                                    |
| `clip.mp4`      | MP3             | Just the soundtrack                                                    |

> **Note:** the first audio or video conversion downloads the FFmpeg engine (about 31 MB).
> A progress bar shows the download. After that it's cached.

**Error messages to try:** drop a file the app doesn't support (for example a `.txt`), or a
JSON file containing only `42` and convert it to CSV.

---

## All commands

| Command           | What it does                                                   | Address                 |
| ----------------- | -------------------------------------------------------------- | ----------------------- |
| `npm install`     | Installs dependencies                                          | —                       |
| `npm run dev`     | Starts the development server with live reload                | http://localhost:5173   |
| `npm run build`   | Checks types and builds the final site into `dist/`            | —                       |
| `npm run preview` | Serves the built site, exactly as it will run when deployed    | http://localhost:4173   |

Good to know:

- `npm run dev` and `npm run build` first copy the FFmpeg and PDF engine files from
  `node_modules` into `public/ffmpeg/` and `public/pdfjs/`. These folders are generated, so
  they're not in git.
- Offline mode only works in the built version (`npm run build` + `npm run preview`). It is
  switched off in development so it doesn't interfere with live reload.

---

## Project structure

```
keeplocal/
├── index.html              Page layout and privacy policy (CSP)
├── src/
│   ├── main.ts             The app: drop zone, options, progress, results, download
│   ├── registry.ts         List of converters and the formats each one supports
│   ├── types.ts            The shared "converter" contract
│   ├── styles.css          All styles
│   ├── converters/
│   │   ├── image.ts        Images (browser Canvas) and image → PDF
│   │   ├── document.ts     PDF → images / text, Markdown → HTML
│   │   ├── video.ts        Video (FFmpeg)
│   │   ├── audio.ts        Audio (FFmpeg)
│   │   └── data.ts         CSV / JSON / YAML
│   └── lib/
│       ├── ffmpeg.ts       Loads and runs FFmpeg, with progress and cancel
│       ├── csv.ts          CSV reader and writer
│       └── dom.ts          Small helpers for building the page
├── sw/service-worker.js    Offline cache
├── scripts/copy-assets.mjs Copies the FFmpeg and PDF engine files into public/
├── public/                 Static files (favicon, hosting headers)
└── samples/                Test files
```

---

## Adding a new converter

Each converter is a separate, self-contained piece. The rest of the app doesn't need to change.

1. **Write the converter** in `src/converters/<name>.ts`. It exports a `convert()` function that
   takes a file and returns the converted file.
2. **Register it** by adding an entry to the `converters` list in `src/registry.ts`: which
   formats it reads, which it writes, and any options (like a quality slider).
3. **Done.** The app automatically shows its formats and options, and picks the right preview
   (image, audio, video or text) for the result.

Each converter is only downloaded when someone opens a matching file, so adding more doesn't
slow down the page. If one fails to load, the others keep working.

---

## Deploying

Run `npm run build`, then upload the `dist/` folder to any static hosting service.
No server code or database is needed.

| Host                 | Works? | Notes                                                                 |
| -------------------- | ------ | --------------------------------------------------------------------- |
| **Netlify**          | ✅     | Works as-is. Headers are set automatically by `public/_headers`.      |
| **GitHub Pages**     | ✅     | Works as-is (custom headers aren't needed for the current setup).     |
| **Cloudflare Pages** | ⚠️     | Its 25 MB per-file limit is smaller than the 31 MB FFmpeg file, so audio and video won't work there. |
| **Your own server**  | ✅     | See the header settings below.                                        |

The site works from any sub-folder (e.g. `https://you.github.io/keeplocal/`) without changes.

<details>
<summary><b>About the security headers (optional, for advanced setups)</b></summary>

FFmpeg has a faster *multi-threaded* version that needs two extra headers from the server.
Keeplocal uses the *single-threaded* version, which works without them — but the dev server
sends them anyway, so switching later is easy:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**nginx**

```nginx
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
types { application/wasm wasm; }
```

**Apache** (`.htaccess`)

```apache
Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp"
AddType application/wasm .wasm
```

GitHub Pages can't set headers. If you ever switch to the multi-threaded FFmpeg, add
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) to add them for you.

</details>

---

## Limits and good to know

Files are converted in your browser's memory, so very large files can be slow or run out of
memory — especially on phones. The app warns you about large files and refuses huge ones:

| Category   | Warning above | Maximum                  |
| ---------- | ------------- | ------------------------ |
| Images     | 25 MB         | 150 MB                   |
| PDF & Docs | 50 MB         | 300 MB (and 300 pages)   |
| Video      | 40 MB         | 400 MB                   |
| Audio      | 50 MB         | 500 MB                   |
| Data       | 25 MB         | 200 MB                   |

- **Video is slow.** It uses a single CPU core inside the browser. Short clips work best.
- **One file at a time.** If several files are dropped, the first one is opened.
- **Change the limits** in `src/registry.ts` (look for `limits`).

---

## Libraries and licenses

| Library                                                         | Used for                        |
| --------------------------------------------------------------- | ------------------------------- |
| [Vite](https://vitejs.dev/) + TypeScript                        | Build tool and dev server       |
| [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)        | Audio and video conversion      |
| [pdf.js](https://mozilla.github.io/pdf.js/)                     | Reading PDFs (Firefox's engine) |
| [pdf-lib](https://pdf-lib.js.org/)                              | Creating PDFs from images       |
| [fflate](https://github.com/101arrowz/fflate)                   | Creating ZIP files              |
| [marked](https://marked.js.org/)                                | Markdown → HTML                 |
| [yaml](https://www.npmjs.com/package/yaml)                      | Reading and writing YAML        |
| [Geist](https://vercel.com/font) and [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) | Fonts (bundled locally) |

> **License note:** the FFmpeg engine is licensed **GPL-2.0-or-later**. If you publish
> Keeplocal, make sure your own license is compatible.
