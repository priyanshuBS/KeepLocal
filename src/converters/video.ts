/**
 * Video converter engine — MP4, WebM, animated GIF, or extract the soundtrack as MP3.
 * Uses the shared ffmpeg.wasm runner (src/lib/ffmpeg.ts).
 *
 * Note: this is the single-threaded FFmpeg build running on one CPU core inside the
 * browser, so video encoding is much slower than desktop tools. The encoder presets
 * below favour speed over the last few percent of compression.
 */
import { getFFmpeg, runFFmpeg } from '../lib/ffmpeg';
import { UserFacingError, type ConverterEngine, type OptionValues } from '../types';

/** "Quality" option -> encoder settings. Lower CRF = better quality, bigger file. */
const CRF: Record<string, { x264: string; vp8bitrate: string }> = {
  high: { x264: '20', vp8bitrate: '2M' },
  medium: { x264: '26', vp8bitrate: '1M' },
  low: { x264: '32', vp8bitrate: '500k' },
};

/** Keep the original size unless it's larger than `max` pixels wide; keep dimensions even (codecs require it). */
function scaleFilter(options: OptionValues): string | null {
  const max = Number(options.maxWidth ?? 0);
  return max > 0 ? `scale='min(${max},iw)':-2` : `scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

const engine: ConverterEngine = {
  async prepare(ctx) {
    await getFFmpeg(ctx.onProgress);
  },

  async convert(file, sourceId, targetId, options, ctx) {
    const q = CRF[String(options.quality ?? 'medium')] ?? CRF.medium;
    const scale = scaleFilter(options);
    const vf = scale ? ['-vf', scale] : [];
    const common = { file, inputExt: sourceId, ctx };

    switch (targetId) {
      case 'mp4':
        // H.264 + AAC in MP4 plays everywhere. `ultrafast` keeps in-browser encoding bearable;
        // +faststart moves the index to the front so the file can start playing immediately.
        return runFFmpeg({
          ...common,
          outputExt: 'mp4',
          outputMime: 'video/mp4',
          args: [...vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', q.x264, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
        });
      case 'webm':
        // VP8 + Vorbis: the fastest WebM combination available in this FFmpeg build.
        return runFFmpeg({
          ...common,
          outputExt: 'webm',
          outputMime: 'video/webm',
          args: [...vf, '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', q.vp8bitrate, '-c:a', 'libvorbis', '-b:a', '128k'],
        });
      case 'gif': {
        // GIFs only have 256 colours. The two-step palette trick (palettegen + paletteuse)
        // builds the best 256-colour palette for THIS clip, which looks far better than the
        // default web palette. fps/width are kept modest because GIFs get huge quickly.
        const fps = Number(options.fps ?? 12);
        const width = Number(options.gifWidth ?? 480);
        return runFFmpeg({
          ...common,
          outputExt: 'gif',
          outputMime: 'image/gif',
          args: [
            '-vf',
            `fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
            '-an',
            '-loop',
            '0',
          ],
        });
      }
      case 'mp3':
        // Extract just the soundtrack.
        return runFFmpeg({ ...common, outputExt: 'mp3', outputMime: 'audio/mpeg', args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] });
      default:
        throw new UserFacingError(`Unsupported target format: ${targetId}`);
    }
  },
};
export default engine;
