/**
 * Document converter engine:
 *   PDF      -> PNG / JPEG (one image per page; several pages are bundled into a ZIP)
 *   PDF      -> TXT (extract the text layer)
 *   Markdown -> HTML (a standalone, styled web page)
 *
 * PDFs are read with pdf.js — Mozilla's PDF engine, the same one that powers Firefox's
 * built-in PDF viewer. It parses the file in a Web Worker and draws each page onto a
 * <canvas>, which we then encode as an image exactly like the image converter does.
 */
import * as pdfjs from 'pdfjs-dist';
// `?url` makes Vite copy the worker script into the build and give us its URL.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { zipSync } from 'fflate';
import { marked } from 'marked';
import { UserFacingError, type ConvertContext, type ConverterEngine, type ConvertOutput, type OptionValues } from '../types';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Refuse absurdly long documents rather than exhausting memory. */
const MAX_PAGES = 300;

const engine: ConverterEngine = {
  async convert(file, sourceId, targetId, options, ctx) {
    if (sourceId === 'md') return markdownToHtml(file);
    if (sourceId !== 'pdf') throw new UserFacingError(`Unsupported input: ${sourceId}`);
    if (targetId === 'txt') return pdfToText(file, ctx);
    if (targetId === 'png' || targetId === 'jpeg') return pdfToImages(file, targetId, options, ctx);
    throw new UserFacingError(`Unsupported target format: ${targetId}`);
  },
};
export default engine;

// ---------------------------------------------------------------------------
// PDF loading
// ---------------------------------------------------------------------------
async function openPdf(file: File, ctx: ConvertContext) {
  ctx.onProgress(null, 'Opening PDF…');
  // Fonts, character maps and image decoders are served from /public/pdfjs on this same
  // site (copied there by scripts/copy-assets.mjs) — pdf.js never fetches from a CDN.
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    // XFA forms need extra scripting support we deliberately leave off.
    // (pdf.js v6 never uses eval() for fonts, so it works under our strict CSP.)
    enableXfa: false,
  });
  ctx.signal.addEventListener('abort', () => task.destroy(), { once: true });
  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PAGES) {
      await task.destroy();
      throw new UserFacingError(`This PDF has ${doc.numPages} pages. Keeplocal handles up to ${MAX_PAGES} pages at a time.`);
    }
    // Destroying the loading task tears down the document and its worker.
    return { doc, close: () => task.destroy() };
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    if (ctx.signal.aborted) throw new DOMException('Conversion cancelled', 'AbortError');
    const name = (err as Error)?.name;
    if (name === 'PasswordException') throw new UserFacingError('This PDF is password-protected. Remove the password first, then try again.');
    throw new UserFacingError("This PDF couldn't be read. It may be damaged or not really a PDF.");
  }
}

function checkAbort(ctx: ConvertContext) {
  if (ctx.signal.aborted) throw new DOMException('Conversion cancelled', 'AbortError');
}

// ---------------------------------------------------------------------------
// PDF -> images
// ---------------------------------------------------------------------------
async function pdfToImages(file: File, target: 'png' | 'jpeg', options: OptionValues, ctx: ConvertContext): Promise<ConvertOutput> {
  const { doc, close } = await openPdf(file, ctx);
  const mime = target === 'png' ? 'image/png' : 'image/jpeg';
  const ext = target === 'png' ? 'png' : 'jpg';
  // PDF units are points (1/72 inch). scale 2 ≈ 144 DPI — sharp on most screens.
  const scale = Number(options.resolution ?? 2);
  const quality = Number(options.quality ?? 90) / 100;
  const base = file.name.replace(/\.[^.]+$/, '') || 'page';
  const pad = String(doc.numPages).length;

  const pages: { name: string; blob: Blob }[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      checkAbort(ctx);
      ctx.onProgress((n - 1) / doc.numPages, `Rendering page ${n} of ${doc.numPages}…`);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const g = canvas.getContext('2d')!;
      // PDF pages assume a white sheet of paper underneath; paint it so PNGs aren't transparent.
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: g, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, quality));
      page.cleanup();
      if (!blob) throw new UserFacingError(`Page ${n} is too large to render. Try a lower resolution.`);
      pages.push({ name: `${base}-page-${String(n).padStart(pad, '0')}.${ext}`, blob });
    }
  } finally {
    await close();
  }

  ctx.onProgress(1, 'Packaging…');
  if (pages.length === 1) return { blob: pages[0].blob, summary: '1 page' };

  // Several pages -> one ZIP. Images are already compressed, so we store them as-is
  // (level 0), which makes zipping nearly instant.
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const p of pages) entries[p.name] = [new Uint8Array(await p.blob.arrayBuffer()), { level: 0 }];
  const zip = zipSync(entries);
  return {
    blob: new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    ext: 'zip',
    summary: `${pages.length} pages · ZIP of ${target.toUpperCase()} images`,
    thumbnails: pages.slice(0, 6).map((p) => p.blob),
  };
}

// ---------------------------------------------------------------------------
// PDF -> text
// ---------------------------------------------------------------------------
async function pdfToText(file: File, ctx: ConvertContext): Promise<ConvertOutput> {
  const { doc, close } = await openPdf(file, ctx);
  const out: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      checkAbort(ctx);
      ctx.onProgress((n - 1) / doc.numPages, `Reading page ${n} of ${doc.numPages}…`);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Each item is a run of text; `hasEOL` marks where the PDF ends a line.
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      out.push(text.trim());
      page.cleanup();
    }
  } finally {
    await close();
  }
  const body = out.join('\n\n');
  if (body.trim() === '') {
    throw new UserFacingError("No text found. This PDF is probably scanned images — try converting it to PNG instead.");
  }
  return { blob: new Blob([body + '\n'], { type: 'text/plain' }), summary: `${out.length} page${out.length === 1 ? '' : 's'}` };
}

// ---------------------------------------------------------------------------
// Markdown -> HTML
// ---------------------------------------------------------------------------
async function markdownToHtml(file: File): Promise<Blob> {
  const md = await file.text();
  if (md.trim() === '') throw new UserFacingError('This file is empty — there is nothing to convert.');
  const body = await marked.parse(md, { gfm: true });
  const title = (/^#\s+(.+)$/m.exec(md)?.[1] ?? file.name.replace(/\.[^.]+$/, '')).replace(/[<>&"]/g, '');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  body { max-width: 760px; margin: 40px auto; padding: 0 20px; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1, h2, h3 { line-height: 1.25; }
  pre, code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.92em; }
  pre { padding: 14px; overflow: auto; border-radius: 8px; background: rgba(127,127,127,.12); }
  code { padding: 0.1em 0.3em; border-radius: 4px; background: rgba(127,127,127,.12); }
  pre code { padding: 0; background: none; }
  blockquote { margin: 0; padding-left: 16px; border-left: 3px solid rgba(127,127,127,.4); opacity: .85; }
  table { border-collapse: collapse; } th, td { border: 1px solid rgba(127,127,127,.35); padding: 6px 10px; }
  img { max-width: 100%; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
  return new Blob([html], { type: 'text/html' });
}
