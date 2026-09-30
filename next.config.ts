import type { NextConfig } from "next";
import path from "node:path";
import { execSync } from "node:child_process";

/** Short commit SHA, shown in the mobile editor's footer so a bug report
 * says which build it came from (Vercel sets VERCEL_GIT_COMMIT_SHA). */
function buildSha(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

/**
 * NoCap Edit ships as a fully static site. Every heavy operation
 * (ffmpeg, Whisper, translation, storage) runs inside the visitor's browser,
 * so the only infrastructure needed is a static file host.
 */
// Production (https://nocapedit.com) is served from the domain root, so no
// basePath/assetPrefix is applied. NEXT_PUBLIC_BASE_PATH is only for hosting
// under a sub-directory (e.g. a GitHub Pages project site without a domain).
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "export",
  env: { NEXT_PUBLIC_BUILD_SHA: buildSha() },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // /editor -> /editor/index.html so every static host serves it without rewrites.
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  turbopack: {
    root: path.resolve("."),
    // Transformers.js lists Node-only optional deps (sharp, onnxruntime-node).
    // They are never used in the browser; alias them away so bundling stays clean.
    resolveAlias: {
      sharp: { browser: "./src/lib/empty.ts" },
      "onnxruntime-node": { browser: "./src/lib/empty.ts" },
    },
  },
};

export default nextConfig;
