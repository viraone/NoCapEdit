import { describe, expect, it } from "vitest";
import { checkArgs, missingForArgs, parseCapabilities, rewriteArgs, sandboxProfile, sessionPath, topName } from "../../desktop/lib/ffmpegArgs.mjs";

const ROOT = "/work/s1";

describe("sessionPath", () => {
  it("maps plain, absolute and dot-relative names into the root", () => {
    expect(sessionPath(ROOT, "seg_0.mp4")).toBe("/work/s1/seg_0.mp4");
    expect(sessionPath(ROOT, "/seg_0.mp4")).toBe("/work/s1/seg_0.mp4");
    expect(sessionPath(ROOT, "./seg_0.mp4")).toBe("/work/s1/seg_0.mp4");
  });

  it("maps a nested absolute name into the root", () => {
    expect(sessionPath(ROOT, "/in_abc/clip.mp4")).toBe("/work/s1/in_abc/clip.mp4");
  });

  it("returns null for names that would land outside or are empty", () => {
    expect(sessionPath(ROOT, "../x")).toBeNull();
    expect(sessionPath(ROOT, "/../x")).toBeNull();
    expect(sessionPath(ROOT, "a/../../x")).toBeNull();
    expect(sessionPath(ROOT, "")).toBeNull();
    expect(sessionPath(ROOT, "/")).toBeNull();
    expect(sessionPath(ROOT, ".")).toBeNull();
    expect(sessionPath(ROOT, "a\0b")).toBeNull();
  });

  it("keeps a name that stays inside after normalisation", () => {
    expect(sessionPath(ROOT, "a/../b")).toBe("/work/s1/b");
  });
});

describe("topName", () => {
  it("returns the first segment", () => {
    expect(topName("/in_x/a.mp4")).toBe("in_x");
    expect(topName("seg_0.mp4")).toBe("seg_0.mp4");
    expect(topName("//sh.rnnn")).toBe("sh.rnnn");
  });
});

describe("rewriteArgs", () => {
  it("rewrites an absolute input path to the relative form", () => {
    expect(rewriteArgs(["-i", "/in_x/a.mp4", "out.mp4"], ["in_x"])).toEqual(["-i", "in_x/a.mp4", "out.mp4"]);
  });

  it("rewrites a name inside a filter graph", () => {
    expect(rewriteArgs(["-af", "arnndn=m=/sh.rnnn:mix=0.90"], ["sh.rnnn"])).toEqual(["-af", "arnndn=m=sh.rnnn:mix=0.90"]);
  });

  it("leaves names not in the list alone", () => {
    expect(rewriteArgs(["-i", "/etc/passwd"], ["in_x"])).toEqual(["-i", "/etc/passwd"]);
  });

  it("prefers the longer name over its prefix", () => {
    expect(rewriteArgs(["-i", "/in_x2/a.mp4"], ["in_x", "in_x2"])).toEqual(["-i", "in_x2/a.mp4"]);
  });

  it("only matches a whole path segment", () => {
    expect(rewriteArgs(["-i", "/in_xyz/a.mp4"], ["in_x"])).toEqual(["-i", "/in_xyz/a.mp4"]);
  });

  it("returns an equal copy for an empty names list", () => {
    const args = ["-i", "a.mp4", "out.mp4"];
    const out = rewriteArgs(args, []);
    expect(out).toEqual(args);
    expect(out).not.toBe(args);
  });
});

