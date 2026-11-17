/**
 * Shared ffmpeg.wasm runner used by the audio and video converters.
 *
 * Background for the curious:
 *  - FFmpeg is a C program. ffmpeg.wasm compiles it to WebAssembly (WASM), a compact
 *    binary format browsers can run at near-native speed.
 *  - The WASM binary is big (~31 MB), so this module is only imported when someone opens
 *    an audio or video file, and the binary is only downloaded the first time it's needed.
 *  - FFmpeg runs inside a Web Worker (a background thread) so the page stays responsive.
 *    We talk to it through the `FFmpeg` class, which posts messages to that worker.
 *  - FFmpeg expects files on a disk. WASM has no real disk, so Emscripten gives it an
 *    in-memory virtual file system (MEMFS). We `writeFile` the input into that memory,
 *    run the ffmpeg command, then `readFile` the output back out. Nothing touches the network.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { UserFacingError, type ConvertContext } from '../types';

let instance: Promise<FFmpeg> | null = null;
/** Whoever is currently waiting on the load gets download progress updates. */
let loadListener: ConvertContext['onProgress'] | null = null;

/**
 * Create and load ffmpeg once, then reuse it. If loading fails we forget the failed
 * attempt so the user can retry (e.g. after reconnecting to the network).
 */
export function getFFmpeg(onProgress?: ConvertContext['onProgress']): Promise<FFmpeg> {
  loadListener = onProgress ?? null;
  instance ??= loadFFmpeg().catch((err) => {
    instance = null;
    throw err;
  });
  return instance.finally(() => (loadListener = null));
}

async function loadFFmpeg(): Promise<FFmpeg> {
  if (typeof WebAssembly !== 'object') {
    throw new UserFacingError('Your browser does not support WebAssembly, which this converter needs.');
  }
  // The core files are copied into /public/ffmpeg by scripts/copy-assets.mjs, so they are
  // served from this same site — no third-party CDN is ever contacted.
  const base = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, document.baseURI).href;

  // We fetch both files ourselves and hand ffmpeg "blob:" URLs. This lets us show download
  // progress, and avoids bundler/worker path issues: the worker imports the JS glue code
  // from the blob URL, and the glue code then instantiates the .wasm from the other one.
  const received: Record<string, number> = {};
  const totals: Record<string, number> = {};
  const report = (url: string | URL, got: number, total: number) => {
    received[String(url)] = got;
    totals[String(url)] = total;
    const sumGot = Object.values(received).reduce((a, b) => a + b, 0);
    const sumTotal = Object.values(totals).reduce((a, b) => a + b, 0);
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    loadListener?.(
      sumTotal > 0 ? Math.min(sumGot / sumTotal, 1) : null,
      sumTotal > 0 ? `Downloading FFmpeg engine… ${mb(sumGot)} / ${mb(sumTotal)} MB` : 'Downloading FFmpeg engine…',
    );
  };

  let coreURL: string;
  let wasmURL: string;
  try {
    [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${base}ffmpeg-core.js`, 'text/javascript', true, (e) => report(e.url, e.received, e.total)),
      toBlobURL(`${base}ffmpeg-core.wasm`, 'application/wasm', true, (e) => report(e.url, e.received, e.total)),
    ]);
  } catch {
    throw new UserFacingError(
      "The FFmpeg engine couldn't be downloaded. Check your connection and try again — the other converters still work.",
    );
  }

  loadListener?.(null, 'Starting FFmpeg engine…');
  const ffmpeg = new FFmpeg();
  try {
    await ffmpeg.load({ coreURL, wasmURL });
  } catch (err) {
    console.error('[keeplocal] ffmpeg failed to load', err);
    throw new UserFacingError("The FFmpeg engine couldn't start in this browser. The other converters still work.");
  }
  return ffmpeg;
}

/** Parse "HH:MM:SS.ss" into seconds. */
function toSeconds(stamp: string): number {
  const [h, m, s] = stamp.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

export interface RunOptions {
  file: File;
  /** Extension for the input file inside the virtual file system (helps FFmpeg guess the format). */
  inputExt: string;
  outputExt: string;
  outputMime: string;
  /** Arguments placed between `-i input` and the output file name. */
  args: string[];
  ctx: ConvertContext;
}

/** Run one FFmpeg command: input file in, Blob out, with progress and cancel support. */
export async function runFFmpeg({ file, inputExt, outputExt, outputMime, args, ctx }: RunOptions): Promise<Blob> {
  const ffmpeg = await getFFmpeg(ctx.onProgress);

  // Unique names so a cancelled run can't collide with the next one.
  const id = Date.now().toString(36);
  const inName = `in-${id}.${inputExt}`;
  const outName = `out-${id}.${outputExt}`;

  // FFmpeg prints the input's duration in its log; we combine that with the `time=` it
  // reports while encoding to compute a percentage.
  let duration = 0;
  const tail: string[] = []; // last few log lines, for error messages
  const onLog = ({ message }: { message: string }) => {
    tail.push(message);
    if (tail.length > 15) tail.shift();
    const d = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(message);
    if (d) duration = toSeconds(d[1]);
    const t = /time=\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(message);
    if (t && duration > 0) ctx.onProgress(Math.min(toSeconds(t[1]) / duration, 1), 'Converting…');
  };
  // The built-in progress event reports `time` in microseconds of output written.
  const onProgress = ({ time }: { progress: number; time: number }) => {
    if (duration > 0 && time > 0) ctx.onProgress(Math.min(time / 1e6 / duration, 1), 'Converting…');
  };

  // Cancel = kill the worker. That's the only way to stop a running WASM call; the next
  // conversion simply loads a fresh instance (from the browser cache, so it's quick).
  const onAbort = () => {
    ffmpeg.terminate();
    instance = null;
  };
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  ffmpeg.on('log', onLog);
  ffmpeg.on('progress', onProgress);

  try {
    ctx.onProgress(null, 'Reading file…');
    // Copy the file's bytes into ffmpeg's in-memory file system.
    await ffmpeg.writeFile(inName, await fetchFile(file));

    ctx.onProgress(0, 'Converting…');
    const code = await ffmpeg.exec(['-i', inName, ...args, outName]);
    if (code !== 0) {
      console.error('[keeplocal] ffmpeg log:\n' + tail.join('\n'));
      const noAudio = tail.some((l) => /does not contain any stream|Output file .* does not contain/i.test(l));
      throw new UserFacingError(
        noAudio
          ? "This file has no track of the kind needed for that format (for example, a video with no sound can't become an MP3)."
          : "FFmpeg couldn't convert this file. It may be damaged or use a codec that isn't supported.",
      );
    }

    const data = await ffmpeg.readFile(outName);
    if (typeof data === 'string' || data.byteLength === 0) {
      throw new UserFacingError('The conversion produced an empty file.');
    }
    ctx.onProgress(1, 'Done');
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: outputMime });
  } catch (err) {
    if (ctx.signal.aborted) throw new DOMException('Conversion cancelled', 'AbortError');
    throw err;
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
    if (!ctx.signal.aborted) {
      ffmpeg.off('log', onLog);
      ffmpeg.off('progress', onProgress);
      // Free the virtual files — they live in memory and can be large.
      await ffmpeg.deleteFile(inName).catch(() => {});
      await ffmpeg.deleteFile(outName).catch(() => {});
    }
  }
}
