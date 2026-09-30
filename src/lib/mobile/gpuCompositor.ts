/// <reference types="@webgpu/types" />
/**
 * WebGPU compositor for the fast exporter.
 *
 * On iPhone, the WebGL route (texImage2D from a VideoFrame, then a
 * VideoFrame from the GL canvas) costs more than decoding and encoding
 * put together. WebGPU is the path Apple built for WebCodecs:
 * `importExternalTexture` takes the decoded frame without a copy, the
 * caption layers are ordinary textures blended on top, and the canvas is
 * read back into an encoder frame. Same crop/rotation maths as the WebGL
 * compositor (texture coordinates per quad corner).
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

type Layer = { canvas: OffscreenCanvas | HTMLCanvasElement; version: number } | null;

interface LayerSlot {
  texture: GPUTexture | null;
  bindGroup: GPUBindGroup | null;
  version: number;
  width: number;
  height: number;
}

export class GpuCompositor {
  readonly canvas: OffscreenCanvas;
  private readonly context: GPUCanvasContext;
  private readonly videoPipeline: GPURenderPipeline;
  private readonly layerPipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private readonly videoVertices: GPUBuffer;
  private readonly layerVertices: GPUBuffer;
  private readonly staticSlot: LayerSlot = { texture: null, bindGroup: null, version: -1, width: 0, height: 0 };
  private readonly activeSlot: LayerSlot = { texture: null, bindGroup: null, version: -1, width: 0, height: 0 };

  static supported(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator && typeof OffscreenCanvas !== "undefined" && typeof VideoFrame !== "undefined";
  }

  /**
   * Resolves to null when WebGPU is present but unusable here. "Usable" is
   * proven, not assumed: a red test frame goes through the whole route
   * (import, draw, read the canvas back into a VideoFrame) under error
   * scopes, and the result must actually be red.
   */
  static async create(width: number, height: number): Promise<GpuCompositor | null> {
    if (!GpuCompositor.supported()) return null;
    let compositor: GpuCompositor | null = null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      compositor = new GpuCompositor(device, width, height);
      device.pushErrorScope("internal");
      device.pushErrorScope("out-of-memory");
      device.pushErrorScope("validation");

      const probe = new OffscreenCanvas(8, 8);
      const pctx = probe.getContext("2d")!;
      pctx.fillStyle = "#ff0000";
      pctx.fillRect(0, 0, 8, 8);
      const input = new VideoFrame(probe, { timestamp: 0 });
      try {
        compositor.draw(input, GlCompositor.uvFor({ x: 0, y: 0, w: 8, h: 8 }, 8, 8, 0, false), { static: null, active: null, band: { top: 0, height } });
      } finally {
        input.close();
      }
      const output = new VideoFrame(compositor.canvas, { timestamp: 0 });
      let red = true;
      try {
        const fmt = output.format ?? "";
        if (/^(RGBA|RGBX|BGRA|BGRX)$/.test(fmt)) {
          const buf = new Uint8Array(output.allocationSize());
          await output.copyTo(buf);
          const r = fmt.startsWith("RGB") ? buf[0] : buf[2];
          const g = buf[1];
          red = r > 200 && g < 60;
        }
      } finally {
        output.close();
      }
      const errors = [await device.popErrorScope(), await device.popErrorScope(), await device.popErrorScope()].filter(Boolean);
      if (errors.length || !red) {
        console.warn("[nocap mobile] WebGPU compositor failed its self-test", errors.map((e) => e?.message), red ? "" : "(readback not red)");
        compositor.dispose();
        return null;
      }
      device.addEventListener("uncapturederror", (e) => console.warn("[nocap mobile] WebGPU error", (e as GPUUncapturedErrorEvent).error.message));
      return compositor;
    } catch (e) {
      console.warn("[nocap mobile] WebGPU compositor unavailable", e);
      compositor?.dispose();
      return null;
    }
  }

  private constructor(
    private readonly device: GPUDevice,
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
    const context = this.canvas.getContext("webgpu");
    if (!context) throw new Error("WebGPU canvas context unavailable");
    this.context = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

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
   * Composites one frame into the canvas: the video through `uv`, then the
   * caption layers within their band. The external texture is only valid
   * during this task, so this is synchronous and submits immediately.
   */
  draw(frame: VideoFrame, uv: Float32Array, captions: { static: Layer; active: Layer; band: { top: number; height: number } }) {
    const device = this.device;
    const external = device.importExternalTexture({ source: frame });
    const videoBindGroup = device.createBindGroup({
      layout: this.videoPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: external },
      ],
    });
    device.queue.writeBuffer(this.videoVertices, 0, GpuCompositor.quad(-1, 1, 1, -1, uv));

    const showStatic = !!captions.static;
    const showActive = !!captions.active;
    if (showStatic) this.syncLayer(this.staticSlot, captions.static!);
    if (showActive) this.syncLayer(this.activeSlot, captions.active!);
    if (showStatic || showActive) {
      const y0 = 1 - (2 * captions.band.top) / this.height;
      const y1 = 1 - (2 * (captions.band.top + captions.band.height)) / this.height;
      device.queue.writeBuffer(this.layerVertices, 0, GpuCompositor.quad(-1, y0, 1, y1, GpuCompositor.FULL_UV));
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
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
    device.queue.submit([encoder.finish()]);
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
    this.context.unconfigure();
    this.device.destroy();
  }
}
