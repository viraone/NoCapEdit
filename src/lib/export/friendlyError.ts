/**
 * Turns the raw error an export throws into a sentence someone can act on,
 * instead of the message a browser or codec library happens to produce.
 *
 * Pure and dependency-free so the phone editor, the desktop panel and the
 * tests all share it. Callers still log the raw error with console.error
 * before showing this text, so the technical detail is not lost.
 */

/** The last resort: something we cannot name. */
export const UNKNOWN_EXPORT_ERROR = "Something went wrong while making the video. Try again, or pick a smaller size.";

/** A cancelled export is not a failure; most callers handle it themselves. */
export const CANCELLED_EXPORT_ERROR = "Export cancelled.";

const H264_CONFIG_ERROR = "This device can't encode video at this size. Pick a smaller size and try again.";
const OUT_OF_MEMORY_ERROR = "This device ran out of memory while making the video. Try a shorter clip, or a smaller size, and try again.";
const QUOTA_ERROR = "There isn't enough storage on this device to finish the export. Free up some space and try again.";
const NO_WEBCODECS_ERROR = "This browser can't encode video. Use the latest Safari, Chrome or Edge, or export from the desktop editor.";
const DECODE_ERROR = "This video couldn't be read. Try a different clip, or save it again and try once more.";

function nameOf(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err && typeof (err as { name?: unknown }).name === "string") {
    return (err as { name: string }).name;
  }
  return "";
}

function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return typeof err === "number" || typeof err === "boolean" ? String(err) : "";
}

/** A message that already reads as a sentence written for a person, e.g. the
 * analyser's "Couldn't hear any speech" or the save picker's folder notice. */
function isPlainSentence(message: string): boolean {
  const text = message.trim();
  if (text.length < 8 || text.length > 240) return false;
  if (!/^[A-Z]/.test(text) || !/[.!?]$/.test(text)) return false;
  return !/(?:\bat\s+\w+\s+\(|\.js:\d|\bundefined\b|\bnull\b|\bNaN\b|TypeError|DOMException|\n)/.test(text);
}

/**
 * Maps an export failure to a plain sentence that says what happened and what
 * to try. Known failures get a specific sentence; a message that is already
 * written for people is kept; anything else gets one generic sentence.
 */
export function friendlyExportError(err: unknown): string {
  const name = nameOf(err);
  const message = messageOf(err);
  const text = `${name} ${message}`.trim();
  if (!text) return UNKNOWN_EXPORT_ERROR;

  // Out of memory first: emscripten's abort is called "Aborted(OOM)", which
  // would otherwise read as a cancellation.
  if (/aborted\s*\(\s*oom\s*\)|\bout of memory\b|no available backend|allocation (?:failed|error)|failed to allocate|cannot allocate|memory access out of bounds/i.test(text)) {
    return OUT_OF_MEMORY_ERROR;
  }
  // A full disk can surface as an aborted write, so check it before cancel.
  if (name === "QuotaExceededError" || /quota|disk (?:is )?full|no space left|not enough (?:space|storage)|storage (?:is )?full|ENOSPC/i.test(text)) {
    return QUOTA_ERROR;
  }
  if (name === "AbortError" || /\b(?:export|user|operation)\s+(?:was\s+)?(?:cancelled|canceled|aborted)\b|\b(?:cancelled|canceled)\s+by (?:the )?user\b/i.test(text)) {
    return CANCELLED_EXPORT_ERROR;
  }
  if (/no supported h\.?264|h\.?264 encoder|encoder configuration|no supported[^.]*encoder/i.test(text)) {
    return H264_CONFIG_ERROR;
  }
  if (/webcodecs|videoencoder|audioencoder|videodecoder|requestvideoframecallback|isconfigsupported/i.test(text)) {
    return NO_WEBCODECS_ERROR;
  }
  if (name === "NotSupportedError" || /decod(?:e|ed|ing)|no video track|unrecogni[sz]ed file format|unsupported (?:video|codec|format)|no supported sources|media (?:error|element)|srcloaderror/i.test(text)) {
    return DECODE_ERROR;
  }
  if (isPlainSentence(message)) return message.trim();
  return UNKNOWN_EXPORT_ERROR;
}
