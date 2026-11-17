/**
 * The converter registry: lightweight descriptions of every converter.
 *
 * Only this metadata is in the main bundle. Each `load()` is a dynamic `import()`,
 * which Vite splits into a separate chunk that is fetched the first time it's needed.
 * Add a new converter by appending another entry to `converters` — the shell picks it up.
 */
import type { ConverterModule, Format } from './types';

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Shared format definitions
// ---------------------------------------------------------------------------
const F = {
  // data
  csv: { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv', description: 'Spreadsheets' },
  json: { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json', description: 'Structured data' },
  yaml: { id: 'yaml', label: 'YAML', ext: 'yaml', mime: 'application/yaml', description: 'Readable config' },
  // images
  png: { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', description: 'Lossless, transparent' },
  jpeg: { id: 'jpeg', label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', description: 'Small photos' },
  webp: { id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', description: 'Modern, compact' },
  gif: { id: 'gif', label: 'GIF', ext: 'gif', mime: 'image/gif' },
  bmp: { id: 'bmp', label: 'BMP', ext: 'bmp', mime: 'image/bmp' },
  avif: { id: 'avif', label: 'AVIF', ext: 'avif', mime: 'image/avif' },
  svg: { id: 'svg', label: 'SVG', ext: 'svg', mime: 'image/svg+xml' },
  // documents
  pdf: { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf', description: 'Printable document' },
  txt: { id: 'txt', label: 'TXT', ext: 'txt', mime: 'text/plain', description: 'Plain text' },
  md: { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
  html: { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html', description: 'Web page' },
  // audio
  mp3: { id: 'mp3', label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', description: 'Plays everywhere' },
  wav: { id: 'wav', label: 'WAV', ext: 'wav', mime: 'audio/wav', description: 'Uncompressed' },
  ogg: { id: 'ogg', label: 'OGG', ext: 'ogg', mime: 'audio/ogg', description: 'Open, compact' },
  m4a: { id: 'm4a', label: 'M4A', ext: 'm4a', mime: 'audio/mp4', description: 'Apple devices' },
  flac: { id: 'flac', label: 'FLAC', ext: 'flac', mime: 'audio/flac', description: 'Lossless' },
  // video
  mp4: { id: 'mp4', label: 'MP4', ext: 'mp4', mime: 'video/mp4', description: 'Plays everywhere' },
  webm: { id: 'webm', label: 'WebM', ext: 'webm', mime: 'video/webm', description: 'Made for the web' },
  mov: { id: 'mov', label: 'MOV', ext: 'mov', mime: 'video/quicktime' },
  mkv: { id: 'mkv', label: 'MKV', ext: 'mkv', mime: 'video/x-matroska' },
  avi: { id: 'avi', label: 'AVI', ext: 'avi', mime: 'video/x-msvideo' },
} satisfies Record<string, Format>;

const gifAnim: Format = { ...F.gif, description: 'Animated image' };
const mp3Track: Format = { ...F.mp3, description: 'Audio only' };

const ffmpegNotice =
  'Uses FFmpeg (≈31 MB). It downloads once from this site the first time, then stays cached in your browser.';

// ---------------------------------------------------------------------------
// Converters (order = order shown on the page)
// ---------------------------------------------------------------------------
export const converters: ConverterModule[] = [
  {
    id: 'image',
    icon: 'image',
    title: 'Images',
    summary: 'Convert photos and graphics between PNG, JPEG and WebP, or turn an image into a PDF.',
    inputs: [F.png, F.jpeg, F.webp, F.gif, F.bmp, F.avif, F.svg],
    aliases: { jpg: 'jpeg', jpe: 'jpeg', jfif: 'jpeg', 'image/jpg': 'jpeg' },
    outputs: [F.png, F.jpeg, F.webp, F.pdf],
    // Re-encoding to the same format is allowed: JPEG -> JPEG at lower quality = compression.
    targetsFor: () => [F.png, F.jpeg, F.webp, F.pdf],
    options: [
      {
        id: 'quality',
        type: 'range',
        label: 'Quality',
        min: 10,
        max: 100,
        step: 1,
        default: 85,
        format: (v) => `${v}%`,
        hint: 'Lower quality gives a smaller file.',
        appliesTo: ['jpeg', 'webp'],
      },
      {
        id: 'background',
        type: 'select',
        label: 'Fill transparent areas with',
        choices: [
          { value: '#ffffff', label: 'White' },
          { value: '#000000', label: 'Black' },
        ],
        default: '#ffffff',
        hint: 'JPEG has no transparency.',
        appliesTo: ['jpeg'],
      },
      {
        id: 'pageSize',
        type: 'select',
        label: 'Page size',
        choices: [
          { value: 'fit', label: 'Same as image' },
          { value: 'a4', label: 'A4' },
          { value: 'letter', label: 'US Letter' },
        ],
        default: 'fit',
        appliesTo: ['pdf'],
      },
    ],
    limits: { warn: 25 * MB, max: 150 * MB },
    load: () => import('./converters/image').then((m) => m.default),
  },
  {
    id: 'document',
    icon: 'document',
    title: 'PDF & Docs',
    summary: 'Turn PDF pages into images, pull out the text, or convert Markdown into a web page.',
    inputs: [F.pdf, F.md],
    aliases: { markdown: 'md', mdown: 'md', 'text/x-markdown': 'md' },
    outputs: [F.png, F.jpeg, F.txt, F.html],
    targetsFor: (source) => (source === 'md' ? [F.html] : [{ ...F.png, description: 'Image per page' }, { ...F.jpeg, description: 'Smaller images' }, { ...F.txt, description: 'Extract text' }]),
    options: [
      {
        id: 'resolution',
        type: 'select',
        label: 'Resolution',
        choices: [
          { value: '1', label: '72 DPI — small files' },
          { value: '2', label: '144 DPI — sharp on screens' },
          { value: '3', label: '216 DPI — good for print' },
        ],
        default: '2',
        appliesTo: ['png', 'jpeg'],
      },
      {
        id: 'quality',
        type: 'range',
        label: 'Quality',
        min: 30,
        max: 100,
        step: 1,
        default: 90,
        format: (v) => `${v}%`,
        appliesTo: ['jpeg'],
      },
    ],
    limits: { warn: 50 * MB, max: 300 * MB },
    load: () => import('./converters/document').then((m) => m.default),
  },
  {
    id: 'video',
    icon: 'video',
    title: 'Video',
    summary: 'Convert video to MP4 or WebM, make a GIF from a clip, or pull out the soundtrack as MP3.',
    inputs: [F.mp4, F.webm, F.mov, F.mkv, F.avi],
    aliases: { m4v: 'mp4', qt: 'mov' },
    outputs: [F.mp4, F.webm, gifAnim, mp3Track],
    targetsFor: (source) => [F.mp4, F.webm, gifAnim, mp3Track].filter((f) => f.id !== source),
    options: [
      {
        id: 'quality',
        type: 'select',
        label: 'Quality',
        choices: [
          { value: 'high', label: 'High — bigger file' },
          { value: 'medium', label: 'Balanced' },
          { value: 'low', label: 'Small — lower quality' },
        ],
        default: 'medium',
        appliesTo: ['mp4', 'webm'],
      },
      {
        id: 'maxWidth',
        type: 'select',
        label: 'Size',
        choices: [
          { value: '0', label: 'Original size' },
          { value: '1920', label: 'Up to 1080p' },
          { value: '1280', label: 'Up to 720p' },
          { value: '854', label: 'Up to 480p' },
        ],
        default: '0',
        hint: 'Smaller sizes convert much faster.',
        appliesTo: ['mp4', 'webm'],
      },
      {
        id: 'gifWidth',
        type: 'select',
        label: 'GIF width',
        choices: [
          { value: '320', label: '320 px' },
          { value: '480', label: '480 px' },
          { value: '640', label: '640 px' },
        ],
        default: '480',
        appliesTo: ['gif'],
      },
      {
        id: 'fps',
        type: 'select',
        label: 'Frames per second',
        choices: [
          { value: '10', label: '10 fps — smallest' },
          { value: '12', label: '12 fps' },
          { value: '15', label: '15 fps — smoother' },
        ],
        default: '12',
        appliesTo: ['gif'],
      },
    ],
    limits: { warn: 40 * MB, max: 400 * MB },
    notice: `${ffmpegNotice} Video runs on a single CPU core in your browser, so short clips work best.`,
    load: () => import('./converters/video').then((m) => m.default),
  },
  {
    id: 'audio',
    icon: 'audio',
    title: 'Audio',
    summary: 'Convert music and recordings between MP3, WAV, OGG, M4A and FLAC.',
    inputs: [F.mp3, F.wav, F.ogg, F.m4a, F.flac],
    aliases: {
      'audio/mp3': 'mp3',
      'audio/x-wav': 'wav',
      'audio/wave': 'wav',
      'audio/vnd.wave': 'wav',
      oga: 'ogg',
      opus: 'ogg',
      'audio/x-m4a': 'm4a',
      aac: 'm4a',
      'audio/x-flac': 'flac',
    },
    outputs: [F.mp3, F.wav, F.ogg, F.m4a, F.flac],
    options: [
      {
        id: 'bitrate',
        type: 'select',
        label: 'Bitrate',
        choices: [
          { value: '96', label: '96 kbps — smallest' },
          { value: '128', label: '128 kbps — good' },
          { value: '192', label: '192 kbps — great' },
          { value: '320', label: '320 kbps — best' },
        ],
        default: '192',
        appliesTo: ['mp3', 'ogg', 'm4a'],
      },
    ],
    limits: { warn: 50 * MB, max: 500 * MB },
    notice: ffmpegNotice,
    load: () => import('./converters/audio').then((m) => m.default),
  },
  {
    id: 'data',
    icon: 'data',
    title: 'Data',
    summary: 'Convert spreadsheets and structured data between CSV, JSON and YAML.',
    inputs: [F.csv, F.json, F.yaml],
    aliases: { 'text/csv': 'csv', 'application/json': 'json', tsv: 'csv', yml: 'yaml', 'application/x-yaml': 'yaml', 'text/yaml': 'yaml' },
    outputs: [F.json, F.csv, F.yaml],
    options: [
      {
        id: 'inferTypes',
        type: 'checkbox',
        label: 'Detect numbers and true/false values',
        hint: 'Off keeps every cell as text.',
        default: true,
        appliesTo: ['json', 'yaml'],
      },
    ],
    limits: { warn: 25 * MB, max: 200 * MB },
    load: () => import('./converters/data').then((m) => m.default),
  },
];

/** Every extension we accept, for the file picker's `accept` attribute. */
export function acceptFor(list: ConverterModule[] = converters): string {
  const exts = new Set<string>();
  for (const c of list) {
    for (const f of c.inputs) exts.add(`.${f.ext}`);
    for (const k of Object.keys(c.aliases ?? {})) if (!k.includes('/')) exts.add(`.${k}`);
    if (c.inputs.some((f) => f.id === 'jpeg')) exts.add('.jpeg');
  }
  return [...exts].join(',');
}
export const acceptAttribute = acceptFor();

export interface Match {
  converter: ConverterModule;
  source: Format;
}

/**
 * Work out which converter(s) can handle a file and what format it is.
 * We trust the extension first (it's what the user sees), then fall back to the MIME type.
 */
export function detect(file: File): Match[] {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  const mime = file.type.toLowerCase();
  const matches: Match[] = [];
  for (const converter of converters) {
    const resolve = (key: string) => {
      if (!key) return undefined;
      const id = converter.aliases?.[key] ?? key;
      return converter.inputs.find((f) => f.id === id || f.ext === id || f.mime === id);
    };
    const source = resolve(ext) ?? resolve(mime);
    if (source) matches.push({ converter, source });
  }
  return matches;
}

/** Output formats offered for a given input. */
export function targetsFor(converter: ConverterModule, source: Format): Format[] {
  return converter.targetsFor ? converter.targetsFor(source.id) : converter.outputs.filter((f) => f.id !== source.id);
}
