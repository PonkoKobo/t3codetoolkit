import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [bump] = process.argv.slice(2);
if (process.argv.length !== 3 || !["patch", "minor", "major"].includes(bump)) {
  throw new Error("Usage: npm run release:version -- <patch|minor|major>");
}

const path = "extension/manifest.json";
const manifest = readFileSync(path, "utf8");
const versionField = /^(\s*"version"\s*:\s*)"[^"]*"/m;
if (!versionField.test(manifest)) throw new Error("Could not find the extension manifest version.");

// Let npm update package.json and package-lock.json, then sync the tracked manifest.
execFileSync(process.execPath, [process.env.npm_execpath, "version", bump, "--no-git-tag-version"], { stdio: "inherit" });
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const updated = manifest.replace(versionField, (_, field) => field + JSON.stringify(version));
writeFileSync(path, updated);
