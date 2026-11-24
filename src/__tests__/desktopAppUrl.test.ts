import { describe, expect, it } from "vitest";
import { APP_ORIGIN, contentType, fileCandidates, isAppUrl, isExternalUrl, isolationHeaders } from "../../desktop/lib/appUrl.mjs";

describe("appUrl", () => {
  it("APP_ORIGIN is correct", () => {
    expect(APP_ORIGIN).toBe("app://nocap");
  });

  it("isolationHeaders returns the three exact values and a new object each call", () => {
    const h1 = isolationHeaders();
    const h2 = isolationHeaders();
    expect(h1).toEqual({
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    expect(h1).not.toBe(h2);
  });

  it("contentType maps extensions correctly", () => {
    expect(contentType("index.html")).toBe("text/html");
    expect(contentType("main.js")).toBe("text/javascript");
    expect(contentType("core.wasm")).toBe("application/wasm");
    expect(contentType("video.mp4")).toBe("video/mp4");
    expect(contentType("image.PNG")).toBe("image/png");
    expect(contentType("unknown.xyz")).toBe("application/octet-stream");
    expect(contentType("noext")).toBe("application/octet-stream");
  });

  it("isAppUrl checks protocol and host", () => {
    expect(isAppUrl("app://nocap/")).toBe(true);
    expect(isAppUrl("app://other/")).toBe(false);
    expect(isAppUrl("https://nocapedit.com/")).toBe(false);
    expect(isAppUrl("not a url")).toBe(false);
  });

  it("isExternalUrl checks allowed protocols", () => {
    expect(isExternalUrl("https://example.com")).toBe(true);
    expect(isExternalUrl("http://example.com")).toBe(true);
    expect(isExternalUrl("mailto:test@example.com")).toBe(true);
    expect(isExternalUrl("app://nocap/")).toBe(false);
    expect(isExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalUrl("not a url")).toBe(false);
  });

  it("fileCandidates resolves root to index.html", () => {
    expect(fileCandidates("/site/out", "app://nocap/")).toEqual(["/site/out/index.html"]);
  });

  it("fileCandidates resolves directory with query/hash to index.html", () => {
    expect(fileCandidates("/site/out", "app://nocap/editor/?id=prj_1#x")).toEqual(["/site/out/editor/index.html"]);
  });

  it("fileCandidates resolves file without extension to multiple candidates", () => {
    expect(fileCandidates("/site/out", "app://nocap/editor")).toEqual([
      "/site/out/editor",
      "/site/out/editor.html",
      "/site/out/editor/index.html",
    ]);
  });

  it("fileCandidates resolves nested file", () => {
    const res = fileCandidates("/site/out", "app://nocap/ffmpeg/core-mt/ffmpeg-core.wasm");
    expect(res[0]).toBe("/site/out/ffmpeg/core-mt/ffmpeg-core.wasm");
  });

  it("fileCandidates handles percent-encoded space", () => {
    const res = fileCandidates("/site/out", "app://nocap/sfx/big%20hit.mp3");
    expect(res[0]).toBe("/site/out/sfx/big hit.mp3");
  });

  it("fileCandidates blocks traversal with encoded slashes", () => {
    expect(fileCandidates("/site/out", "app://nocap/..%2F..%2Fetc%2Fpasswd")).toEqual([]);
  });

  it("fileCandidates blocks traversal with encoded dots and slashes", () => {
    expect(fileCandidates("/site/out", "app://nocap/%2e%2e%2f%2e%2e%2fetc/passwd")).toEqual([]);
  });

  it("fileCandidates blocks bad escape sequences", () => {
    expect(fileCandidates("/site/out", "app://nocap/%E0%A4%A")).toEqual([]);
  });

  it("fileCandidates blocks wrong host", () => {
    expect(fileCandidates("/site/out", "app://evil/index.html")).toEqual([]);
    expect(fileCandidates("/site/out", "https://nocap/index.html")).toEqual([]);
  });

  it("fileCandidates handles root with trailing slash", () => {
    expect(fileCandidates("/site/out/", "app://nocap/")).toEqual(["/site/out/index.html"]);
    expect(fileCandidates("/site/out/", "app://nocap/editor")).toEqual([
      "/site/out/editor",
      "/site/out/editor.html",
      "/site/out/editor/index.html",
    ]);
  });
});
