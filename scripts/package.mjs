// Builds the desktop installer, browser-specific extension ZIPs and checksums into release/.
// Run `npm run build` first (`npm run package` does both).

import { deflateRawSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version === "0.0.0" || version.split(".").some((part) => Number(part) > 65535)) {
  throw new Error(`Invalid release version ${version}: use a browser-compatible MAJOR.MINOR.PATCH version.`);
}
if (lock.version !== version || lock.packages[""].version !== version) {
  throw new Error(`package-lock.json does not match package version ${version}; run npm install --package-lock-only.`);
}
if (manifest.version !== version) throw new Error(`extension version ${manifest.version} != package version ${version}`);
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error(`Release tag ${process.env.GITHUB_REF_NAME} does not match package version v${version}.`);
}
if (!existsSync("dist/t3tk-core.js")) throw new Error("dist/t3tk-core.js is missing; run npm run build");

const EXECUTABLE = /\.(sh|command)$/;

// A minimal zip writer (deflate, Unix modes so the .sh/.command files stay executable).
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12); // 1980-01-01, so the archive is reproducible
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, packed);

    const mode = EXECUTABLE.test(name) ? 0o100755 : 0o100644;
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

mkdirSync("release", { recursive: true });

const checksums = [];
function writeArchive(name, entries) {
  const archive = zip(entries);
  writeFileSync(join("release", name), archive);
  checksums.push(`${createHash("sha256").update(archive).digest("hex")}  ${name}`);
  console.log(`release/${name} (${entries.length} files)`);
}

const top = `T3CodeToolkit-${version}/`;
const desktop = [
  "README.md",
  "LICENSE",
  "package.json",
  "install.cmd",
  "install.sh",
  "install.command",
  "dist/t3tk-core.js",
  "extension/icon-128.png",
  "assets/icon.png",
  "assets/icon.ico",
  "assets/screenshots/effort-switcher.png",
  "assets/screenshots/image-annotation.png",
  "assets/screenshots/model-switcher.png",
  "assets/screenshots/project-pinning.png",
  "assets/screenshots/repository-organizer.png",
  "assets/screenshots/toolkit-menu.png",
  "scripts/telemetry.cmd",
  "scripts/telemetry.sh",
  "desktop/antigravity-quota.mjs",
  "desktop/config.mjs",
  "desktop/find-app.mjs",
  "desktop/install.mjs",
  "desktop/launch.mjs",
  "desktop/splash.mjs",
  "desktop/start.ps1",
  "desktop/start.sh",
  "desktop/windows-launcher.cs",
  "desktop/windows-shell.ps1",
].map((path) => ({ name: top + path, data: readFileSync(path) }));
writeArchive(`T3CodeToolkit-${version}.zip`, desktop);

// Keep the shared manifest loadable from source and tailor only the packaged copies.
const { background: { service_worker, scripts, ...sharedBackground }, browser_specific_settings, ...sharedManifest } = manifest;
const chromium = { ...sharedManifest, background: { ...sharedBackground, service_worker } };
const firefox = { ...sharedManifest, background: { ...sharedBackground, scripts }, browser_specific_settings };

// Each extension ZIP has manifest.json at its root.
const extension = ["background.js", "core.js", "icon-128.png", "options.html", "options.js"]
  .map((name) => ({ name, data: readFileSync(join("extension", name)) }));
extension.push({ name: "LICENSE", data: readFileSync("LICENSE") });
for (const [browser, browserManifest] of Object.entries({ chrome: chromium, edge: chromium, firefox })) {
  writeArchive(`T3CodeToolkit-extension-${browser}-${version}.zip`, [
    ...extension,
    { name: "manifest.json", data: Buffer.from(JSON.stringify(browserManifest, null, 2) + "\n") },
  ]);
}
writeFileSync(join("release", "SHA256SUMS.txt"), checksums.join("\n") + "\n");
