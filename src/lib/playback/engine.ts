/**
 * Preview playback engine. One hidden <video> per clip plus an <audio> for
 * music, all driven from a single project timeline. The engine only positions
 * media elements; drawing happens in the canvas component every frame.
 */
import type { TransitionType, VideoProject } from "@/lib/models/project";
import { layoutClips, locateFrame, toProjectTime, toSourceTime, type ClipLayout } from "@/lib/models/timeline";
import { clamp } from "@/lib/utils/math";
import { audioFx, type AudioFxPreset } from "@/lib/audio/fx";

interface FxChain {
  source: MediaElementAudioSourceNode;
  highpass: BiquadFilterNode;
  peaks: [BiquadFilterNode, BiquadFilterNode];
  compressor: DynamicsCompressorNode;
  gain: GainNode;
  preset: AudioFxPreset;
}

export interface EngineFrame {
  time: number;
  primary: { video: HTMLVideoElement; layout: ClipLayout } | null;
  secondary: { video: HTMLVideoElement; layout: ClipLayout } | null;
  progress: number;
  transition: TransitionType;
}

export class PlaybackEngine {
  private videos = new Map<string, HTMLVideoElement>();
  /** Replacement audio elements keyed by clip id (denoised tracks etc.). */
  private clipAudio = new Map<string, HTMLAudioElement>();
  private voices = new Map<string, HTMLAudioElement>();
  private music: HTMLAudioElement | null = null;
  private musicAssetId: string | null = null;
  private audioCtx: AudioContext | null = null;
  private chains = new Map<HTMLMediaElement, FxChain>();
  private project: VideoProject | null = null;
  private layouts: ClipLayout[] = [];
  private primaryIndex = -1;

  time = 0;
  playing = false;
  duration = 0;

  onTime: ((t: number) => void) | null = null;
  onEnded: (() => void) | null = null;
  onPlayingChange: ((playing: boolean) => void) | null = null;

