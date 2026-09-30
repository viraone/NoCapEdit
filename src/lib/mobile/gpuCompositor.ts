/// <reference types="@webgpu/types" />
/**
 * WebGPU compositor for the fast exporter.
 *
 * On iPhone, reading *any* canvas back into an encoder frame (2D, WebGL
 * or a WebGPU canvas) is paced by the display: the export tops out at
 * about 30 frames a second however fast the codecs are. So this never
 * touches a canvas. `importExternalTexture` takes the decoded frame
 * without a copy, the video and the two caption layers are drawn into a
 * plain GPU texture, a compute pass packs that picture into NV12 — the
 * encoder's own layout, 1.5 bytes a pixel instead of 4, rows already
 * tight — and the bytes are mapped and handed over as a VideoFrame that
 * the encoder can use as is. Same crop/rotation maths as the WebGL
 * compositor (texture coordinates per quad corner).
 *
 * The RGBA route (copy the texture out row by row, hand over RGBA) stays
 * as the fallback for a browser that can't build an NV12 frame from bytes.
 */
import { GlCompositor } from "@/lib/mobile/glCompositor";

const SHADER = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VSOut {
  var o: VSOut;
  o.pos = vec4f(pos, 0.0, 1.0);
  o.uv = uv;
  return o;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var ext: texture_external;

@fragment
fn fsVideo(in: VSOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(ext, samp, in.uv);
}
`;

const LAYER_SHADER = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@location(0) pos: vec2f, @location(1) uv: vec2f) -> VSOut {
  var o: VSOut;
  o.pos = vec4f(pos, 0.0, 1.0);
  o.uv = uv;
  return o;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fsLayer(in: VSOut) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv);
}
`;

/**
 * Packs the rendered picture into NV12 (BT.709): the Y plane, then
 * interleaved Cb/Cr for each 2×2 block, with no row padding — exactly the
 * bytes VideoFrame expects, so nothing is re-packed on the CPU. One thread
 * produces one 32-bit word (four Y samples or two Cb/Cr pairs); the range
 * scale/offset comes in as uniforms so video range and full range share
 * the shader.
 */
const PACK_SHADER = /* wgsl */ `
struct Dims {
  width: u32,
  height: u32,
  yWords: u32,
  uvWords: u32,
  yScale: f32,
  yOffset: f32,
  cScale: f32,
  pad: f32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<uniform> dims: Dims;

fn quantize(v: f32) -> u32 {
  return u32(clamp(round(v), 0.0, 255.0));
}

fn packY(word: u32) -> u32 {
  var packed = 0u;
  for (var k = 0u; k < 4u; k++) {
    let p = word * 4u + k;
    let y = p / dims.width;
    let x = p - y * dims.width;
    let c = textureLoad(src, vec2u(x, y), 0).rgb;
    packed |= quantize(dims.yOffset + dims.yScale * dot(c, vec3f(0.2126, 0.7152, 0.0722))) << (8u * k);
  }
  return packed;
}

fn packUV(word: u32) -> u32 {
  let halfW = dims.width / 2u;
  let samples = halfW * (dims.height / 2u);
  var packed = 0u;
  for (var m = 0u; m < 2u; m++) {
    let q = word * 2u + m;
    if (q >= samples) { break; }
    let row = q / halfW;
    let col = q - row * halfW;
    let o = vec2u(col * 2u, row * 2u);
    let c = (textureLoad(src, o, 0).rgb + textureLoad(src, o + vec2u(1u, 0u), 0).rgb
      + textureLoad(src, o + vec2u(0u, 1u), 0).rgb + textureLoad(src, o + vec2u(1u, 1u), 0).rgb) * 0.25;
    let cb = 128.0 + dims.cScale * dot(c, vec3f(-0.1146, -0.3854, 0.5));
    let cr = 128.0 + dims.cScale * dot(c, vec3f(0.5, -0.4542, -0.0458));
    packed |= quantize(cb) << (16u * m);
    packed |= quantize(cr) << (16u * m + 8u);
  }
  return packed;
}

@compute @workgroup_size(64)
fn pack(@builtin(global_invocation_id) id: vec3u) {
  let word = id.x;
  if (word < dims.yWords) {
    dst[word] = packY(word);
  } else if (word < dims.yWords + dims.uvWords) {
    dst[word] = packUV(word - dims.yWords);
  }
}
`;

type Layer = { canvas: OffscreenCanvas | HTMLCanvasElement; version: number } | null;

interface LayerSlot {
  texture: GPUTexture | null;
  bindGroup: GPUBindGroup | null;
  version: number;
  width: number;
  height: number;
}

/** How the finished frame is handed to the encoder. */
export type GpuPixelFormat = "NV12" | "RGBA";

/** Video range (16–235) or full range (0–255): Y scale, Y offset, chroma scale. */
const RANGE = {
  video: new Float32Array([219, 16, 224, 0]),
  full: new Float32Array([255, 0, 255, 0]),
};

/** True when `buf` (a frame of `format`, all one colour) is pure red. */
function isRed(format: VideoPixelFormat | null, buf: Uint8Array, width: number, height: number, fullRange: boolean): boolean {
  const near = (v: number, want: number) => Math.abs(v - want) <= 10;
  // BT.709 red: Y 63 / Cb 102 / Cr 240 in video range, 54 / 99 / 255 in full range.
  const [y, cb, cr] = fullRange ? [54, 99, 255] : [63, 102, 240];
  switch (format) {
    case "RGBA":
    case "RGBX":
      return buf[0] > 200 && buf[1] < 60 && buf[2] < 60;
    case "BGRA":
    case "BGRX":
      return buf[2] > 200 && buf[1] < 60 && buf[0] < 60;
    case "NV12": {
      const uv = width * height;
      return near(buf[0], y) && near(buf[uv], cb) && near(buf[uv + 1], cr);
    }
    case "I420": {
      const u = width * height;
      const v = u + (width / 2) * (height / 2);
      return near(buf[0], y) && near(buf[u], cb) && near(buf[v], cr);
    }
    default:
      return false;
  }
}

export class GpuCompositor {
  private readonly target: GPUTexture;
  private readonly targetView: GPUTextureView;
  private readonly readback: GPUBuffer;
  /** NV12: the compute pass writes the packed planes here, then they are copied to `readback`. */
  private readonly packed: GPUBuffer | null = null;
  private readonly packPipeline: GPUComputePipeline | null = null;
  private readonly packBindGroup: GPUBindGroup | null = null;
  private readonly packGroups: number = 0;
  private readonly dims: GPUBuffer | null = null;
  private range: "video" | "full" = "video";
  /** Bytes of one finished frame. */
  private readonly frameBytes: number;
  /** RGBA: padded row stride of the texture copy. */
  private readonly bytesPerRow: number = 0;
  /** RGBA: rows re-packed without padding when the width isn't a multiple of 64 px. */
  private readonly tight: Uint8Array<ArrayBuffer> | null = null;
  private readonly videoPipeline: GPURenderPipeline;
  private readonly layerPipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private readonly videoVertices: GPUBuffer;
  private readonly layerVertices: GPUBuffer;
  /** What the vertex buffers hold, so unchanged quads aren't re-uploaded every frame. */
  private videoQuadKey = "";
  private layerQuadKey = "";
  private readonly staticSlot: LayerSlot = { texture: null, bindGroup: null, version: -1, width: 0, height: 0 };
  private readonly activeSlot: LayerSlot = { texture: null, bindGroup: null, version: -1, width: 0, height: 0 };
  /** Profiling: milliseconds summed over frames — recording + submit, waiting for the GPU, building the VideoFrame. */
  readonly timing = { submit: 0, wait: 0, pack: 0 };

  static supported(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator && typeof VideoFrame !== "undefined";
  }

  /**
   * Resolves to null when WebGPU is present but unusable here. "Usable" is
   * proven, not assumed: a red test frame goes through the whole route
   * (import, draw, pack, read back into a VideoFrame) under error scopes,
   * and the bytes that come out must actually be red. NV12 is tried first;
   * a browser that can't take NV12 from bytes gets the RGBA route.
   */
  static async create(width: number, height: number, prefer: GpuPixelFormat = "NV12"): Promise<GpuCompositor | null> {
    if (!GpuCompositor.supported()) return null;
    const formats: GpuPixelFormat[] = prefer === "NV12" ? ["NV12", "RGBA"] : ["RGBA"];
    for (const pixelFormat of formats) {
      let compositor: GpuCompositor | null = null;
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return null;
        const device = await adapter.requestDevice();
        compositor = new GpuCompositor(device, width, height, pixelFormat);
        const why = await compositor.selfTest();
        if (!why) {
          device.addEventListener("uncapturederror", (e) => console.warn("[nocap mobile] WebGPU error", (e as GPUUncapturedErrorEvent).error.message));
          return compositor;
        }
        console.warn(`[nocap mobile] WebGPU ${pixelFormat} compositor failed its self-test:`, why);
      } catch (e) {
        console.warn(`[nocap mobile] WebGPU ${pixelFormat} compositor unavailable`, e);
      }
      compositor?.dispose();
    }
    return null;
  }

  private constructor(
    private readonly device: GPUDevice,
    readonly width: number,
    readonly height: number,
    readonly pixelFormat: GpuPixelFormat,
  ) {
    const format: GPUTextureFormat = "rgba8unorm";
    const nv12 = pixelFormat === "NV12";
    this.target = device.createTexture({
      size: [width, height],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | (nv12 ? GPUTextureUsage.TEXTURE_BINDING : GPUTextureUsage.COPY_SRC),
    });
    this.targetView = this.target.createView();
    if (nv12) {
      this.frameBytes = (width * height * 3) / 2;
      const words = Math.ceil(this.frameBytes / 4);
      const size = Math.ceil(this.frameBytes / 16) * 16;
      this.packed = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      this.readback = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const yWords = (width * height) / 4;
      this.dims = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(this.dims, 0, new Uint32Array([width, height, yWords, words - yWords]));
      device.queue.writeBuffer(this.dims, 16, RANGE.video);
      const packModule = device.createShaderModule({ code: PACK_SHADER });
      this.packPipeline = device.createComputePipeline({ layout: "auto", compute: { module: packModule, entryPoint: "pack" } });
      this.packBindGroup = device.createBindGroup({
        layout: this.packPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.targetView },
          { binding: 1, resource: { buffer: this.packed } },
          { binding: 2, resource: { buffer: this.dims } },
        ],
      });
      this.packGroups = Math.ceil(words / 64);
    } else {
      // copyTextureToBuffer wants rows padded to 256 bytes.
      this.frameBytes = width * 4 * height;
      this.bytesPerRow = Math.ceil((width * 4) / 256) * 256;
      this.readback = device.createBuffer({ size: this.bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      this.tight = this.bytesPerRow === width * 4 ? null : new Uint8Array(this.frameBytes);
    }

    const vertexLayout: GPUVertexBufferLayout = {
      arrayStride: 16,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
      ],
    };
    const videoModule = device.createShaderModule({ code: SHADER });
    this.videoPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: videoModule, entryPoint: "vs", buffers: [vertexLayout] },
      fragment: { module: videoModule, entryPoint: "fsVideo", targets: [{ format }] },
      primitive: { topology: "triangle-strip" },
    });
    const layerModule = device.createShaderModule({ code: LAYER_SHADER });
    this.layerPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: layerModule, entryPoint: "vs", buffers: [vertexLayout] },
      fragment: {
        module: layerModule,
        entryPoint: "fsLayer",
        targets: [
          {
            format,
            // Layers are premultiplied.
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.videoVertices = device.createBuffer({ size: 64, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.layerVertices = device.createBuffer({ size: 64, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  }

  /**
   * Runs a solid red frame through and checks the bytes. Resolves with the
   * reason for failure, or null when the route works.
   */
  private async selfTest(): Promise<string | null> {
    const device = this.device;
    device.pushErrorScope("internal");
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");
    const probe = new OffscreenCanvas(8, 8);
    const pctx = probe.getContext("2d")!;
    pctx.fillStyle = "#ff0000";
    pctx.fillRect(0, 0, 8, 8);
    const input = new VideoFrame(probe, { timestamp: 0 });
    let output: VideoFrame | null = null;
    let why: string | null = null;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        this.draw(input, GlCompositor.uvFor({ x: 0, y: 0, w: 8, h: 8 }, 8, 8, 0, false), { static: null, active: null, band: { top: 0, height: this.height } });
        output = await this.readFrame(0, 0);
        // A browser may keep its own idea of the range; the maths must match it.
        const full = output.colorSpace?.fullRange === true;
        if (this.packPipeline && full !== this.fullRange) {
          this.setFullRange(full);
          output.close();
          output = null;
          continue;
        }
        break;
      }
      const buf = new Uint8Array(output!.allocationSize());
      await output!.copyTo(buf);
      if (!isRed(output!.format, buf, this.width, this.height, this.fullRange)) why = `readback not red (${output!.format})`;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    } finally {
      input.close();
      output?.close();
    }
    const errors = [await device.popErrorScope(), await device.popErrorScope(), await device.popErrorScope()].filter(Boolean);
    if (errors.length) why = [why, ...errors.map((e) => e!.message)].filter(Boolean).join("; ");
    this.timing.submit = this.timing.wait = this.timing.pack = 0;
    return why;
  }

  /** True when the browser insisted on full-range NV12 (then the frames are made that way). */
  get fullRange(): boolean {
    return this.range === "full";
  }

  private setFullRange(full: boolean) {
    this.range = full ? "full" : "video";
    if (this.dims) this.device.queue.writeBuffer(this.dims, 16, RANGE[this.range]);
  }

  /** Interleaved [x, y, u, v] for the four corners (TL, TR, BL, BR). */
  private static quad(x0: number, y0: number, x1: number, y1: number, uv: Float32Array): Float32Array<ArrayBuffer> {
    // prettier-ignore
    return new Float32Array([
      x0, y0, uv[0], uv[1],
      x1, y0, uv[2], uv[3],
      x0, y1, uv[4], uv[5],
      x1, y1, uv[6], uv[7],
    ]);
  }

  private static readonly FULL_UV = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

  private syncLayer(slot: LayerSlot, layer: NonNullable<Layer>) {
    if (slot.version === layer.version && slot.texture) return;
    const w = layer.canvas.width;
    const h = layer.canvas.height;
    if (!slot.texture || slot.width !== w || slot.height !== h) {
      slot.texture?.destroy();
      slot.texture = this.device.createTexture({
        size: [w, h],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      slot.width = w;
      slot.height = h;
      slot.bindGroup = this.device.createBindGroup({
        layout: this.layerPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: slot.texture.createView() },
        ],
      });
    }
    this.device.queue.copyExternalImageToTexture({ source: layer.canvas }, { texture: slot.texture, premultipliedAlpha: true }, [w, h]);
    slot.version = layer.version;
  }

  /**
   * Composites one frame: the video through `uv`, then the caption layers
   * within their band, then packs it for the encoder. The external texture
   * is only valid during this task, so this is synchronous and submits
   * immediately; `readFrame` collects the result.
   */
  draw(frame: VideoFrame, uv: Float32Array, captions: { static: Layer; active: Layer; band: { top: number; height: number } }) {
    const t0 = performance.now();
    const device = this.device;
    const external = device.importExternalTexture({ source: frame });
    const videoBindGroup = device.createBindGroup({
      layout: this.videoPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: external },
      ],
    });
    const videoKey = uv.join(",");
    if (videoKey !== this.videoQuadKey) {
      device.queue.writeBuffer(this.videoVertices, 0, GpuCompositor.quad(-1, 1, 1, -1, uv));
      this.videoQuadKey = videoKey;
    }

    const showStatic = !!captions.static;
    const showActive = !!captions.active;
    if (showStatic) this.syncLayer(this.staticSlot, captions.static!);
    if (showActive) this.syncLayer(this.activeSlot, captions.active!);
    if (showStatic || showActive) {
      const layerKey = `${captions.band.top}:${captions.band.height}`;
      if (layerKey !== this.layerQuadKey) {
        const y0 = 1 - (2 * captions.band.top) / this.height;
        const y1 = 1 - (2 * (captions.band.top + captions.band.height)) / this.height;
        device.queue.writeBuffer(this.layerVertices, 0, GpuCompositor.quad(-1, y0, 1, y1, GpuCompositor.FULL_UV));
        this.layerQuadKey = layerKey;
      }
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(this.videoPipeline);
    pass.setBindGroup(0, videoBindGroup);
    pass.setVertexBuffer(0, this.videoVertices);
    pass.draw(4);
    if (showStatic || showActive) {
      pass.setPipeline(this.layerPipeline);
      pass.setVertexBuffer(0, this.layerVertices);
      if (showStatic) {
        pass.setBindGroup(0, this.staticSlot.bindGroup!);
        pass.draw(4);
      }
      if (showActive) {
        pass.setBindGroup(0, this.activeSlot.bindGroup!);
        pass.draw(4);
      }
    }
    pass.end();
    if (this.packPipeline) {
      const compute = encoder.beginComputePass();
      compute.setPipeline(this.packPipeline);
      compute.setBindGroup(0, this.packBindGroup!);
      compute.dispatchWorkgroups(this.packGroups);
      compute.end();
      encoder.copyBufferToBuffer(this.packed!, 0, this.readback, 0, this.readback.size);
    } else {
      encoder.copyTextureToBuffer({ texture: this.target }, { buffer: this.readback, bytesPerRow: this.bytesPerRow }, [this.width, this.height]);
    }
    device.queue.submit([encoder.finish()]);
    this.timing.submit += performance.now() - t0;
  }

  /**
   * The frame drawn by the last `draw`, as a VideoFrame for the encoder.
   * Waits for the GPU to finish that frame (a few ms of real work, not a
   * display refresh) and copies the bytes out.
   */
  async readFrame(timestamp: number, duration: number): Promise<VideoFrame> {
    const t0 = performance.now();
    await this.readback.mapAsync(GPUMapMode.READ);
    const t1 = performance.now();
    try {
      const mapped = this.readback.getMappedRange();
      if (this.packPipeline) {
        return new VideoFrame(new Uint8Array(mapped, 0, this.frameBytes), {
          format: "NV12",
          codedWidth: this.width,
          codedHeight: this.height,
          timestamp,
          duration,
          colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: this.fullRange },
        });
      }
      let data: ArrayBuffer | Uint8Array<ArrayBuffer> = mapped;
      if (this.tight) {
        // Padded rows: a declared stride isn't honoured everywhere (WebKit
        // shears the picture), so repack into a tight buffer.
        const src = new Uint8Array(mapped);
        const rowBytes = this.width * 4;
        for (let y = 0; y < this.height; y++) {
          this.tight.set(src.subarray(y * this.bytesPerRow, y * this.bytesPerRow + rowBytes), y * rowBytes);
        }
        data = this.tight;
      }
      return new VideoFrame(data, { format: "RGBA", codedWidth: this.width, codedHeight: this.height, timestamp, duration });
    } finally {
      this.readback.unmap();
      this.timing.wait += t1 - t0;
      this.timing.pack += performance.now() - t1;
    }
  }

  /** Same corner mapping as the WebGL compositor. */
  static uvFor = GlCompositor.uvFor;

  /** Wraps the next draw in a validation error scope; resolve with the error, if any. */
  beginCheck() {
    this.device.pushErrorScope("validation");
  }

  endCheck(): Promise<GPUError | null> {
    return this.device.popErrorScope();
  }

  dispose() {
    this.staticSlot.texture?.destroy();
    this.activeSlot.texture?.destroy();
    this.videoVertices.destroy();
    this.layerVertices.destroy();
    this.readback.destroy();
    this.packed?.destroy();
    this.dims?.destroy();
    this.target.destroy();
    this.device.destroy();
  }
}
