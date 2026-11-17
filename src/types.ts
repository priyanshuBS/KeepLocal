/**
 * The converter plug-in contract.
 *
 * The app shell (main.ts) knows nothing about CSV, images or audio. It only talks to
 * objects shaped like `ConverterModule`. To add a new converter you:
 *   1. write a module that implements `ConverterEngine` (the heavy code),
 *   2. describe it with a `ConverterModule` (cheap metadata + a lazy `load()`),
 *   3. add it to the list in `registry.ts`.
 * Nothing in the shell needs to change.
 */

/** One format a converter can read or write. */
export interface Format {
  /** Stable id, e.g. "csv", "jpeg". */
  id: string;
  /** Human label shown on buttons, e.g. "JPEG". */
  label: string;
  /** File extension used for the downloaded result (no dot). */
  ext: string;
  /** MIME type of the produced Blob. */
  mime: string;
  /** Short description shown on the format picker, e.g. "Lossless, transparent". */
  description?: string;
}

interface BaseOption {
  /** Key under which the value is passed to `convert()`. */
  id: string;
  label: string;
  /** Only show this option when one of these target formats is selected. Omit = always. */
  appliesTo?: string[];
  hint?: string;
}

export interface RangeOption extends BaseOption {
  type: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  /** Formats the displayed value, e.g. v => `${v}%`. */
  format?: (v: number) => string;
}

export interface SelectOption extends BaseOption {
  type: 'select';
  choices: { value: string; label: string }[];
  default: string;
}

export interface CheckboxOption extends BaseOption {
  type: 'checkbox';
  default: boolean;
}

export type OptionSpec = RangeOption | SelectOption | CheckboxOption;
export type OptionValues = Record<string, number | string | boolean>;

/** What the shell hands a converter while it works. */
export interface ConvertContext {
  /**
   * Report progress. `ratio` is 0..1, or `null` for "busy, unknown duration".
   * `label` is an optional short status message.
   */
  onProgress: (ratio: number | null, label?: string) => void;
  /** Fires when the user presses Cancel. Long-running converters should honour it. */
  signal: AbortSignal;
}

/**
 * A richer result than a bare Blob, for converters that produce bundles
 * (e.g. a multi-page PDF -> a ZIP of page images).
 */
export interface ConvertOutput {
  blob: Blob;
  /** Override the download extension (e.g. "zip"); defaults to the target format's ext. */
  ext?: string;
  /** Short human summary shown with the result, e.g. "12 pages". */
  summary?: string;
  /** Small previews to show instead of the blob itself (e.g. the first few pages). */
  thumbnails?: Blob[];
}

/** The heavy part of a converter — only downloaded when actually needed. */
export interface ConverterEngine {
  /**
   * Optional warm-up (e.g. downloading a WASM binary). Called as soon as the
   * converter's panel opens so the user isn't kept waiting after pressing Convert.
   */
  prepare?: (ctx: ConvertContext) => Promise<void>;
  convert: (
    file: File,
    sourceId: string,
    targetId: string,
    options: OptionValues,
    ctx: ConvertContext,
  ) => Promise<Blob | ConvertOutput>;
}

/** Cheap, always-loaded metadata describing a converter. */
export interface ConverterModule {
  id: string;
  title: string;
  /** Icon key (see CONVERTER_ICONS in main.ts). */
  icon: string;
  /** One-line description shown in the UI. */
  summary: string;
  /** Formats this converter can read. */
  inputs: Format[];
  /** Extra extensions/MIME types that map onto one of `inputs` (e.g. "jpg" -> "jpeg"). */
  aliases?: Record<string, string>;
  /** Formats this converter can write. */
  outputs: Format[];
  /** Which outputs make sense for a given input (defaults to all outputs except the input). */
  targetsFor?: (sourceId: string) => Format[];
  options: OptionSpec[];
  /** Size guardrails in bytes: above `warn` we show a notice, above `max` we refuse. */
  limits: { warn: number; max: number };
  /** Optional note shown when the panel opens (e.g. "first use downloads ~31 MB"). */
  notice?: string;
  /** Lazily import the engine. Vite turns each dynamic import into its own chunk. */
  load: () => Promise<ConverterEngine>;
}

/** Thrown by converters for problems the user can understand and act on. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}
