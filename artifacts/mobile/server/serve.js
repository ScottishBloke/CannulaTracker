/**
 * Standalone production server for Expo static builds.
 *
 * Route logic:
 * - expo-platform header → Expo Go manifest/bundle from static-build/
 * - /manifest.json, /sw.js, /icon-*.png → served directly from public/ source
 * - /* (browser) → web-dist/ SPA with manifest+SW injected into index.html
 *
 * Zero external dependencies — uses only Node.js built-ins.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const STATIC_ROOT = path.join(PROJECT_ROOT, "static-build");
const WEB_DIST = path.join(PROJECT_ROOT, "web-dist");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function mime(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function readFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return fs.readFileSync(filePath);
    }
  } catch (_) {}
  return null;
}

// PWA assets that are always served from the source public/ directory.
// This guarantees they are always present, even if expo export didn't copy them.
const PWA_ASSETS = new Set(["/manifest.json", "/sw.js", "/icon-192.png", "/icon-512.png"]);

const SW_INJECT = `<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function (r) { console.log('[SW] Registered:', r.scope); })
      .catch(function (e) { console.warn('[SW] Registration failed:', e); });
  });
}
</script>`;

const MANIFEST_INJECT = '<link rel="manifest" href="/manifest.json" />\n  <meta name="theme-color" content="#00d4aa" />\n  <meta name="mobile-web-app-capable" content="yes" />\n  <meta name="apple-mobile-web-app-capable" content="yes" />\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\n  <meta name="apple-mobile-web-app-title" content="Cannula" />\n  <link rel="apple-touch-icon" href="/icon-192.png" />';

function injectPwaIntoHtml(html) {
  if (!html.includes('rel="manifest"')) {
    html = html.replace("</head>", `  ${MANIFEST_INJECT}\n</head>`);
  }
  if (!html.includes("serviceWorker")) {
    html = html.replace("</body>", `${SW_INJECT}\n</body>`);
  }
  return html;
}

function serveExpoManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");
  const data = readFileSafe(manifestPath);
  if (!data) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `Manifest not found for platform: ${platform}` }));
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(data);
}

function serveExpoStaticFile(urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(STATIC_ROOT, safePath);
  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const data = readFileSafe(filePath);
  if (!data) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  res.writeHead(200, { "content-type": mime(filePath) });
  res.end(data);
}

function serveWebPwa(pathname, res) {
  // PWA critical assets — always from source public/ so they're always present.
  if (PWA_ASSETS.has(pathname)) {
    const srcFile = path.join(PUBLIC_DIR, pathname);
    const data = readFileSafe(srcFile);
    if (data) {
      const headers = { "content-type": mime(srcFile) };
      if (pathname === "/sw.js") {
        headers["service-worker-allowed"] = "/";
        headers["cache-control"] = "no-cache, no-store";
      } else if (pathname === "/manifest.json") {
        headers["cache-control"] = "no-cache";
        headers["access-control-allow-origin"] = "*";
      }
      res.writeHead(200, headers);
      res.end(data);
      return;
    }
  }

  // Need web-dist for the app bundle
  if (!fs.existsSync(WEB_DIST)) {
    res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"/><link rel="manifest" href="/manifest.json"/>
      <meta name="theme-color" content="#00d4aa"/></head>
      <body style="background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:40px;text-align:center">
      <h2>Web build unavailable</h2><p>Redeploy to regenerate the web build.</p></body></html>`);
    return;
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = path.join(WEB_DIST, safePath);
  if (!candidate.startsWith(WEB_DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // Try to serve the exact file
  const fileData = readFileSafe(candidate);
  if (fileData) {
    const contentType = mime(candidate);
    // If it's HTML, inject PWA boilerplate
    if (contentType.startsWith("text/html")) {
      const patched = injectPwaIntoHtml(fileData.toString("utf-8"));
      res.writeHead(200, { "content-type": contentType, "cache-control": "no-cache" });
      res.end(patched);
    } else {
      res.writeHead(200, { "content-type": contentType });
      res.end(fileData);
    }
    return;
  }

  // SPA fallback: serve index.html for unknown paths
  const indexPath = path.join(WEB_DIST, "index.html");
  const indexData = readFileSafe(indexPath);
  if (indexData) {
    const patched = injectPwaIntoHtml(indexData.toString("utf-8"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(patched);
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
}

const appName = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "app.json"), "utf-8")).expo?.name || "App";
  } catch { return "App"; }
})();

console.log(`Serving "${appName}" — web-dist: ${fs.existsSync(WEB_DIST) ? "present" : "MISSING (PWA limited)"}`);
console.log(`Public assets: ${fs.existsSync(PUBLIC_DIR) ? "present" : "missing"}`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  const platform = req.headers["expo-platform"];

  if (platform === "ios" || platform === "android") {
    if (pathname === "/" || pathname === "/manifest") {
      return serveExpoManifest(platform, res);
    }
    return serveExpoStaticFile(pathname, res);
  }

  serveWebPwa(pathname, res);
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Listening on port ${port}`);
});
