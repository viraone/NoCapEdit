/**
 * Client-side translation. Prefers the browser's built-in Translation API
 * (Chrome) and falls back to Marian models running in the ML worker.
 */
import { mlRequest, type MlProgress } from "./mlClient";
import { resolveTranslationRoute } from "./languages";

interface NativeTranslator {
  translate(text: string): Promise<string>;
  destroy?(): void;
}
interface NativeTranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<NativeTranslator>;
}

function nativeTranslator(): NativeTranslatorStatic | null {
  const t = (globalThis as unknown as { Translator?: NativeTranslatorStatic }).Translator;
  return t && typeof t.create === "function" ? t : null;
}

export interface TranslateOptions {
  source: string;
  target: string;
  onProgress?: (p: MlProgress) => void;
  signal?: AbortSignal;
  /** Skip the native browser API even when present. */
  forceOnDeviceModel?: boolean;
}

export interface TranslateResult {
  translations: string[];
  engine: "browser" | "marian" | "copy";
}

export function canTranslate(source: string, target: string): boolean {
  return !!nativeTranslator() || resolveTranslationRoute(source, target) !== null;
}

export async function translateTexts(texts: string[], opts: TranslateOptions): Promise<TranslateResult> {
  if (opts.source === opts.target) return { translations: [...texts], engine: "copy" };

  const native = opts.forceOnDeviceModel ? null : nativeTranslator();
  if (native) {
    try {
      const availability = await native.availability({ sourceLanguage: opts.source, targetLanguage: opts.target });
      if (availability !== "unavailable") {
        opts.onProgress?.({ stage: "load", message: "Preparing browser translator", progress: null });
        const translator = await native.create({
          sourceLanguage: opts.source,
          targetLanguage: opts.target,
          monitor: (m) =>
            m.addEventListener("downloadprogress", (e) => {
              const loaded = (e as ProgressEvent).loaded;
              opts.onProgress?.({ stage: "download", message: "Downloading language pack", progress: loaded ?? null });
            }),
        });
        const out: string[] = [];
        for (let i = 0; i < texts.length; i++) {
          if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          out.push(texts[i].trim() ? await translator.translate(texts[i]) : "");
          opts.onProgress?.({ stage: "translate", message: `Translating ${i + 1} / ${texts.length}`, progress: (i + 1) / texts.length });
        }
        translator.destroy?.();
        return { translations: out, engine: "browser" };
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // Fall through to on-device models.
    }
  }

  const steps = resolveTranslationRoute(opts.source, opts.target);
  if (!steps) throw new Error(`No on-device translation model is available for ${opts.source} → ${opts.target}.`);
  const result = await mlRequest<{ translations: string[] }>(
    (id) => ({ type: "translate", id, texts, steps }),
    opts.onProgress,
    opts.signal,
  );
  return { translations: result.translations, engine: "marian" };
}