describe("checkArgs", () => {
  it("allows a normal export command", () => {
    expect(
      checkArgs([
        "-hide_banner", "-y", "-i", "in_x/a.mp4",
        "-filter_complex", "[0:v]scale=1080:1920[vout]",
        "-map", "[vout]", "-c:v", "libx264", "-crf", "23", "seg_0.mp4",
      ]),
    ).toBeNull();
  });

  it("allows a probe command writing to the null output", () => {
    expect(
      checkArgs(["-hide_banner", "-threads", "1", "-i", "in_x/a.mp4", "-frames:v", "1", "-f", "null", "-"]),
    ).toBeNull();
  });

  it("does not refuse on a -map value or an -x264-params value", () => {
    expect(
      checkArgs(["-i", "a.mp4", "-map", "0:a:0", "-x264-params", "ref=1:subme=2", "out.mp4"]),
    ).toBeNull();
  });

  it("allows the caption overlay's concat list (-safe 0) inside the work folder", () => {
    expect(
      checkArgs(["-hide_banner", "-y", "-i", "in_x/a.mp4", "-f", "concat", "-safe", "0", "-i", "ov0/list.txt", "-filter_complex", "[0:v][1:v]overlay[vout]", "-map", "[vout]", "seg_0.mp4"]),
    ).toBeNull();
  });

  it("refuses a concat list outside the work folder", () => {
    expect(typeof checkArgs(["-f", "concat", "-safe", "0", "-i", "/etc/list.txt", "out.mp4"])).toBe("string");
  });

  it("refuses an empty command", () => {
    expect(typeof checkArgs([])).toBe("string");
  });

  it("refuses an absolute input", () => {
    expect(typeof checkArgs(["-i", "/etc/passwd", "out.mp4"])).toBe("string");
  });

  it("refuses a traversal input", () => {
    expect(typeof checkArgs(["-i", "../secret.mp4", "out.mp4"])).toBe("string");
    expect(typeof checkArgs(["-i", "a/../../secret.mp4", "out.mp4"])).toBe("string");
  });

  it("refuses a protocol input", () => {
    expect(typeof checkArgs(["-i", "https://example.com/a.mp4", "out.mp4"])).toBe("string");
    expect(typeof checkArgs(["-i", "file:/etc/passwd", "out.mp4"])).toBe("string");
    expect(typeof checkArgs(["-i", "concat:a|b", "out.mp4"])).toBe("string");
  });

  it("refuses a home-relative input", () => {
    expect(typeof checkArgs(["-i", "~/a.mp4", "out.mp4"])).toBe("string");
  });

  it("refuses an absolute output", () => {
    expect(typeof checkArgs(["-i", "a.mp4", "/tmp/out.mp4"])).toBe("string");
  });

  it("refuses a traversal output", () => {
    expect(typeof checkArgs(["-i", "a.mp4", "../out.mp4"])).toBe("string");
  });

  it("refuses a blocked option", () => {
    expect(typeof checkArgs(["-i", "a.mp4", "-attach", "x", "out.mp4"])).toBe("string");
    expect(typeof checkArgs(["-i", "a.mp4", "-progress", "p.txt", "out.mp4"])).toBe("string");
    expect(typeof checkArgs(["-report", "-i", "a.mp4", "out.mp4"])).toBe("string");
  });

  it("refuses a filter naming a file outside the work folder", () => {
    expect(typeof checkArgs(["-i", "a.mp4", "-vf", "lut3d=file=/etc/x.cube", "out.mp4"])).toBe("string");
    expect(typeof checkArgs(["-i", "a.mp4", "-af", "arnndn=m=../x.rnnn", "out.mp4"])).toBe("string");
  });

  it("refuses the movie filter", () => {
    expect(typeof checkArgs(["-i", "a.mp4", "-filter_complex", "movie=secret.mp4[m]", "out.mp4"])).toBe("string");
  });

  it("allows a relative file inside a filter", () => {
    expect(
      checkArgs(["-i", "a.mp4", "-vf", "lut3d=file=look.cube:interp=trilinear", "out.mp4"]),
    ).toBeNull();
  });
});

describe("parseCapabilities", () => {
  const encodersAll = [
    " V....D libx264              libx264 H.264",
    " V....D libx265              libx265 H.265",
    " A....D aac                  AAC (Advanced Audio Coding)",
  ].join("\n");
  const filtersAll = [
    " .. zscale            V->V       Apply scaling",
    " .. tonemap           V->V       Apply tone mapping",
    " .. loudnorm          A->A       EBU R128",
    " .. lut3d             V->V       Apply a 3D LUT",
    " .. xfade             VV->V      Cross fade",
    " .. arnndn            A->A       Reduce noise",
    " .. afftdn            A->A       Reduce noise",
    " .. overlay           VV->V      Overlay",
    " .. scale             V->V       Scale",
  ].join("\n");

  it("reports usable with everything present", () => {
    const r = parseCapabilities(encodersAll, filtersAll);
    expect(r.usable).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("reports zscale missing but still usable", () => {
    const filters = filtersAll.split("\n").filter((l) => !l.includes("zscale")).join("\n");
    const r = parseCapabilities(encodersAll, filters);
    expect(r.usable).toBe(true);
    expect(r.missing).toContain("zscale");
  });

  it("is not usable without libx264", () => {
    const encoders = encodersAll.split("\n").filter((l) => !l.includes("libx264")).join("\n");
    const r = parseCapabilities(encoders, filtersAll);
    expect(r.usable).toBe(false);
  });

  it("does not count libx264rgb as libx264", () => {
    const encoders = [
      " V....D libx264rgb           libx264 RGB",
      " A....D aac                  AAC (Advanced Audio Coding)",
    ].join("\n");
    const r = parseCapabilities(encoders, filtersAll);
    expect(r.usable).toBe(false);
  });
});

describe("missingForArgs", () => {
  it("returns only the missing pieces the command uses", () => {
    expect(missingForArgs(["-vf", "zscale=t=linear,tonemap=hable", "o.mp4"], ["zscale", "loudnorm"])).toEqual(["zscale"]);
    expect(missingForArgs(["-vf", "scale=1:1", "o.mp4"], ["zscale"])).toEqual([]);
  });
});

describe("sandboxProfile", () => {
  it("denies network, allows writing the work folder and denies reading home", () => {
    const p = sandboxProfile("/work/s1", "/Users/me");
    expect(p).toContain("(deny network*)");
    expect(p).toContain('(allow file-write* (subpath "/work/s1"))');
    const denyLine = p.split("\n").find((l) => l.startsWith("(deny file-read*"));
    expect(denyLine).toBeDefined();
    expect(denyLine).toContain('(subpath "/Users/me")');
  });
});
