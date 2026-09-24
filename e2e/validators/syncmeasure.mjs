import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function measureSync(file) {
  // video: per-frame average luma via signalstats
  const vout = execFileSync('ffprobe', ['-v', 'error', '-f', 'lavfi', '-i', `movie=${file.replace(/([\\':])/g, '\\$1')},signalstats`, '-show_entries', 'frame=pts_time:frame_tags=lavfi.signalstats.YAVG', '-of', 'csv=p=0'], { maxBuffer: 1 << 26 }).toString().trim().split('\n').map(l => { const [pts, y] = l.split(','); return { t: +pts, y: +y }; });
  const flashes = []; for (let i = 0; i < vout.length; i++) { if (vout[i].y > 128 && (i === 0 || vout[i - 1].y <= 128)) flashes.push(+vout[i].t.toFixed(4)); }
  // audio: raw pcm mono 48k, find onsets of energy
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  const n = pcm.length / 2; const win = 48; const onsets = []; let quiet = true; let energy = 0;
  for (let i = 0; i + win <= n; i += win) { let s = 0; for (let j = 0; j < win; j++) { const v = pcm.readInt16LE((i + j) * 2) / 32768; s += v * v; } const rms = Math.sqrt(s / win); if (quiet && rms > 0.1) { onsets.push(+(i / 48000).toFixed(4)); quiet = false; } else if (!quiet && rms < 0.02) quiet = true; }
  const pairs = flashes.map((f, i) => ({ flash: f, click: onsets[i], offsetMs: onsets[i] !== undefined ? +((onsets[i] - f) * 1000).toFixed(1) : null }));
  const offs = pairs.map(p => p.offsetMs).filter(x => x !== null);
  return { frames: vout.length, flashes, clicks: onsets, pairs, meanOffsetMs: offs.length ? +(offs.reduce((a, b) => a + b, 0) / offs.length).toFixed(1) : null, driftMs: offs.length > 1 ? +(offs[offs.length - 1] - offs[0]).toFixed(1) : null };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) console.log(JSON.stringify(measureSync(process.argv[2]), null, 1));
