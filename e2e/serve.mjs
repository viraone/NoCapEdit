// Static server for the exported site with cross-origin isolation headers.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const root = process.argv[2];
const port = Number(process.argv[3] ?? 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".rnnn": "application/octet-stream", ".txt": "text/plain" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  const candidates = path.endsWith("/") ? [join(root, path, "index.html")] : [join(root, path), join(root, path + ".html"), join(root, path, "index.html")];
  for (const file of candidates) {
    try {
      const s = await stat(file);
      if (!s.isFile()) continue;
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Content-Length": data.length,
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "no-store",
      });
      res.end(data);
      return;
    } catch {
      /* try next */
    }
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
