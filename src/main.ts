/**
 * The app shell: file intake (drag & drop / picker), converter selection, options,
 * progress, results and download. It never imports a converter engine directly —
 * it only uses the metadata in registry.ts and calls `load()` when needed.
 */
import './styles.css';
import { acceptAttribute, converters, detect, targetsFor, type Match } from './registry';
import { UserFacingError, type ConverterEngine, type ConvertOutput, type Format, type OptionSpec, type OptionValues } from './types';
import { formatBytes, h, icon, ICONS } from './lib/dom';

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dropzone = $<HTMLDivElement>('dropzone');
const dzError = $<HTMLDivElement>('dz-error');
const workspace = $<HTMLDivElement>('workspace');
const fileInput = $<HTMLInputElement>('file-input');
const chooseBtn = $<HTMLButtonElement>('choose');

fileInput.accept = acceptAttribute;

// ---------------------------------------------------------------------------
// "Supported formats" list
// ---------------------------------------------------------------------------
/** Human-readable "from → to" summary for each converter. */
const FORMAT_SUMMARY: Record<string, [string, string][]> = {
  image: [['PNG, JPG, WebP, SVG, GIF, BMP, AVIF', 'PNG, JPG, WebP, PDF']],
  document: [
    ['PDF', 'PNG, JPG, TXT'],
    ['Markdown', 'HTML'],
  ],
  video: [['MP4, MOV, WebM, MKV, AVI', 'MP4, WebM, GIF, MP3']],
  audio: [['MP3, WAV, OGG, M4A, FLAC', 'MP3, WAV, OGG, M4A, FLAC']],
  data: [['CSV, JSON, YAML', 'CSV, JSON, YAML']],
};

$('formats').replaceChildren(
  ...converters.map((c) =>
    h(
      'div',
      {},
      h('dt', {}, c.title),
      h(
        'dd',
        {},
        ...(FORMAT_SUMMARY[c.id] ?? [[c.inputs.map((f) => f.label).join(', '), c.outputs.map((f) => f.label).join(', ')]]).map(
          ([from, to]) =>
            h(
              'div',
              { class: 'route' },
              ...from.split(', ').map((f) => h('span', { class: 'chip' }, f)),
              h('span', { class: 'route-arrow', 'aria-label': 'to' }, '→'),
              ...to.split(', ').map((f) => h('span', { class: 'chip' }, f)),
            ),
        ),
      ),
    ),
  ),
);

// ---------------------------------------------------------------------------
// Hero ticker: cycles through example conversions. Purely decorative.
// ---------------------------------------------------------------------------
const EXAMPLES: [string, string][] = [
  ['photo.png', 'photo.webp'],
  ['report.pdf', 'report.txt'],
  ['clip.mp4', 'clip.gif'],
  ['song.wav', 'song.mp3'],
  ['data.csv', 'data.json'],
  ['scan.jpg', 'scan.pdf'],
  ['notes.md', 'notes.html'],
];
const tickerInner = document.querySelector<HTMLElement>('.ticker-inner');
if (tickerInner && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let i = 0;
  setInterval(() => {
    tickerInner.classList.add('is-leaving');
    setTimeout(() => {
      i = (i + 1) % EXAMPLES.length;
      $('ticker-from').textContent = EXAMPLES[i][0];
      $('ticker-to').textContent = EXAMPLES[i][1];
      // Jump below without animating, then slide up into place.
      tickerInner.classList.remove('is-leaving');
      tickerInner.classList.add('is-entering');
      void tickerInner.offsetWidth; // force a reflow so the next change animates
      tickerInner.classList.remove('is-entering');
    }, 350);
  }, 2600);
}

