// Checks the built bundle, the extension manifest and the release zips.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function bootBundle(window = {}, savedFeatures = []) {
  const document = {
    readyState: "complete",
    querySelector: () => ({}),
    createElement: () => ({ dataset: {} }),
    head: { append() {} },
  };
  window.document = document;
  window.top = window;
  const context = vm.createContext({
    window, document, console: { info() {} },
    localStorage: { getItem: () => JSON.stringify(savedFeatures) },
    MutationObserver: class { observe() {} },
    setTimeout: () => 1,
  });
  vm.runInContext(read("dist/t3tk-core.js").toString("utf8"), context);
  return window.__t3tk;
}

test("the toolkit reports the package version when it boots", () => {
  assert.equal(bootBundle().version, version);
});

test("repository expansion fix uses only the desktop app's exact version", async () => {
  const id = "fix-thread-repository-overflow";
  const desktop = (currentVersion) => ({ desktopBridge: { getUpdateState: async () => ({ currentVersion }) } });
  const affected = bootBundle(desktop("0.1.12"));
  const off = bootBundle(desktop("0.1.12"), [id]);
  const unaffected = [
    bootBundle(),
    bootBundle(desktop("0.1.11")),
    bootBundle(desktop("0.1.13")),
    bootBundle(desktop("0.1.12-rc.1")),
    bootBundle({ desktopBridge: { getUpdateState: async () => { throw new Error("Offline"); } } }),
  ];
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(affected.enabled().includes(id));
  assert.ok(off.features.some((feature) => feature.id === id));
  assert.ok(!off.enabled().includes(id));
  for (const toolkit of unaffected) assert.ok(!toolkit.features.some((feature) => feature.id === id));
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

test("release zips are valid and complete and match their published checksums", () => {
  const desktopName = `T3CodeToolkit-${version}.zip`;
  const extensions = ["chrome", "edge", "firefox"].map((browser) => ({
    browser, name: `T3CodeToolkit-extension-${browser}-${version}.zip`,
  }));
  assert.ok(existsSync(join(root, "release", desktopName)), "run `npm run package` first");
  const archives = new Map([desktopName, ...extensions.map(({ name }) => name)]
    .map((name) => [name, read(`release/${name}`)]));
  const checksums = [...archives].map(([name, data]) => `${createHash("sha256").update(data).digest("hex")}  ${name}\n`);
  assert.equal(
    read("release/SHA256SUMS.txt").toString("utf8"),
    checksums.join(""),
  );

  const desktop = unzip(archives.get(desktopName));
  const top = `T3CodeToolkit-${version}/`;
  assert.equal(JSON.parse(desktop.get(top + "package.json").data).version, version);
  assert.deepEqual(desktop.get(top + "dist/t3tk-core.js").data, read("dist/t3tk-core.js"));
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

  const sourceManifest = JSON.parse(read("extension/manifest.json"));
  for (const { browser, name } of extensions) {
    const extension = unzip(archives.get(name));
    assert.ok(extension.has("manifest.json"), `${browser} manifest at the zip root`);
    const manifest = JSON.parse(extension.get("manifest.json").data);
    assert.equal(manifest.version, version);
    assert.deepEqual(manifest.content_scripts, sourceManifest.content_scripts);
    for (const name of ["background.js", "core.js", "icon-128.png", "options.html", "options.js"]) {
      assert.deepEqual(extension.get(name)?.data, read(`extension/${name}`), `${name} in the ${browser} zip`);
    }
    assert.deepEqual(extension.get("LICENSE")?.data, read("LICENSE"));
    if (browser === "firefox") {
      assert.deepEqual(manifest.background, { scripts: ["background.js"] });
      assert.deepEqual(manifest.browser_specific_settings, sourceManifest.browser_specific_settings);
    } else {
      assert.deepEqual(manifest.background, { service_worker: "background.js" });
      assert.ok(!Object.hasOwn(manifest, "browser_specific_settings"));
    }
  }
});
