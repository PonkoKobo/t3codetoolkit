import { copyFileSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

const copy = {
  name: "copy-to-extension",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      copyFileSync("dist/t3tk-core.js", "extension/core.js");
      console.log("built dist/t3tk-core.js -> extension/core.js");
    });
  },
};

const options = {
  entryPoints: ["src/core/index.js"],
  bundle: true,
  format: "iife",
  target: ["chrome120", "firefox128"],
  outfile: "dist/t3tk-core.js",
  legalComments: "none",
  banner: { js: "/* T3CodeToolkit: unofficial add-on for T3 Code, not affiliated with T3 Tools, Inc. */" },
  plugins: [copy],
};

if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
