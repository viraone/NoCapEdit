/**
 * WebGL2 colour grader used by the preview: optional 3D LUT plus brightness,
 * contrast and saturation with the same maths as ffmpeg's `eq` filter, so the
 * export (`lut3d` + `eq`) matches what the canvas shows.
 */
import type { Lut3D } from "@/lib/color/cube";

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 vUv; out vec4 o;
uniform sampler2D uImg; uniform sampler3D uLut;
uniform float uUseLut, uLutSize, uBright, uContrast, uSat;
void main(){
  vec3 c = texture(uImg, vUv).rgb;
  if (uUseLut > 0.5) {
    vec3 coord = c * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    c = texture(uLut, coord).rgb;
  }
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, uSat);
  c = (c - 0.5) * uContrast + 0.5 + uBright;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export interface GradeParams {
  brightness: number;
  contrast: number;
  saturation: number;
  lut: Lut3D | null;
}

export class ColorGrader {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private imgTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutKey: Lut3D | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  width = 2;
  height = 2;

  constructor() {
    this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(2, 2) : document.createElement("canvas");
    const gl = (this.canvas as HTMLCanvasElement).getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link error");
    this.program = program;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    for (const name of ["uImg", "uLut", "uUseLut", "uLutSize", "uBright", "uContrast", "uSat"]) this.u[name] = gl.getUniformLocation(program, name);
    gl.uniform1i(this.u.uImg, 0);
    gl.uniform1i(this.u.uLut, 1);
    this.imgTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  private uploadLut(lut: Lut3D) {
    if (this.lutKey === lut) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut.data);
    this.lutKey = lut;
  }

  /** Grades `source` (video, canvas or image) into the internal canvas at the given size. */
  render(source: TexImageSource, width: number, height: number, p: GradeParams): CanvasImageSource {
    const gl = this.gl;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (p.lut) this.uploadLut(p.lut);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.uniform1f(this.u.uUseLut, p.lut ? 1 : 0);
    gl.uniform1f(this.u.uLutSize, p.lut?.size ?? 2);
    gl.uniform1f(this.u.uBright, p.brightness);
    gl.uniform1f(this.u.uContrast, p.contrast);
    gl.uniform1f(this.u.uSat, p.saturation);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas as CanvasImageSource;
  }
}

let shared: ColorGrader | null = null;
let failed = false;
export function getSharedGrader(): ColorGrader | null {
  if (failed) return null;
  try {
    if (!shared) shared = new ColorGrader();
    return shared;
  } catch {
    failed = true;
    return null;
  }
}
