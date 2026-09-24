/**
 * Audio enhancement presets defined once and mapped to both halves:
 * Web Audio nodes for the live preview and ffmpeg filters for the export.
 */
export type AudioFxPreset = "none" | "voice" | "podcast" | "loud" | "music";

export interface WebAudioFx {
  highpass?: number;
  peaks?: { f: number; q: number; gain: number }[];
  compressor?: { threshold: number; ratio: number; attack: number; release: number; knee: number };
  gain: number;
}

export interface AudioFxDef {
  id: AudioFxPreset;
  label: string;
  note: string;
  ffmpeg: string[];
  web: WebAudioFx;
}

export const AUDIO_FX: AudioFxDef[] = [
  { id: "none", label: "Off", note: "Original audio", ffmpeg: [], web: { gain: 1 } },
  {
    id: "voice",
    label: "Voice",
    note: "Clearer speech: high-pass, presence boost, gentle compression",
    ffmpeg: ["highpass=f=90", "equalizer=f=250:t=q:w=1.2:g=-2", "equalizer=f=3200:t=q:w=1:g=3", "acompressor=threshold=-18dB:ratio=3:attack=10:release=120:makeup=3"],
    web: { highpass: 90, peaks: [{ f: 250, q: 1.2, gain: -2 }, { f: 3200, q: 1, gain: 3 }], compressor: { threshold: -18, ratio: 3, attack: 0.01, release: 0.12, knee: 6 }, gain: 1.4 },
  },
  {
    id: "podcast",
    label: "Podcast",
    note: "Even, broadcast-style levels (-16 LUFS)",
    ffmpeg: ["highpass=f=80", "acompressor=threshold=-20dB:ratio=4:attack=5:release=150:makeup=5", "loudnorm=I=-16:TP=-1.5:LRA=11"],
    web: { highpass: 80, compressor: { threshold: -20, ratio: 4, attack: 0.005, release: 0.15, knee: 6 }, gain: 1.8 },
  },
  {
    id: "loud",
    label: "Loud",
    note: "Normalise to social loudness (-14 LUFS)",
    ffmpeg: ["loudnorm=I=-14:TP=-1:LRA=9"],
    web: { compressor: { threshold: -24, ratio: 6, attack: 0.003, release: 0.1, knee: 10 }, gain: 2.2 },
  },
  {
    id: "music",
    label: "Music",
    note: "Warmth and sparkle with light glue compression",
    ffmpeg: ["equalizer=f=100:t=q:w=1:g=3", "equalizer=f=8000:t=q:w=1:g=2", "acompressor=threshold=-15dB:ratio=2:attack=20:release=200:makeup=2"],
    web: { peaks: [{ f: 100, q: 1, gain: 3 }, { f: 8000, q: 1, gain: 2 }], compressor: { threshold: -15, ratio: 2, attack: 0.02, release: 0.2, knee: 6 }, gain: 1.25 },
  },
];

export function audioFx(id: AudioFxPreset | undefined): AudioFxDef {
  return AUDIO_FX.find((f) => f.id === (id ?? "none")) ?? AUDIO_FX[0];
}
