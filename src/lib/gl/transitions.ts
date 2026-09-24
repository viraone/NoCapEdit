/**
 * GLSL shader transition engine (WebGL2). Both clip frames are uploaded as
 * textures and a fragment shader blends them for a given progress. Used by
 * the preview and by the compositor export path so GPU transitions are
 * rendered identically on screen and in the file.
 */

export interface GlTransitionDef {
  id: `glsl:${string}`;
  name: string;
  /** Body defining `vec4 transition(vec2 uv)`. */
  source: string;
  /** Closest ffmpeg xfade name, used only when WebGL is unavailable. */
  fallback: string;
}

const PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float progress;
uniform float ratio;
const float PI = 3.14159265;
vec4 getFromColor(vec2 uv) { return texture(uFrom, clamp(uv, 0.0, 1.0)); }
vec4 getToColor(vec2 uv) { return texture(uTo, clamp(uv, 0.0, 1.0)); }
float rnd(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const MAIN = `
void main() { fragColor = transition(vUv); }
`;

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const GL_TRANSITIONS: GlTransitionDef[] = [
  {
    id: "glsl:crosszoom",
    name: "Cross zoom (GPU)",
    fallback: "zoomin",
    source: `vec4 transition(vec2 uv) {
  vec2 center = vec2(0.5);
  float strength = sin(progress * PI) * 0.4;
  vec4 c1 = vec4(0.0);
  vec4 c2 = vec4(0.0);
  const int N = 12;
  for (int i = 0; i < N; i++) {
    float t = float(i) / float(N - 1);
    vec2 offs = (uv - center) * (1.0 - t * strength);
    c1 += getFromColor(center + offs);
    c2 += getToColor(center + offs);
  }
  return mix(c1 / float(N), c2 / float(N), smoothstep(0.2, 0.8, progress));
}`,
  },
  {
    id: "glsl:radial",
    name: "Radial sweep (GPU)",
    fallback: "radial",
    source: `vec4 transition(vec2 uv) {
  vec2 rp = uv * 2.0 - 1.0;
  float pa = (atan(rp.y, rp.x) + PI) / (2.0 * PI);
  float m = smoothstep(pa - 0.03, pa + 0.03, progress * 1.06 - 0.03);
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
  {
    id: "glsl:directionalwarp",
    name: "Directional warp (GPU)",
    fallback: "diagtl",
    source: `vec4 transition(vec2 uv) {
  vec2 dir = normalize(vec2(1.0, -1.0));
  float edge = dot(uv - 0.5, dir) + 0.5;
  float p = progress * 1.4 - 0.2;
  float m = smoothstep(p - 0.2, p + 0.2, edge);
  vec2 warpFrom = uv + dir * (1.0 - m) * 0.15;
  vec2 warpTo = uv - dir * m * 0.15;
  return mix(getToColor(warpTo), getFromColor(warpFrom), m);
}`,
  },
  {
    id: "glsl:glitch",
    name: "Glitch (GPU)",
    fallback: "dissolve",
    source: `vec4 transition(vec2 uv) {
  float p = progress;
  float band = floor(uv.y * 24.0);
  float env = sin(p * PI);
  float shift = (rnd(vec2(band, floor(p * 20.0))) - 0.5) * 0.25 * env;
  vec2 uvf = vec2(uv.x + shift, uv.y);
  vec2 uvt = vec2(uv.x - shift, uv.y);
  float split = 0.02 * env;
  vec4 a = vec4(getFromColor(uvf + vec2(split, 0.0)).r, getFromColor(uvf).g, getFromColor(uvf - vec2(split, 0.0)).b, 1.0);
  vec4 b = vec4(getToColor(uvt + vec2(split, 0.0)).r, getToColor(uvt).g, getToColor(uvt - vec2(split, 0.0)).b, 1.0);
  float m = step(rnd(vec2(band, 7.0)), p);
  return mix(a, b, m);
}`,
  },
  {
    id: "glsl:circleopen",
    name: "Circle open (GPU)",
    fallback: "circleopen",
    source: `vec4 transition(vec2 uv) {
  vec2 d = (uv - 0.5) * vec2(ratio, 1.0);
  float r = length(d) / length(vec2(0.5 * ratio, 0.5));
  float m = smoothstep(progress - 0.08, progress + 0.08, r);
  return mix(getToColor(uv), getFromColor(uv), m);
}`,
  },
  {
    id: "glsl:pixelize",
    name: "Pixelize (GPU)",
    fallback: "pixelize",
    source: `vec4 transition(vec2 uv) {
  float t = sin(progress * PI);
  float cells = mix(400.0, 20.0, t);
  vec2 grid = vec2(cells * ratio, cells);
  vec2 puv = (floor(uv * grid) + 0.5) / grid;
  vec2 suv = t > 0.02 ? puv : uv;
  return mix(getFromColor(suv), getToColor(suv), smoothstep(0.3, 0.7, progress));
}`,
  },
  {
    id: "glsl:swirl",
    name: "Swirl (GPU)",
    fallback: "fade",
    source: `vec4 transition(vec2 uv) {
  vec2 c = uv - 0.5;
  c.x *= ratio;
  float r = length(c);
  float ang = sin(progress * PI) * 6.0 * smoothstep(0.7, 0.0, r);
  float s = sin(ang);
  float co = cos(ang);
  vec2 rc = vec2(c.x * co - c.y * s, c.x * s + c.y * co);
  rc.x /= ratio;
  vec2 suv = rc + 0.5;
  return mix(getFromColor(suv), getToColor(suv), smoothstep(0.4, 0.6, progress));
}`,
  },
  {
    id: "glsl:cube",
    name: "Cube (GPU)",
    fallback: "squeezeh",
    source: `vec2 face(vec2 uv, float x0, float x1, float skewL, float skewR) {
  float fx = (uv.x - x0) / max(0.0001, x1 - x0);
  float scale = mix(skewL, skewR, fx);
  float fy = (uv.y - 0.5) / scale + 0.5;
  return vec2(fx, fy);
}
vec4 transition(vec2 uv) {
  float p = progress;
  float split = 1.0 - p;
  float persp = 0.8;
  vec2 f;
  vec4 col;
  if (uv.x < split) {
    f = face(uv, 0.0, split, 1.0, mix(1.0, persp, p));
    col = getFromColor(f);
  } else {
    f = face(uv, split, 1.0, mix(1.0, persp, 1.0 - p), 1.0);
    col = getToColor(f);
  }
  if (f.y < 0.0 || f.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  return col;
}`,
  },
  {
    id: "glsl:dreamy",
    name: "Dreamy waves (GPU)",
    fallback: "fade",
    source: `vec4 transition(vec2 uv) {
  float wave = sin(uv.x * 20.0 + progress * 6.28) * 0.03 * sin(progress * PI);
  return mix(getFromColor(uv + vec2(0.0, wave)), getToColor(uv - vec2(0.0, wave)), smoothstep(0.2, 0.8, progress));
}`,
  },
  {
    id: "glsl:ripple",
    name: "Ripple (GPU)",
    fallback: "fade",
    source: `vec4 transition(vec2 uv) {
  vec2 d = (uv - 0.5) * vec2(ratio, 1.0);
  float r = length(d);
  float amp = 0.05 * sin(progress * PI);
  float w = sin(r * 40.0 - progress * 20.0) * amp;
  vec2 suv = uv + normalize(d + 1e-4) * w;
  return mix(getFromColor(suv), getToColor(suv), smoothstep(0.3, 0.7, progress));
}`,
  },
];

export function isGlTransition(type: string): type is `glsl:${string}` {
  return type.startsWith("glsl:");
}

export function getGlTransition(id: string): GlTransitionDef | undefined {
  return GL_TRANSITIONS.find((t) => t.id === id);
}

interface ProgramInfo {
  program: WebGLProgram;
  uProgress: WebGLUniformLocation | null;
  uRatio: WebGLUniformLocation | null;
}

export class GlTransitionRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, ProgramInfo>();
  private textures: [WebGLTexture, WebGLTexture];
  private vao: WebGLVertexArrayObject | null;
  private vertexShader: WebGLShader;
  width: number;
  height: number;

  static isSupported(): boolean {
    if (typeof document === "undefined") return false;
    try {
      const c = document.createElement("canvas");
      return !!c.getContext("webgl2");
    } catch {
      return false;
    }
  }

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
    if (!(this.canvas instanceof OffscreenCanvas)) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const gl = (this.canvas as HTMLCanvasElement).getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.vertexShader = this.compile(gl.VERTEX_SHADER, VERTEX);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.textures = [this.createTexture(), this.createTexture()];
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${log}`);
    }
    return shader;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private getProgram(def: GlTransitionDef): ProgramInfo {
    const cached = this.programs.get(def.id);
    if (cached) return cached;
    const gl = this.gl;
    const fragment = this.compile(gl.FRAGMENT_SHADER, PRELUDE + def.source + MAIN);
    const program = gl.createProgram()!;
    gl.attachShader(program, this.vertexShader);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Shader link error: ${log}`);
    }
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "uFrom"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "uTo"), 1);
    const info: ProgramInfo = { program, uProgress: gl.getUniformLocation(program, "progress"), uRatio: gl.getUniformLocation(program, "ratio") };
    this.programs.set(def.id, info);
    return info;
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private upload(unit: number, source: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /** Renders the transition into the internal canvas and returns it. */
  render(id: string, from: TexImageSource, to: TexImageSource, progress: number): CanvasImageSource {
    const def = getGlTransition(id);
    if (!def) throw new Error(`Unknown transition ${id}`);
    const gl = this.gl;
    const info = this.getProgram(def);
    this.upload(0, from);
    this.upload(1, to);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(info.program);
    gl.uniform1f(info.uProgress, Math.min(1, Math.max(0, progress)));
    gl.uniform1f(info.uRatio, this.width / this.height);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas as CanvasImageSource;
  }

  dispose() {
    const gl = this.gl;
    for (const p of this.programs.values()) gl.deleteProgram(p.program);
    this.programs.clear();
    for (const t of this.textures) gl.deleteTexture(t);
    gl.deleteShader(this.vertexShader);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

let shared: GlTransitionRenderer | null = null;
let sharedFailed = false;

/** Lazily created renderer shared by preview and export (null if WebGL2 is missing). */
export function getSharedGlRenderer(width: number, height: number): GlTransitionRenderer | null {
  if (sharedFailed) return null;
  try {
    if (!shared) shared = new GlTransitionRenderer(width, height);
    else shared.resize(width, height);
    return shared;
  } catch {
    sharedFailed = true;
    return null;
  }
}
