// Builds the release downloads into release/:
//   T3CodeToolkit-<version>.zip            desktop installer for Windows, macOS and Linux (built
//                                          bundle included, so users need neither Node nor npm)
//   T3CodeToolkit-extension-<version>.zip  the browser extension, for Chrome/Edge and Firefox
// Run `npm run build` first (`npm run package` does both).

import { deflateRawSync, crc32 } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
if (manifest.version !== version) throw new Error(`extension version ${manifest.version} != package version ${version}`);
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

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
const entry = (path, prefix = "") => ({ name: prefix + relative(".", path).replaceAll("\\", "/"), data: readFileSync(path) });

mkdirSync("release", { recursive: true });

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
  "scripts/telemetry.cmd",
  "scripts/telemetry.sh",
  ...files("desktop"),
].map((p) => entry(p, top));
writeFileSync(join("release", `T3CodeToolkit-${version}.zip`), zip(desktop));

// Extension zips have manifest.json at the root, as both stores expect.
const extension = files("extension").map((p) => ({ name: relative("extension", p).replaceAll("\\", "/"), data: readFileSync(p) }));
extension.push({ name: "LICENSE", data: readFileSync("LICENSE") });
writeFileSync(join("release", `T3CodeToolkit-extension-${version}.zip`), zip(extension));

console.log(`release/T3CodeToolkit-${version}.zip (${desktop.length} files)`);
console.log(`release/T3CodeToolkit-extension-${version}.zip (${extension.length} files)`);
