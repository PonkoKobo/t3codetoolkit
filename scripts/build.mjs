import { mkdirSync, readFileSync } from "node:fs";
import * as esbuild from "esbuild";
import { gitDescribe, releaseInfo } from "./release-info.mjs";

const watch = process.argv.includes("--watch");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("dist", { recursive: true });

const options = {
  entryPoints: ["src/core/index.js"],
  bundle: true,
  format: "iife",
  define: {
    __T3TK_VERSION__: JSON.stringify(version),
    // Read once per build; `npm run watch` keeps the value it started with.
    __T3TK_BUILD__: JSON.stringify(releaseInfo(gitDescribe(), version)),
  },
  legalComments: "none",
  banner: { js: "/* T3CodeToolkit: unofficial add-on for T3 Code, not affiliated with T3 Tools, Inc. */" },
  logLevel: "info",
};

const builds = [
  { outfile: "dist/t3tk-core.js", target: "chrome120", extension: false },
  { outfile: "extension/core.js", target: ["chrome120", "firefox142"], extension: true },
];
await Promise.all(builds.map(async ({ extension, ...output }) => {
  const config = {
    ...options,
    ...output,
    define: { ...options.define, __T3TK_EXTENSION__: String(extension) },
    // Remove the unreachable desktop context-menu hook from the extension bundle.
    minifySyntax: extension,
  };
  if (watch) await (await esbuild.context(config)).watch();
  else await esbuild.build(config);
}));
