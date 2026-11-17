import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Cross-origin isolation headers.
 *
 * ffmpeg.wasm's *multi-threaded* build needs `SharedArrayBuffer`, which browsers only
 * expose on "cross-origin isolated" pages. A page becomes cross-origin isolated when it
 * is served with BOTH of these headers. Keeplocal ships the single-threaded core (which
 * also works without them), but we send them anyway so upgrading to the multi-threaded
 * core later is a drop-in change — and so dev behaves exactly like a correctly-configured
 * production host. See README → "Deploying" for the equivalent host configs.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * Emits `sw.js` (the offline service worker) at build time, pre-filled with the list of
 * every file in the build so the whole app — including lazily-loaded converters — is
 * cached on the first visit. The FFmpeg engine (~31 MB) is excluded from the precache and
 * cached on first use instead.
 */
function serviceWorker(): Plugin {
  return {
    name: 'keeplocal-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const precache = ['./', ...files.map((f) => `./${f}`), './favicon.svg'];
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 10);
      const source = readFileSync(new URL('./sw/service-worker.js', import.meta.url), 'utf8')
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__VERSION__', JSON.stringify(version));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages /repo/).
  base: './',
  plugins: [serviceWorker()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  // @ffmpeg/ffmpeg spawns its own Web Worker via `new URL('./worker.js', import.meta.url)`.
  // Vite's dependency pre-bundling would break that relative URL, so we exclude it.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  // The ffmpeg worker is an ES module worker, so the production build must emit ES workers.
  worker: { format: 'es' },
  // pdf.js is ~1.3 MB but only loads when a PDF is opened, so raise the size warning threshold.
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
