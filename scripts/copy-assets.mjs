// Copies large runtime assets from node_modules into public/ so they are served from
// YOUR origin. Nothing is ever fetched from a third-party CDN.
//   public/ffmpeg/  ffmpeg.wasm core (audio + video converters)
//   public/pdfjs/   pdf.js fonts, character maps, colour profiles and WASM image decoders
// Runs automatically before `npm run dev` / `npm run build` (see package.json).
import { cpSync, existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const pub = (...p) => join(root, 'public', ...p);

function copyFile(from, to) {
  if (!existsSync(from)) return console.warn(`[keeplocal] missing ${from} — related converter will be unavailable.`);
  mkdirSync(dirname(to), { recursive: true });
  // Skip if already up to date (same size) to keep dev startup fast.
  if (existsSync(to) && statSync(to).size === statSync(from).size) return;
  copyFileSync(from, to);
  console.log(`[keeplocal] copied ${to.slice(root.length + 1)}`);
}

function copyDir(from, to) {
  if (!existsSync(from)) return console.warn(`[keeplocal] missing ${from}`);
  if (existsSync(to)) return; // already copied
  cpSync(from, to, { recursive: true });
  console.log(`[keeplocal] copied ${to.slice(root.length + 1)}/`);
}

for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFile(nm('@ffmpeg', 'core', 'dist', 'esm', f), pub('ffmpeg', f));
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) copyDir(nm('pdfjs-dist', d), pub('pdfjs', d));