// ---------------------------------------------------------------------------
// Engine cache: each converter's heavy code is imported at most once.
// ---------------------------------------------------------------------------
const engines = new Map<string, Promise<ConverterEngine>>();
function loadEngine(id: string, load: () => Promise<ConverterEngine>): Promise<ConverterEngine> {
  let p = engines.get(id);
  if (!p) {
    p = load().catch((err) => {
      engines.delete(id); // allow a retry
      console.error(`[keeplocal] failed to load ${id} converter`, err);
      throw new UserFacingError(
        'This converter could not be loaded. If you are offline, reconnect once so it can be cached, then try again.',
      );
    });
    engines.set(id, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Session state (one per chosen file)
// ---------------------------------------------------------------------------
interface Session {
  file: File;
  matches: Match[];
  match: Match;
  target: Format;
  options: OptionValues;
  engine: ConverterEngine | null;
  busy: boolean;
  abort: AbortController | null;
  resultUrl: string | null;
}
let session: Session | null = null;

// Pieces of the workspace we update in place.
let noticesEl: HTMLDivElement;
let optionsEl: HTMLDivElement;
let statusEl: HTMLDivElement;
let convertBtn: HTMLButtonElement;
let cancelBtn: HTMLButtonElement;

/** URLs for thumbnail previews, revoked when the result is cleared. */
let thumbUrls: string[] = [];

function defaultOptions(specs: OptionSpec[]): OptionValues {
  return Object.fromEntries(specs.map((s) => [s.id, s.default]));
}

// ---------------------------------------------------------------------------
// File intake
// ---------------------------------------------------------------------------
function showDropzoneError(message: string) {
  dzError.textContent = message;
  dzError.hidden = false;
}

function openFile(file: File) {
  dzError.hidden = true;
  if (file.size === 0) return showDropzoneError(`“${file.name}” is empty (0 bytes).`);

  const matches = detect(file);
  if (matches.length === 0) {
    return showDropzoneError(`“${file.name}” isn't a supported file type. See the list of supported formats below.`);
  }
  const limit = matches[0].converter.limits;
  if (file.size > limit.max) {
    return showDropzoneError(
      `“${file.name}” is ${formatBytes(file.size)}. Files of this type are limited to ${formatBytes(limit.max)} so your browser doesn't run out of memory.`,
    );
  }

  endSession();
  const match = matches[0];
  const targets = targetsFor(match.converter, match.source);
  session = {
    file,
    matches,
    match,
    target: targets.find((f) => f.id !== match.source.id) ?? targets[0],
    options: defaultOptions(match.converter.options),
    engine: null,
    busy: false,
    abort: null,
    resultUrl: null,
  };
  dropzone.hidden = true;
  workspace.hidden = false;
  renderWorkspace();
  prepareEngine(session);
}

/**
 * Stop any <audio>/<video> previews inside `root` so they stop reading their blob URL.
 * Without this, a player that is still loading can try to read a URL we've just freed.
 */
function releaseMedia(root: Element) {
  root.querySelectorAll('audio, video').forEach((el) => {
    const media = el as HTMLMediaElement;
    media.pause();
    media.removeAttribute('src');
    media.load(); // aborts any in-flight read
  });
}

/** Free blob URLs a moment later, once nothing on the page can still be reading them. */
function revokeLater(urls: (string | null)[]) {
  const list = urls.filter((u): u is string => !!u);
  if (list.length) setTimeout(() => list.forEach((u) => URL.revokeObjectURL(u)), 1000);
}

function endSession() {
  if (!session) return;
  session.abort?.abort();
  releaseMedia(workspace);
  workspace.replaceChildren();
  revokeLater([session.resultUrl, ...thumbUrls]);
  thumbUrls = [];
  session = null;
}

function reset() {
  endSession();
  workspace.hidden = true;
  dropzone.hidden = false;
  fileInput.value = '';
  dropzone.focus();
}

// Picker
chooseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) openFile(file);
});

// Drag & drop anywhere on the page. We must cancel `dragover` for `drop` to fire, and
// cancelling `drop` stops the browser from navigating away to display the file.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  document.body.classList.add('is-dragging');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('is-dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('is-dragging');
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  if (session?.busy) return; // don't swap files mid-conversion
  openFile(files[0]);
  if (files.length > 1) {
    showWorkspaceNotice('info', `${files.length} files were dropped. Keeplocal converts one at a time, so only “${files[0].name}” was opened.`);
  }
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function showWorkspaceNotice(kind: 'info' | 'warn' | 'error', text: string) {
  noticesEl?.append(h('div', { class: `notice notice-${kind}` }, text));
}