  setProject(project: VideoProject, urls: Record<string, string>) {
    this.project = project;
    this.layouts = layoutClips(project.clips);
    this.duration = this.layouts.length ? this.layouts[this.layouts.length - 1].end : 0;

    const ids = new Set(project.clips.map((c) => c.id));
    for (const [id, video] of this.videos) {
      if (!ids.has(id)) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        this.videos.delete(id);
      }
    }
    for (const clip of project.clips) {
      const url = urls[clip.assetId];
      if (!url) continue;
      let video = this.videos.get(clip.id);
      if (!video) {
        video = document.createElement("video");
        video.preload = "auto";
        video.playsInline = true;
        video.src = url;
        this.videos.set(clip.id, video);
      } else if (video.src !== url) {
        video.src = url;
      }
      video.playbackRate = clamp(clip.speed, 0.0625, 16);
      try {
        (video as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = clip.preservePitch;
      } catch {
        /* unsupported */
      }
      video.volume = clamp(clip.volume, 0, 1);
      const replacementUrl = clip.audioAssetId ? urls[clip.audioAssetId] : undefined;
      video.muted = clip.volume <= 0 || !!replacementUrl;
      let audio = this.clipAudio.get(clip.id);
      if (replacementUrl) {
        if (!audio) {
          audio = new Audio(replacementUrl);
          audio.preload = "auto";
          this.clipAudio.set(clip.id, audio);
        } else if (audio.src !== replacementUrl) audio.src = replacementUrl;
        audio.playbackRate = clamp(clip.speed, 0.0625, 16);
        try {
          (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = clip.preservePitch;
        } catch {
          /* unsupported */
        }
        audio.volume = clamp(clip.volume, 0, 1);
      } else if (audio) {
        audio.pause();
        this.clipAudio.delete(clip.id);
      }
    }
    for (const [id, audio] of this.clipAudio) {
      if (!ids.has(id)) {
        audio.pause();
        this.clipAudio.delete(id);
      }
    }

    const voiceIds = new Set(project.voiceovers.map((v) => v.id));
    for (const [id, a] of this.voices) {
      if (!voiceIds.has(id)) {
        a.pause();
        this.voices.delete(id);
      }
    }
    for (const vo of project.voiceovers) {
      const url = urls[vo.assetId];
      if (!url) continue;
      let a = this.voices.get(vo.id);
      if (!a) {
        a = new Audio(url);
        a.preload = "auto";
        this.voices.set(vo.id, a);
      } else if (a.src !== url) a.src = url;
      a.volume = clamp(vo.volume, 0, 1);
    }

    const music = project.music;
    const musicUrl = music ? urls[music.assetId] : undefined;
    if (!music || !musicUrl) {
      this.music?.pause();
      this.music = null;
      this.musicAssetId = null;
    } else if (this.musicAssetId !== music.assetId) {
      this.music?.pause();
      this.music = new Audio(musicUrl);
      this.music.preload = "auto";
      this.musicAssetId = music.assetId;
    }

    this.time = clamp(this.time, 0, this.duration);
    if (this.audioCtx) this.syncFx();
    if (this.playing && (this.primaryIndex < 0 || this.primaryIndex >= this.layouts.length)) this.pause();
    if (!this.playing) this.activate(false);
  }

  /** Routes a media element through the Web Audio preset chain (created on first play). */
  private applyFx(el: HTMLMediaElement, preset: AudioFxPreset) {
    if (!this.audioCtx) {
      if (preset === "none") return;
      try {
        this.audioCtx = new AudioContext();
      } catch {
        return;
      }
    }
    const ctx = this.audioCtx;
    let chain = this.chains.get(el);
    if (!chain) {
      if (preset === "none") return;
      try {
        const source = ctx.createMediaElementSource(el);
        const highpass = ctx.createBiquadFilter();
        highpass.type = "highpass";
        const p1 = ctx.createBiquadFilter();
        p1.type = "peaking";
        const p2 = ctx.createBiquadFilter();
        p2.type = "peaking";
        const compressor = ctx.createDynamicsCompressor();
        const gain = ctx.createGain();
        source.connect(highpass).connect(p1).connect(p2).connect(compressor).connect(gain).connect(ctx.destination);
        chain = { source, highpass, peaks: [p1, p2], compressor, gain, preset: "none" };
        this.chains.set(el, chain);
      } catch {
        return;
      }
    }
    if (chain.preset === preset) return;
    const fx = audioFx(preset).web;
    chain.highpass.frequency.value = fx.highpass ?? 10;
    chain.peaks.forEach((node, i) => {
      const p = fx.peaks?.[i];
      node.frequency.value = p?.f ?? 1000;
      node.Q.value = p?.q ?? 1;
      node.gain.value = p?.gain ?? 0;
    });
    const c = fx.compressor;
    chain.compressor.threshold.value = c?.threshold ?? 0;
    chain.compressor.ratio.value = c?.ratio ?? 1;
    chain.compressor.attack.value = c?.attack ?? 0.003;
    chain.compressor.release.value = c?.release ?? 0.25;
    chain.compressor.knee.value = c?.knee ?? 0;
    chain.gain.gain.value = fx.gain;
    chain.preset = preset;
  }

  private syncFx() {
    if (!this.project) return;
    for (const clip of this.project.clips) {
      const el = this.clipAudio.get(clip.id) ?? this.videos.get(clip.id);
      if (el) this.applyFx(el, clip.audioFx ?? "none");
    }
  }

  play() {
    if (!this.layouts.length) return;
    if (this.time >= this.duration - 0.02) this.time = 0;
    this.playing = true;
    this.syncFx();
    this.audioCtx?.resume().catch(() => undefined);
    this.activate(true);
    this.onPlayingChange?.(true);
  }

  pause() {
    this.playing = false;
    for (const v of this.videos.values()) if (!v.paused) v.pause();
    for (const a of this.clipAudio.values()) if (!a.paused) a.pause();
    for (const a of this.voices.values()) if (!a.paused) a.pause();
    this.music?.pause();
    this.onPlayingChange?.(false);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this.time = clamp(t, 0, this.duration);
    this.activate(this.playing);
    this.onTime?.(this.time);
  }

  private position(layout: ClipLayout, play: boolean) {
    const v = this.videos.get(layout.clip.id);
    if (!v) return;
    const st = toSourceTime(layout, this.time);
    const tolerance = play ? 0.08 : 0.002;
    if (Math.abs(v.currentTime - st) > tolerance) v.currentTime = st;
    if (play) v.play().catch(() => undefined);
    else if (!v.paused) v.pause();
    const a = this.clipAudio.get(layout.clip.id);
    if (a) {
      if (Math.abs(a.currentTime - st) > (play ? 0.12 : 0.002)) a.currentTime = st;
      if (play) a.play().catch(() => undefined);
      else if (!a.paused) a.pause();
    }
  }

  private syncVoiceovers(force: boolean) {
    const project = this.project;
    if (!project) return;
    for (const vo of project.voiceovers) {
      const a = this.voices.get(vo.id);
      if (!a) continue;
      const local = this.time - vo.start;
      const active = local >= 0 && local < vo.duration;
      if (!active) {
        if (!a.paused) a.pause();
        continue;
      }
      if (force || Math.abs(a.currentTime - local) > 0.3) a.currentTime = local;
      if (this.playing && a.paused) a.play().catch(() => undefined);
      if (!this.playing && !a.paused) a.pause();
    }
  }

  private activate(play: boolean) {
    const loc = locateFrame(this.layouts, this.time);
    if (!loc) {
      this.primaryIndex = -1;
      return;
    }
    this.primaryIndex = loc.primary.index;
    const active = new Set<string>([loc.primary.clip.id]);
    if (loc.secondary) active.add(loc.secondary.clip.id);
    for (const [id, v] of this.videos) if (!active.has(id) && !v.paused) v.pause();
    for (const [id, a] of this.clipAudio) if (!active.has(id) && !a.paused) a.pause();
    this.position(loc.primary, play);
    if (loc.secondary) this.position(loc.secondary, play);
    const next = this.layouts[loc.primary.index + 1];
    if (next && !active.has(next.clip.id)) {
      const nv = this.videos.get(next.clip.id);
      if (nv && Math.abs(nv.currentTime - next.clip.inPoint) > 0.25) nv.currentTime = next.clip.inPoint;
    }
    this.syncMusic(true);
    this.syncVoiceovers(true);
  }

  /**
   * Music position for project time t. Mirrors ffmpeg's `-stream_loop`:
   * the first pass plays from `startOffset`, later loops restart at 0.
   */
  private musicTime(t: number): number | null {
    const m = this.project?.music;
    if (!m) return null;
    return musicSourceTime(m, t);
  }

  musicGain(t: number): number {
    const m = this.project?.music;
    if (!m) return 0;
    let g = 1;
    if (m.fadeIn > 0 && t < m.fadeIn) g = Math.min(g, t / m.fadeIn);
    if (m.fadeOut > 0 && t > this.duration - m.fadeOut) g = Math.min(g, Math.max(0, (this.duration - t) / m.fadeOut));
    return clamp(g * m.volume, 0, 1);
  }

  private syncMusic(force: boolean) {
    const music = this.music;
    if (!music) return;
    const mt = this.musicTime(this.time);
    if (mt === null) {
      if (!music.paused) music.pause();
      return;
    }
    if (force || Math.abs(music.currentTime - mt) > 0.3) music.currentTime = mt;
    music.volume = this.musicGain(this.time);
    if (this.playing && music.paused) music.play().catch(() => undefined);
    if (!this.playing && !music.paused) music.pause();
  }

  /** Advances the clock from the playing media and returns what to draw. */
  tick(): EngineFrame {
    if (this.playing && this.layouts.length && this.primaryIndex >= 0) {
      const primary = this.layouts[this.primaryIndex];
      const v = this.videos.get(primary.clip.id);
      if (v) {
        const ended = v.ended || v.currentTime >= primary.clip.outPoint - 0.004;
        let t = ended ? primary.end : toProjectTime(primary, v.currentTime);
        t = clamp(t, primary.start, primary.end);
        this.time = t;
        const isLast = this.primaryIndex === this.layouts.length - 1;
        if (isLast && ended) {
          this.time = this.duration;
          this.pause();
          this.onTime?.(this.time);
          this.onEnded?.();
          return this.frame();
        }
        const loc = locateFrame(this.layouts, this.time);
        if (loc) {
          if (ended && loc.primary.index === this.primaryIndex) {
            this.time = this.layouts[this.primaryIndex + 1].start;
            this.activate(true);
          } else if (loc.primary.index !== this.primaryIndex) {
            this.activate(true);
          } else if (loc.secondary) {
            const sv = this.videos.get(loc.secondary.clip.id);
            if (sv) {
              const expected = toSourceTime(loc.secondary, this.time);
              if (Math.abs(sv.currentTime - expected) > 0.15) sv.currentTime = expected;
              if (sv.paused && !sv.ended) sv.play().catch(() => undefined);
            }
          } else {
            for (const [id, other] of this.videos) if (id !== primary.clip.id && !other.paused) other.pause();
            for (const [id, other] of this.clipAudio) if (id !== primary.clip.id && !other.paused) other.pause();
          }
        }
        this.syncMusic(false);
        this.syncVoiceovers(false);
      }
      this.onTime?.(this.time);
    }
    return this.frame();
  }

  frame(): EngineFrame {
    const loc = locateFrame(this.layouts, this.time);
    if (!loc) return { time: this.time, primary: null, secondary: null, progress: 0, transition: "none" };
    const pv = this.videos.get(loc.primary.clip.id);
    const sv = loc.secondary ? this.videos.get(loc.secondary.clip.id) : undefined;
    return {
      time: this.time,
      primary: pv ? { video: pv, layout: loc.primary } : null,
      secondary: sv && loc.secondary ? { video: sv, layout: loc.secondary } : null,
      progress: loc.progress,
      transition: loc.secondary ? loc.secondary.clip.transition.type : "none",
    };
  }

  dispose() {
    this.pause();
    for (const v of this.videos.values()) {
      v.removeAttribute("src");
      v.load();
    }
    this.videos.clear();
    for (const a of this.clipAudio.values()) a.pause();
    this.clipAudio.clear();
    for (const a of this.voices.values()) a.pause();
    this.voices.clear();
    this.chains.clear();
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.music = null;
    this.musicAssetId = null;
    this.project = null;
    this.layouts = [];
  }
}

/** Position inside the music file for project time t (null = silence). */
export function musicSourceTime(m: { duration: number; startOffset: number; loop: boolean }, t: number): number | null {
  const available = m.duration - m.startOffset;
  if (available <= 0.05 || m.duration <= 0.05) return null;
  if (t < available) return m.startOffset + t;
  if (!m.loop) return null;
  return (t - available) % m.duration;
}

/** Single engine shared by the editor UI. */
export const engine = new PlaybackEngine();
