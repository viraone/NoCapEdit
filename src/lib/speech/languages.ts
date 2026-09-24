export interface Language {
  code: string;
  name: string;
  /** ISO 639-3 code used as a target token by the multilingual Marian models. */
  iso3: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", iso3: "eng" },
  { code: "es", name: "Spanish", iso3: "spa" },
  { code: "fr", name: "French", iso3: "fra" },
  { code: "de", name: "German", iso3: "deu" },
  { code: "it", name: "Italian", iso3: "ita" },
  { code: "pt", name: "Portuguese", iso3: "por" },
  { code: "nl", name: "Dutch", iso3: "nld" },
  { code: "ru", name: "Russian", iso3: "rus" },
  { code: "uk", name: "Ukrainian", iso3: "ukr" },
  { code: "zh", name: "Chinese", iso3: "cmn_Hans" },
  { code: "ja", name: "Japanese", iso3: "jpn" },
  { code: "ko", name: "Korean", iso3: "kor" },
  { code: "ar", name: "Arabic", iso3: "ara" },
  { code: "hi", name: "Hindi", iso3: "hin" },
  { code: "id", name: "Indonesian", iso3: "ind" },
  { code: "vi", name: "Vietnamese", iso3: "vie" },
  { code: "tr", name: "Turkish", iso3: "tur" },
  { code: "pl", name: "Polish", iso3: "pol" },
  { code: "sv", name: "Swedish", iso3: "swe" },
  { code: "da", name: "Danish", iso3: "dan" },
  { code: "fi", name: "Finnish", iso3: "fin" },
  { code: "cs", name: "Czech", iso3: "ces" },
  { code: "hu", name: "Hungarian", iso3: "hun" },
  { code: "ro", name: "Romanian", iso3: "ron" },
  { code: "th", name: "Thai", iso3: "tha" },
  { code: "el", name: "Greek", iso3: "ell" },
  { code: "he", name: "Hebrew", iso3: "heb" },
  { code: "ms", name: "Malay", iso3: "msa" },
  { code: "no", name: "Norwegian", iso3: "nob" },
  { code: "af", name: "Afrikaans", iso3: "afr" },
];

export const WHISPER_LANGUAGE_OPTIONS: { code: string; name: string }[] = [
  { code: "auto", name: "Auto-detect" },
  ...LANGUAGES.map((l) => ({ code: l.code, name: l.name })),
];

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** Direct Marian (opus-mt) pairs published by Xenova on the Hugging Face Hub. */
const OPUS_MT_PAIRS = new Set([
  "en-zh", "fr-en", "es-en", "zh-en", "de-en", "ru-en", "ar-en", "ko-en", "en-de", "nl-en", "it-en", "pl-en",
  "en-fr", "en-es", "cs-en", "en-it", "fi-en", "en-ru", "sv-en", "it-fr", "da-en", "tr-en", "id-en", "ja-en",
  "fr-de", "da-de", "no-de", "fi-de", "hi-en", "en-nl", "et-en", "en-ar", "th-en", "vi-en", "en-da", "nl-fr",
  "en-fi", "en-vi", "it-es", "ro-fr", "ru-es", "ru-fr", "ru-uk", "uk-en", "uk-ru", "en-ro", "en-sv", "en-uk",
  "es-de", "es-fr", "es-it", "es-ru", "fr-es", "fr-ro", "fr-ru", "hu-en", "af-en", "de-es", "de-fr", "en-af",
  "en-hi", "en-hu", "en-id", "en-cs",
]);

const ROMANCE = new Set(["pt", "ca", "gl"]);

export interface TranslationStep {
  model: string;
  /** Target-language token prepended to every input for multilingual models. */
  prefix?: string;
}

function directStep(src: string, tgt: string): TranslationStep | null {
  if (OPUS_MT_PAIRS.has(`${src}-${tgt}`)) return { model: `Xenova/opus-mt-${src}-${tgt}` };
  if (src === "en" && tgt === "ja") return { model: "Xenova/opus-mt-en-jap" };
  if (src === "en" && ROMANCE.has(tgt)) return { model: "Xenova/opus-mt-en-ROMANCE", prefix: `>>${tgt}<<` };
  if (tgt === "en" && ROMANCE.has(src)) return { model: "Xenova/opus-mt-ROMANCE-en" };
  if (src === "en") {
    const lang = LANGUAGES.find((l) => l.code === tgt);
    if (lang) return { model: "Xenova/opus-mt-en-mul", prefix: `>>${lang.iso3}<<` };
  }
  if (tgt === "en") return { model: "Xenova/opus-mt-mul-en" };
  return null;
}

/**
 * Finds the chain of on-device Marian models that translates src -> tgt.
 * Falls back to pivoting through English when no direct model exists.
 */
export function resolveTranslationRoute(src: string, tgt: string): TranslationStep[] | null {
  if (src === tgt) return [];
  const direct = directStep(src, tgt);
  if (direct) return [direct];
  const toEn = directStep(src, "en");
  const fromEn = directStep("en", tgt);
  if (toEn && fromEn) return [toEn, fromEn];
  return null;
}
