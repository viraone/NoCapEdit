import type { NextConfig } from "next";
import path from "node:path";

/**
 * ReelFlow Web ships as a fully static site. Every heavy operation
 * (ffmpeg, Whisper, translation, storage) runs inside the visitor's browser,
 * so the only infrastructure needed is a static file host.
 */
const nextConfig: NextConfig = {
  output: "export",
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
