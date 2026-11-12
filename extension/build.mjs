// Builds the extension into dist/ (the folder you "Load unpacked" in Chrome).
//   npm run build            -> talks to the live server
//   npm run build -- --local -> talks to http://localhost:3000
//   npm run build -- --server=URL -> any other server (used by tests)
//   npm run watch            -> rebuilds on every change
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const local = process.argv.includes("--local");
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const serverArg = process.argv.find((a) => a.startsWith("--server="))?.slice(9);
const SERVER_URL = serverArg ?? (local ? "http://localhost:3000" : "https://checkmate-pi-six.vercel.app");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// Static files: popup.html, popup.css, icons. The manifest gets the version from package.json.
cpSync("static", "dist", { recursive: true });
const manifest = JSON.parse(readFileSync("static/manifest.json", "utf8"));
manifest.version = pkg.version;
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));

const options = {
  entryPoints: { popup: "src/popup.ts", background: "src/background.ts", extract: "src/extract.ts", panel: "src/panel.ts" },
  outdir: "dist",
  bundle: true,
  loader: { ".css": "text", ".png": "dataurl" },
  format: "esm",
  target: "chrome120",
  define: { __SERVER_URL__: JSON.stringify(SERVER_URL), __VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
  console.log(`Built CheckMate ${pkg.version} -> dist/ (server: ${SERVER_URL})`);
}
