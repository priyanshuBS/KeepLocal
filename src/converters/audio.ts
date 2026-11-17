/**
 * Audio converter engine — a thin layer over the shared ffmpeg.wasm runner
 * (see src/lib/ffmpeg.ts for how FFmpeg runs in the browser).
 */
import { getFFmpeg, runFFmpeg } from '../lib/ffmpeg';
import { UserFacingError, type ConverterEngine } from '../types';

/** Encoder settings per output format. */
const CODECS: Record<string, { ext: string; mime: string; args: (kbps: string) => string[] }> = {
  mp3: { ext: 'mp3', mime: 'audio/mpeg', args: (k) => ['-c:a', 'libmp3lame', '-b:a', `${k}k`] },
  ogg: { ext: 'ogg', mime: 'audio/ogg', args: (k) => ['-c:a', 'libvorbis', '-b:a', `${k}k`] },
  m4a: { ext: 'm4a', mime: 'audio/mp4', args: (k) => ['-c:a', 'aac', '-b:a', `${k}k`] },
  // Lossless formats ignore the bitrate option.
  flac: { ext: 'flac', mime: 'audio/flac', args: () => ['-c:a', 'flac'] },
  // WAV is uncompressed: 16-bit PCM is the most widely compatible flavour.
  wav: { ext: 'wav', mime: 'audio/wav', args: () => ['-c:a', 'pcm_s16le'] },
};

const engine: ConverterEngine = {
  // Warm up FFmpeg as soon as the audio panel opens.
  async prepare(ctx) {
    await getFFmpeg(ctx.onProgress);
  },

  async convert(file, sourceId, targetId, options, ctx) {
    const codec = CODECS[targetId];
    if (!codec) throw new UserFacingError(`Unsupported target format: ${targetId}`);
    return runFFmpeg({
      file,
      inputExt: sourceId,
      outputExt: codec.ext,
      outputMime: codec.mime,
      // -vn drops embedded cover art (a "video" stream) that most audio formats can't hold.
      args: ['-vn', ...codec.args(String(options.bitrate ?? '192'))],
      ctx,
    });
  },
};
export default engine;