function renderWorkspace() {
  const s = session!;
  const { converter, source } = s.match;

  noticesEl = h('div', { class: 'notices' });
  optionsEl = h('div', { class: 'options' });
  statusEl = h('div', { class: 'output' });
  convertBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => convert() });
  cancelBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => session?.abort?.abort() }, 'Cancel');

  // Converter picker — only shown if more than one converter claims the file.
  const converterPicker =
    s.matches.length > 1
      ? field(
          'Converter',
          choices(
            'converter',
            s.matches.map((m) => ({ value: m.converter.id, label: m.converter.title })),
            converter.id,
            (id) => {
              s.match = s.matches.find((m) => m.converter.id === id)!;
              s.target = targetsFor(s.match.converter, s.match.source)[0];
              s.options = defaultOptions(s.match.converter.options);
              s.engine = null;
              renderWorkspace();
              prepareEngine(s);
            },
          ),
        )
      : null;

  const targets = targetsFor(converter, source);
  const targetPicker = field(
    'Convert to',
    choices(
      'target',
      targets.map((f) => ({ value: f.id, label: f.label })),
      s.target.id,
      (id) => {
        s.target = targets.find((f) => f.id === id)!;
        clearResult();
        renderOptions();
        updateConvertButton();
      },
    ),
  );

  workspace.replaceChildren(
    h(
      'div',
      { class: 'workspace' },
      h(
        'div',
        { class: 'pane' },
        h(
          'div',
          { class: 'file-row' },
          h('span', { class: 'file-ext', 'aria-hidden': 'true' }, source.ext.slice(0, 4)),
          h('span', { class: 'file-name', title: s.file.name }, s.file.name),
          h('span', { class: 'file-meta' }, `${source.label} · ${formatBytes(s.file.size)}`),
          h('button', { class: 'btn btn-link', type: 'button', onclick: () => !s.busy && reset() }, 'Change file'),
        ),
        noticesEl,
        converterPicker,
        targetPicker,
        optionsEl,
        h('div', { class: 'pane-actions' }, convertBtn, cancelBtn),
      ),
      statusEl,
    ),
  );

  if (s.file.size > converter.limits.warn) {
    showWorkspaceNotice(
      'warn',
      `This is a large file (${formatBytes(s.file.size)}). Conversion happens in your browser's memory, so it may be slow and could fail on phones.`,
    );
  }
  if (converter.notice) showWorkspaceNotice('info', converter.notice);

  renderOptions();
  updateConvertButton();
}

function field(label: string, control: HTMLElement, hint?: string) {
  return h('div', {}, h('span', { class: 'field-label' }, label), control, hint ? h('p', { class: 'hint' }, hint) : null);
}

/** A row of plain buttons backed by radio inputs (keyboard-accessible). */
function choices(name: string, items: { value: string; label: string }[], selected: string, onChange: (v: string) => void) {
  return h(
    'div',
    { class: 'choices', role: 'radiogroup' },
    ...items.map((item) =>
      h(
        'label',
        { class: 'choice' },
        h('input', { type: 'radio', name, value: item.value, checked: item.value === selected, onchange: () => onChange(item.value) }),
        h('span', {}, item.label),
      ),
    ),
  );
}

/** Build controls for the options that apply to the selected target format. */
function renderOptions() {
  const s = session!;
  const specs = s.match.converter.options.filter((o) => !o.appliesTo || o.appliesTo.includes(s.target.id));
  optionsEl.replaceChildren(
    ...specs.map((spec) => {
      const onChange = (v: number | string | boolean) => {
        s.options[spec.id] = v;
        clearResult();
      };
      const id = `opt-${spec.id}`;
      const hint = spec.hint ? h('p', { class: 'hint' }, spec.hint) : null;

      if (spec.type === 'range') {
        const value = Number(s.options[spec.id]);
        const out = h('output', { class: 'range-value', for: id }, spec.format ? spec.format(value) : String(value));
        const input = h('input', {
          id,
          type: 'range',
          min: spec.min,
          max: spec.max,
          step: spec.step,
          value: String(value),
          oninput: () => {
            const v = Number(input.value);
            out.textContent = spec.format ? spec.format(v) : String(v);
            onChange(v);
          },
        });
        return h('div', {}, h('div', { class: 'range-head' }, h('label', { class: 'field-label', for: id }, spec.label), out), input, hint);
      }
      if (spec.type === 'select') {
        const select = h(
          'select',
          { id, onchange: () => onChange(select.value) },
          ...spec.choices.map((c) => h('option', { value: c.value, selected: c.value === s.options[spec.id] }, c.label)),
        );
        return h('div', {}, h('label', { class: 'field-label', for: id }, spec.label), select, hint);
      }
      const box = h('input', { id, type: 'checkbox', checked: Boolean(s.options[spec.id]), onchange: () => onChange(box.checked) });
      return h('label', { class: 'check', for: id }, box, h('span', {}, spec.label, hint));
    }),
  );
}

