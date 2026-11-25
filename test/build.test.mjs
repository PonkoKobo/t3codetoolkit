// Checks the built bundle, the extension manifest and the release zips.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { crc32, inflateRawSync } from "node:zlib";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p));
const { version } = JSON.parse(read("package.json"));

test("the bundle is a self-contained script with the unaffiliated notice", () => {
  const bundle = read("dist/t3tk-core.js").toString("utf8");
  assert.match(bundle, /unofficial add-on for T3 Code, not affiliated with T3 Tools, Inc\./);
  assert.doesNotMatch(bundle, /^\s*(import|export)\s/m, "no module syntax left");
  new vm.Script(bundle); // parses
  assert.equal(read("extension/core.js").toString("utf8"), bundle, "extension carries the same build");
});

test("the bundle stays inert outside T3 Code", () => {
  // No #root and not t3code:, so it must not boot (or throw) on unrelated pages.
  const document = { readyState: "complete", querySelector: () => null };
  const window = { document, location: { protocol: "https:" } };
  window.top = window;
  const context = vm.createContext({ window, document, location: window.location, console });
  vm.runInContext(read("dist/t3tk-core.js").toString("utf8"), context);
  assert.equal(window.__t3tk, undefined);
});

test("extension manifest matches the package version and names itself unofficial", () => {
  const manifest = JSON.parse(read("extension/manifest.json"));
  assert.equal(manifest.version, version);
  assert.match(`${manifest.name} ${manifest.description}`, /unofficial|not affiliated/i);
});

/** Reads a zip's central directory and inflates each entry, checking sizes and CRCs. */
function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end of central directory");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50);
    const crc = buffer.readUInt32LE(at + 16);
    const packed = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const mode = buffer.readUInt32LE(at + 38) >>> 16;
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = inflateRawSync(buffer.subarray(dataAt, dataAt + packed));
    assert.equal(data.length, size, `${name} size`);
    assert.equal(crc32(data), crc, `${name} crc`);
    entries.set(name, { data, mode });
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return entries;
}

test("release zips are valid and complete", (t) => {
  const desktopZip = join(root, "release", `T3CodeToolkit-${version}.zip`);
  if (!existsSync(desktopZip)) return t.skip("run `npm run package` first");

  const desktop = unzip(readFileSync(desktopZip));
  const top = `T3CodeToolkit-${version}/`;
  for (const name of [
    "install.cmd", "install.sh", "install.command", "dist/t3tk-core.js",
    "desktop/install.mjs", "desktop/launch.mjs", "desktop/splash.mjs", "desktop/start.sh", "desktop/start.ps1",
    "desktop/windows-launcher.cs", "desktop/windows-shell.ps1", "assets/icon.png", "assets/icon.ico",
  ]) {
    assert.ok(desktop.has(top + name), `${name} in the desktop zip`);
  }
  for (const name of ["install.sh", "install.command", "desktop/start.sh"]) {
    assert.equal(desktop.get(top + name).mode & 0o777, 0o755, `${name} is executable`);
  }
  assert.ok(desktop.get(top + "install.cmd").data.includes("\r\n"), "install.cmd keeps CRLF line endings");
  assert.ok(!desktop.get(top + "install.sh").data.includes("\r\n"), "install.sh keeps LF line endings");

  const extension = unzip(readFileSync(join(root, "release", `T3CodeToolkit-extension-${version}.zip`)));
  assert.ok(extension.has("manifest.json"), "manifest at the zip root");
  assert.ok(extension.has("core.js"));
  const manifest = JSON.parse(extension.get("manifest.json").data);
  assert.deepEqual(extension.get(manifest.action.default_icon["128"]).data, read("extension/icon-128.png"));
});
