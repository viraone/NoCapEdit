// Pure helpers for running the real ffmpeg on behalf of the page (docs/DESKTOP_PLAN.md, step 5).
// The page thinks it is talking to ffmpeg.wasm, whose files live in a private in-memory folder
// rooted at "/". Here that folder is a real temporary work folder, and ffmpeg runs with it as the
// current directory. These functions map names into it and refuse anything that points outside.
import path from "node:path";

/**
 * Options that make ffmpeg read or write a file named somewhere other than an input or output
 * position, or change how it finds files. The export never uses them.
 */
const BLOCKED_OPTIONS = new Set([
  "-attach", "-dump_attachment", "-passlogfile", "-progress", "-report", "-vstats_file", "-sdp_file",
  "-init_hw_device", "-filter_script", "-filter_complex_script", "-/filter_complex", "-/vf", "-/af", "-/filter",
  "-protocol_whitelist", "-safe", "-stdin",
]);

/** Options whose value is a filter graph (file names inside it are relative to the work folder). */
const FILTER_OPTIONS = /^-(filter_complex|lavfi|vf|af|filter(:[\w:]+)?)$/;

/**
 * The real path of a page-side name inside the work folder, or null when it would land outside.
 * "/a/b", "a/b" and "./a/b" all mean <root>/a/b, as they do in the page's in-memory folder.
 * @param {string} root absolute work folder
 * @param {string} name page-side path
 * @returns {string | null}
 */
export function sessionPath(root, name) {
  if (typeof name !== "string" || name === "" || name.includes("\0")) return null;
  const cleanRoot = path.resolve(root);
  const full = path.resolve(cleanRoot, name.replace(/^\/+/, ""));
  if (full === cleanRoot) return null;
  return full.startsWith(cleanRoot + path.sep) ? full : null;
}

/**
 * The first folder or file name of a page-side path: "/in_x/a.mp4" -> "in_x", "seg_0.mp4" -> "seg_0.mp4".
 * @param {string} name
 * @returns {string}
 */
export function topName(name) {
  return name.replace(/^\/+/, "").split("/")[0] ?? "";
}

const escapeRegExp = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Rewrites "/name..." to "name..." wherever a name the page created appears as an absolute path,
 * in plain arguments and inside filter graphs (e.g. "arnndn=m=/sh.rnnn"). ffmpeg runs inside the
 * work folder, so the relative form reaches the same file.
 * @param {string[]} args
 * @param {Iterable<string>} names top-level names the page created in this session
 * @returns {string[]}
 */
export function rewriteArgs(args, names) {
  const list = [...names].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp);
  if (!list.length) return [...args];
  const re = new RegExp(`(^|[=:'",\\s])/+(${list.join("|")})(?=$|[/:'",\\s\\]])`, "g");
  return args.map((a) => a.replace(re, "$1$2"));
}

/**
 * Why a file-position argument (an input or the output) is not allowed, or null when it is fine.
 * @param {string} value
 * @returns {string | null}
 */
function badFileArg(value) {
  if (value === "-") return null; // the null output, "-f null -"
  if (value.startsWith("/") || value.startsWith("~")) return "a path outside the work folder";
  if (value.split("/").includes("..")) return 'a path with ".."';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "a protocol or device name";
  if (value.includes("\0")) return "a bad character";
  return null;
}

/**
 * Checks a command after rewriteArgs. Returns null when it may run, or the reason it may not.
 * Inputs and the output must be plain relative names inside the work folder; a few options that
 * reach other files are refused. This is a guard against mistakes and a second line of defence,
 * together with the sandbox the command runs in. It is not a complete parser of ffmpeg's options.
 * @param {string[]} args
 * @returns {string | null}
 */
export function checkArgs(args) {
  if (!Array.isArray(args) || args.length === 0) return "empty command";
  if (args.length > 4000) return "too many arguments";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== "string") return "an argument that is not text";
    if (BLOCKED_OPTIONS.has(a)) return `the option ${a}`;
    if (a === "-i") {
      const bad = badFileArg(args[i + 1] ?? "");
      if (bad) return `an input that is ${bad}`;
    }
    if (FILTER_OPTIONS.test(a)) {
      const graph = args[i + 1] ?? "";
      if (/(^|[=:'",\s])(\/|~|\.\.\/)/.test(graph)) return "a filter that names a file outside the work folder";
      if (/(^|[;,\]\s])a?movie=/.test(graph)) return "the movie filter";
    }
  }
  const last = args[args.length - 1];
  if (!last.startsWith("-") || last === "-") {
    const bad = badFileArg(last);
    if (bad) return `an output that is ${bad}`;
  }
  return null;
}

/**
 * What an ffmpeg build can do, from the text of `ffmpeg -encoders` and `ffmpeg -filters`.
 * `missing` lists the pieces the export uses that this build lacks.
 * @param {string} encodersText
 * @param {string} filtersText
 * @returns {{ encoders: string[], filters: string[], missing: string[], usable: boolean }}
 */
export function parseCapabilities(encodersText, filtersText) {
  const WANT_ENCODERS = ["libx264", "libx265", "aac", "libmp3lame", "h264_videotoolbox"];
  const WANT_FILTERS = ["zscale", "tonemap", "loudnorm", "lut3d", "xfade", "arnndn", "afftdn", "overlay", "scale"];
  const has = (/** @type {string} */ text, /** @type {string} */ name) => new RegExp(`^\\s*\\S+\\s+${escapeRegExp(name)}\\s`, "m").test(text);
  const encoders = WANT_ENCODERS.filter((n) => has(encodersText, n));
  const filters = WANT_FILTERS.filter((n) => has(filtersText, n));
  const optional = new Set(["h264_videotoolbox", "libmp3lame"]);
  const missing = [...WANT_ENCODERS.filter((n) => !encoders.includes(n) && !optional.has(n)), ...WANT_FILTERS.filter((n) => !filters.includes(n))];
  // Without x264 and AAC nothing the export makes can be produced; anything else missing only
  // affects the exports that use it (see missingForArgs).
  return { encoders, filters, missing, usable: encoders.includes("libx264") && encoders.includes("aac") };
}

/**
 * The pieces from `missing` that this command needs, so the caller can use the built-in engine
 * for it instead of failing.
 * @param {string[]} args
 * @param {string[]} missing
 * @returns {string[]}
 */
export function missingForArgs(args, missing) {
  const text = args.join(" ");
  return missing.filter((name) => new RegExp(`(^|[^\\w])${escapeRegExp(name)}([^\\w]|$)`).test(text));
}

/**
 * A macOS sandbox profile for the ffmpeg process: no network, no writing outside the work folder,
 * no reading of the user's home folder or other disks.
 * @param {string} workDir absolute, already resolved (no symlinks)
 * @param {string} home the user's home folder
 * @returns {string}
 */
export function sandboxProfile(workDir, home) {
  const q = (/** @type {string} */ s) => JSON.stringify(s);
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    '(deny file-write* (subpath "/"))',
    `(allow file-write* (subpath ${q(workDir)}))`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))',
    `(deny file-read* (subpath ${q(home)}) (subpath "/Volumes"))`,
    `(allow file-read* (subpath ${q(workDir)}))`,
  ].join("\n");
}
