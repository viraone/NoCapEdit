/**
 * GPU compositor for the fast exporter.
 *
 * Drawing a decoded 4K VideoFrame into a 2D canvas makes WebKit convert
 * the frame on the CPU, which costs about as much as decoding it. WebGL
 * takes the frame as a texture instead: the crop/rotation is a matter of
 * texture coordinates, and the caption layer (a small transparent canvas
 * that only changes when the spoken word does) is blended on top as a
 * second texture. The GL canvas is then handed to the encoder as the
 * processed frame.
 */
import type { Rect } from "@/lib/mobile/reframe";

const VERT = `#version 300 es
in vec2 aPos;
in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`;

type Rotation = 0 | 90 | 180 | 270;

export class GlCompositor {
  readonly canvas: OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly posBuffer: WebGLBuffer;
  private readonly uvBuffer: WebGLBuffer;
  private readonly videoTex: WebGLTexture;
  private readonly captionTex: WebGLTexture;
  private readonly aPos: number;
  private readonly aUv: number;
  private captionVersion = -1;

  static supported(): boolean {
    if (typeof OffscreenCanvas === "undefined" || typeof VideoFrame === "undefined") return false;
    try {
      const gl = new OffscreenCanvas(2, 2).getContext("webgl2");
      return !!gl;
    } catch {
      return false;
    }
  }

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    gl.useProgram(program);
    this.aPos = gl.getAttribLocation(program, "aPos");
    this.aUv = gl.getAttribLocation(program, "aUv");
    gl.uniform1i(gl.getUniformLocation(program, "uTex"), 0);

    // Full-screen quad, output row 0 at the top (clip y = +1).
    this.posBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

    this.uvBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(8), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aUv);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);

    const makeTex = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.videoTex = makeTex();
    this.captionTex = makeTex();
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  /**
   * Texture coordinates for the quad's corners (top-left, top-right,
   * bottom-left, bottom-right) so that `crop` (in upright display pixels)
   * fills the output, given how the coded frame is rotated/flipped for
   * display.
   */
  static uvFor(crop: Rect, displayWidth: number, displayHeight: number, rotation: Rotation, flip: boolean): Float32Array {
    const corners = [
      [crop.x, crop.y],
      [crop.x + crop.w, crop.y],
      [crop.x, crop.y + crop.h],
      [crop.x + crop.w, crop.y + crop.h],
    ];
    const out = new Float32Array(8);
    corners.forEach(([dx, dy], i) => {
      let x = dx / displayWidth; // 0..1 across the upright picture
      const y = dy / displayHeight;
      if (flip) x = 1 - x;
      let u: number;
      let v: number;
      switch (rotation) {
        case 90:
          u = y;
          v = 1 - x;
          break;
        case 180:
          u = 1 - x;
          v = 1 - y;
          break;
        case 270:
          u = 1 - y;
          v = x;
          break;
        default:
          u = x;
          v = y;
      }
      out[i * 2] = u;
      out[i * 2 + 1] = v;
    });
    return out;
  }

  /** Uploads the caption layer when it changed (tracked by `version`). */
  private syncCaptions(layer: OffscreenCanvas | HTMLCanvasElement, version: number) {
    if (version === this.captionVersion) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.captionTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.captionVersion = version;
  }

  /** Composites one frame: the video through `uv`, then the caption layer if `captions` is given. */
  draw(frame: VideoFrame, uv: Float32Array, captions: { layer: OffscreenCanvas | HTMLCanvasElement; version: number } | null) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, uv);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (captions) {
      this.syncCaptions(captions.layer, captions.version);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
      gl.bindTexture(gl.TEXTURE_2D, this.captionTex);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.videoTex);
    gl.deleteTexture(this.captionTex);
    gl.deleteBuffer(this.posBuffer);
    gl.deleteBuffer(this.uvBuffer);
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
