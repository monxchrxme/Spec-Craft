import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";

const outdir = "public/excalidraw-assets";
await mkdir(outdir, { recursive: true });
await Promise.all([
  build({
    entryPoints: ["excalidraw/adapter.js"],
    outdir,
    bundle: true,
    splitting: true,
    format: "esm",
    target: "es2022",
    minify: true,
    conditions: ["production"],
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "file" },
    legalComments: "linked",
  }),
  cp("node_modules/@excalidraw/excalidraw/dist/prod/fonts", outdir + "/fonts", {
    recursive: true,
  }),
]);
