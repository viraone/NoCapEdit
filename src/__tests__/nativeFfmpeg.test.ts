import { describe, expect, it } from "vitest";
import { NativeFFmpeg, NativeFfmpegError, openNativeFfmpeg, type DesktopFfmpegBridge } from "@/lib/ffmpeg/nativeFfmpeg";

type ExecResult = { code: number; refused?: string; unsupported?: string[]; crashed?: string };

function makeFake() {
  const fake = {
    writes: [] as { name: string; bytes: number; append: boolean }[],
    removed: [] as string[],
    made: [] as string[],
    closed: [] as string[],
    execResult: { code: 0 } as ExecResult,
    readBytes: new Uint8Array([104, 105]),
    logFn: null as ((line: string) => void) | null,
    info: async () => ({ available: true, version: "9.0" }),
    open: async () => "s1",
    close: async (id: string) => { fake.closed.push(id); },
    write: async (_id: string, name: string, data: Uint8Array, append?: boolean) => {
      fake.writes.push({ name, bytes: data.length, append: append ?? false });
    },
    read: async () => fake.readBytes,
    mkdir: async (_id: string, name: string) => { fake.made.push(name); },
    remove: async (_id: string, name: string) => { fake.removed.push(name); },
    exec: async () => fake.execResult,
    onLog: (_id: string, fn: ((line: string) => void) | null) => { fake.logFn = fn; },
  };
  return fake as unknown as DesktopFfmpegBridge & typeof fake;
}

describe("NativeFFmpeg", () => {
  it("writeFile sends bytes with append false", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    await ff.writeFile("a.txt", "hi");
    expect(fake.writes).toEqual([{ name: "a.txt", bytes: 2, append: false }]);
  });

  it("writeFile sends a Uint8Array of 5 bytes", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    await ff.writeFile("b.bin", new Uint8Array(5));
    expect(fake.writes[0]).toEqual({ name: "b.bin", bytes: 5, append: false });
  });

  it("readFile returns bytes and a utf8 string", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    expect(await ff.readFile("a.txt")).toEqual(fake.readBytes);
    expect(await ff.readFile("a.txt", "utf8")).toBe("hi");
  });

  it("exec returns the code", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    fake.execResult = { code: 0 };
    expect(await ff.exec(["-i", "a.mp4", "out.mp4"])).toBe(0);
    fake.execResult = { code: 1 };
    expect(await ff.exec(["-i", "a.mp4", "out.mp4"])).toBe(1);
  });

  it("exec rejects on refused, unsupported and crashed", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    fake.execResult = { code: 0, refused: "no" };
    await expect(ff.exec(["x"])).rejects.toBeInstanceOf(NativeFfmpegError);
    fake.execResult = { code: 0, unsupported: ["zscale"] };
    await expect(ff.exec(["x"])).rejects.toThrow(/zscale/);
    fake.execResult = { code: 0, crashed: "boom" };
    await expect(ff.exec(["x"])).rejects.toThrow("boom");
  });

  it("log callbacks fire and can be removed", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    const seen: { message: string }[] = [];
    const cb = (e: { type: string; message: string }) => { seen.push(e); };
    ff.on("log", cb);
    fake.logFn?.("frame=1");
    expect(seen.length).toBe(1);
    expect(seen[0].message).toBe("frame=1");
    ff.off("log", cb);
    fake.logFn?.("frame=2");
    expect(seen.length).toBe(1);
  });

  it("mount creates the folder and writes blob bytes", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    await ff.mount("WORKERFS", { blobs: [{ name: "clip.mp4", data: new Blob([new Uint8Array(10)]) }] }, "/in_x");
    expect(fake.made).toContain("/in_x");
    const total = fake.writes.filter((w) => w.name === "/in_x/clip.mp4").reduce((s, w) => s + w.bytes, 0);
    expect(total).toBe(10);
    expect(fake.writes[0].append).toBe(false);
  });

  it("mount writes an empty blob as one 0-byte write", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    await ff.mount("WORKERFS", { blobs: [{ name: "e.mp4", data: new Blob([]) }] }, "/in_x");
    const w = fake.writes.find((x) => x.name === "/in_x/e.mp4");
    expect(w).toBeDefined();
    expect(w?.bytes).toBe(0);
  });

  it("unmount, deleteDir and deleteFile call remove", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    await ff.unmount("/in_x");
    await ff.deleteDir("d");
    await ff.deleteFile("f");
    expect(fake.removed).toEqual(["/in_x", "d", "f"]);
  });

  it("terminate closes once, sets loaded false and blocks exec", async () => {
    const fake = makeFake();
    const ff = new NativeFFmpeg(fake, "s1", "9.0");
    ff.terminate();
    ff.terminate();
    expect(fake.closed).toEqual(["s1"]);
    expect(ff.loaded).toBe(false);
    await expect(ff.exec(["x"])).rejects.toThrow("called FFmpeg.terminate()");
  });

  it("openNativeFfmpeg resolves to null in node", async () => {
    expect(await openNativeFfmpeg()).toBeNull();
  });
});
