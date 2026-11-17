/**
 * Image converter engine using the browser's built-in Canvas API (no WASM).
 *
 * How it works:
 *   1. DECODE  — the browser turns the file's bytes into raw pixels (an ImageBitmap).
 *   2. DRAW    — we paint those pixels onto an invisible <canvas>.
 *   3. ENCODE  — `canvas.toBlob(type, quality)` asks the browser to compress the
 *                canvas into PNG / JPEG / WebP. This is the same encoder the browser
 *                uses everywhere else, so it's fast and needs no extra download.
 * For PDF output we wrap the encoded image in a one-page PDF with pdf-lib.
 */
import { UserFacingError, type ConverterEngine, type OptionValues } from '../types';

const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

const engine: ConverterEngine = {
  async convert(file, sourceId, targetId, options, ctx) {
    if (targetId === 'pdf') return imageToPdf(file, sourceId, options, ctx.onProgress);
    const mime = MIME[targetId];
    if (!mime) throw new UserFacingError(`Unsupported target format: ${targetId}`);
    ctx.onProgress(null, 'Decoding image…');
    const canvas = await toCanvas(file, targetId === 'jpeg' ? String(options.background ?? '#ffffff') : null);
    ctx.onProgress(null, 'Encoding…');
    return encode(canvas, mime, Number(options.quality ?? 85) / 100, targetId);
  },
};
export default engine;

/**
 * Decode the file and draw it on a canvas. If `background` is given, paint it first —
 * JPEG can't store transparency, and without a fill transparent pixels turn black.
 */
async function toCanvas(file: File, background: string | null): Promise<HTMLCanvasElement> {
  const bitmap = await decode(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext('2d');
    if (!g) throw new UserFacingError('Your browser could not create a drawing canvas.');
    if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    g.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close(); // free the decoded pixels right away — they can be hundreds of MB
  }
}

async function encode(canvas: HTMLCanvasElement, mime: string, quality: number, label: string): Promise<Blob> {
  // `quality` is 0..1 and only affects lossy formats (JPEG, WebP); PNG ignores it.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) {
    throw new UserFacingError(`This image (${canvas.width}×${canvas.height}) is too large for your browser's canvas. Try a smaller image.`);
  }
  // Browsers that can't encode a format (e.g. older Safari with WebP) silently fall back
  // to PNG instead of failing. Detect that so we never mislabel the download.
  if (blob.type !== mime) {
    throw new UserFacingError(`Your browser can't create ${label.toUpperCase()} files. Try another format or a different browser.`);
  }
  return blob;
}

/**
 * Decode the file into pixels. `createImageBitmap` is fast and works off the main thread
 * in most browsers; `imageOrientation: 'from-image'` applies the EXIF rotation that
 * phone cameras store, so portrait photos don't come out sideways.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fallback: some formats (notably SVG) can't go through createImageBitmap directly
    // but can be decoded by a regular <img> element first.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      // SVGs without explicit width/height report 0×0 — give them a sensible size.
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h });
    } catch {
      throw new UserFacingError("This image couldn't be read. The file may be damaged or in a format your browser can't open.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Page sizes in PDF points (1 pt = 1/72 inch). */
const PAGE_SIZES: Record<string, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };

async function imageToPdf(file: File, sourceId: string, options: OptionValues, onProgress: (r: number | null, l?: string) => void): Promise<Blob> {
  onProgress(null, 'Preparing image…');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();

  // PDFs can embed JPEG and PNG directly. JPEGs go in untouched (no quality loss);
  // everything else is re-encoded to PNG first via the canvas.
  const bytes =
    sourceId === 'jpeg'
      ? new Uint8Array(await file.arrayBuffer())
      : new Uint8Array(await (await encode(await toCanvas(file, null), 'image/png', 1, 'png')).arrayBuffer());
  const image = sourceId === 'jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);

  onProgress(null, 'Building PDF…');
  const size = String(options.pageSize ?? 'fit');
  if (size === 'fit') {
    // Page exactly the size of the image (96 px per inch = 72 pt per inch).
    const w = image.width * 0.75;
    const h = image.height * 0.75;
    pdf.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  } else {
    // Fit the image inside a paper-sized page with a margin, orienting the page to match.
    let [pw, ph] = PAGE_SIZES[size] ?? PAGE_SIZES.a4;
    if (image.width > image.height) [pw, ph] = [ph, pw];
    const margin = 36;
    const s = Math.min((pw - margin * 2) / image.width, (ph - margin * 2) / image.height, 1);
    const w = image.width * s;
    const h = image.height * s;
    pdf.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  pdf.setTitle(file.name.replace(/\.[^.]+$/, ''));
  pdf.setProducer('Keeplocal');
  const out = await pdf.save();
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