function updateConvertButton() {
  const s = session;
  if (!s) return;
  convertBtn.replaceChildren(`Convert to ${s.target.label}`, h('span', { class: 'btn-arrow', 'aria-hidden': 'true' }, '→'));
  convertBtn.disabled = !s.engine || s.busy;
  convertBtn.hidden = s.busy;
  cancelBtn.hidden = !s.busy;
}

// ---------------------------------------------------------------------------
// Output area: progress, errors, results
// ---------------------------------------------------------------------------
function showProgress(ratio: number | null, label = 'Working…') {
  let wrap = statusEl.querySelector<HTMLDivElement>('.progress');
  if (!wrap) {
    wrap = h(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' },
      h('div', { class: 'progress-top' }, h('span', { class: 'progress-label' }), h('span', { class: 'progress-pct' })),
      h('div', { class: 'progress-track' }, h('div', { class: 'progress-bar' })),
    );
    statusEl.replaceChildren(wrap);
  }
  wrap.classList.toggle('is-indeterminate', ratio === null);
  wrap.querySelector('.progress-label')!.textContent = label;
  wrap.querySelector('.progress-pct')!.textContent = ratio === null ? '' : `${Math.round(ratio * 100)}%`;
  wrap.querySelector<HTMLDivElement>('.progress-bar')!.style.width = ratio === null ? '' : `${ratio * 100}%`;
  if (ratio === null) wrap.removeAttribute('aria-valuenow');
  else wrap.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
}

function showError(err: unknown, retry?: () => void) {
  const message =
    err instanceof UserFacingError ? err.message : `Something went wrong while converting: ${err instanceof Error ? err.message : String(err)}`;
  if (!(err instanceof UserFacingError)) console.error('[keeplocal]', err);
  statusEl.replaceChildren(
    h(
      'div',
      { class: 'state-pad' },
      h(
        'div',
        { class: 'notice notice-error', role: 'alert' },
        h('span', {}, message),
        retry ? h('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again') : null,
      ),
    ),
  );
}

function clearResult() {
  const s = session;
  if (!s || s.busy) return;
  releaseMedia(statusEl);
  statusEl.replaceChildren();
  revokeLater([s.resultUrl, ...thumbUrls]);
  s.resultUrl = null;
  thumbUrls = [];
}

function outputName(file: File, ext: string) {
  const base = file.name.replace(/\.[^.]+$/, '') || 'converted';
  const sameExt = file.name.toLowerCase().endsWith(`.${ext}`);
  return `${base}${sameExt ? '-converted' : ''}.${ext}`;
}

/** Pick a preview based on what the converter actually produced. */
async function buildPreview(out: ConvertOutput, url: string, name: string): Promise<HTMLElement> {
  const type = out.blob.type;
  if (out.thumbnails?.length) {
    thumbUrls = out.thumbnails.map((b) => URL.createObjectURL(b));
    return h('div', { class: 'thumbs' }, ...thumbUrls.map((u, i) => h('img', { src: u, alt: `Page ${i + 1}` })));
  }
  if (type.startsWith('image/')) return h('img', { src: url, alt: `Preview of ${name}` });
  if (type.startsWith('audio/')) return h('audio', { src: url, controls: true, preload: 'metadata' });
  if (type.startsWith('video/')) return h('video', { src: url, controls: true, preload: 'metadata', playsinline: true });
  if (type.startsWith('text/') || /json|yaml|xml/.test(type)) {
    const LIMIT = 4000;
    const text = await out.blob.slice(0, LIMIT * 4).text();
    const shown = text.length > LIMIT ? text.slice(0, LIMIT) + '\n…' : text;
    return h('pre', { tabindex: '0', 'aria-label': 'Preview of converted file' }, shown);
  }
  // PDFs, ZIPs and other binary files: no inline preview.
  return h('p', { class: 'doc-preview' }, out.summary ?? 'No preview for this file type.');
}

