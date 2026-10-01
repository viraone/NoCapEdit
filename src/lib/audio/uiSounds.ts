/**
 * Short interface sounds, synthesised with Web Audio so they ship no files.
 * They are feedback for the person editing and never reach the project or
 * the export.
 */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** One blade closing: a burst of filtered noise with a sharp attack. */
function blade(ac: AudioContext, at: number, freq: number, gain: number) {
  const len = Math.round(ac.sampleRate * 0.05);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18));
  const src = ac.createBufferSource();
  src.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = 1.4;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
  src.connect(band).connect(amp).connect(ac.destination);
  src.start(at);
  src.stop(at + 0.06);
}

/** A scissors "snip", played when a clip is cut on the timeline. */
export function playCutSound() {
  try {
    const ac = context();
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    blade(ac, t, 5200, 0.5);
    blade(ac, t + 0.045, 3600, 0.4);
  } catch {
    /* sound is a nicety; a blocked or missing audio device must not stop the cut */
  }
}