async function showResult(s: Session, result: Blob | ConvertOutput, elapsedMs: number) {
  const out: ConvertOutput = result instanceof Blob ? { blob: result } : result;
  const blob = out.blob;
  const url = URL.createObjectURL(blob);
  s.resultUrl = url;
  const name = outputName(s.file, out.ext ?? s.target.ext);

  const saved = 1 - blob.size / s.file.size;
  const sizes = h(
    'div',
    { class: 'result-sizes' },
    `${formatBytes(blob.size)}`,
    out.summary ? ` · ${out.summary}` : '',
    saved >= 0.01 ? h('span', { class: 'saved' }, ` · ${Math.round(saved * 100)}% smaller`) : null,
  );

  const download = h('a', { class: 'btn btn-primary', href: url, download: name }, icon(ICONS.download), 'Download');
  const preview = await buildPreview(out, url, name);

  statusEl.replaceChildren(
    h(
      'div',
      { class: 'result-head' },
      h('div', { class: 'result-info' }, h('div', { class: 'result-name', title: name }, name), sizes),
      download,
    ),
    // A little proof of the privacy promise, right where the result appears.
    h(
      'div',
      { class: 'result-stats' },
      h('span', {}, `Converted in ${elapsedMs < 1000 ? `${Math.max(1, Math.round(elapsedMs))} ms` : `${(elapsedMs / 1000).toFixed(1)} s`}`),
      h('span', {}, '0 bytes uploaded'),
      h('span', {}, 'Processed on this device'),
    ),
    h('div', { class: 'result-preview' }, preview),
  );
  download.focus({ preventScroll: true });
  statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Engine preparation + conversion
// ---------------------------------------------------------------------------
async function prepareEngine(s: Session) {
  const { converter } = s.match;
  const isCurrent = () => session === s && s.match.converter === converter;
  try {
    // Only show a loading bar if the engine takes noticeable time (e.g. FFmpeg download).
    const slow = setTimeout(() => isCurrent() && !s.engine && showProgress(null, 'Loading converter…'), 150);
    const engine = await loadEngine(converter.id, converter.load);
    if (engine.prepare) {
      await engine.prepare({
        onProgress: (r, label) => isCurrent() && showProgress(r, label),
        signal: new AbortController().signal,
      });
    }
    clearTimeout(slow);
    if (!isCurrent()) return;
    s.engine = engine;
    statusEl.replaceChildren();
    updateConvertButton();
  } catch (err) {
    if (isCurrent()) showError(err, () => prepareEngine(s));
  }
}

async function convert() {
  const s = session;
  if (!s || !s.engine || s.busy) return;
  clearResult();
  s.busy = true;
  s.abort = new AbortController();
  updateConvertButton();
  showProgress(null, 'Converting…');

  const started = performance.now();
  try {
    const result = await s.engine.convert(s.file, s.match.source.id, s.target.id, { ...s.options }, {
      onProgress: (r, label) => session === s && showProgress(r, label),
      signal: s.abort.signal,
    });
    if (session !== s) return;
    s.busy = false;
    await showResult(s, result, performance.now() - started);
    console.info(`[keeplocal] converted in ${Math.round(performance.now() - started)} ms`);
  } catch (err) {
    if (session !== s) return;
    s.busy = false;
    if (err instanceof DOMException && err.name === 'AbortError') {
      statusEl.replaceChildren(h('p', { class: 'status-text' }, 'Conversion cancelled.'));
    } else {
      showError(err);
    }
  } finally {
    if (session === s) {
      s.busy = false;
      s.abort = null;
      updateConvertButton();
    }
  }
}

// ---------------------------------------------------------------------------
// Offline support: a service worker caches the app after the first visit.
// Only in production builds — in dev it would fight with Vite's hot reloading.
// ---------------------------------------------------------------------------
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[keeplocal] offline cache unavailable', err));
  });
}
