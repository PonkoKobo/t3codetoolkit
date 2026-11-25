// Installs into a temporary folder with a stand-in "app" file, checks the result, then uninstalls.
// Nothing touches the real install folder, Start Menu, ~/Applications or applications menu.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const root = join(import.meta.dirname, "..");
// Long-path form: Windows runners report tmpdir() as an 8.3 path (RUNNER~1), but shortcuts resolve to the long one.
const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "t3tk-test-")));
const dir = join(tmp, "install");
const shortcuts = join(tmp, "shortcuts");
const fakeApp = join(tmp, process.platform === "win32" ? "Fake T3 Code.exe" : "fake-t3code");

// Keep every default location inside the temp folder too, in case a code path falls back to one.
const env = {
  ...process.env,
  HOME: tmp,
  USERPROFILE: tmp,
  APPDATA: join(tmp, "appdata"),
  LOCALAPPDATA: join(tmp, "localappdata"),
  XDG_DATA_HOME: join(tmp, "xdg"),
  T3TK_APP: "",
};
// A machine-wide telemetry setting would change what the launcher reports.
delete env.T3CODE_TELEMETRY_ENABLED;
const run = (script, args) => execFileSync(process.execPath, [join(root, script), ...args], { env, encoding: "utf8" });

before(() => {
  if (!existsSync(join(root, "dist", "t3tk-core.js"))) throw new Error("run `npm run build` first");
  writeFileSync(fakeApp, "not a real app");
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test("launcher dry run resolves the app and turns telemetry off", () => {
  const out = JSON.parse(run("desktop/launch.mjs", ["--app", fakeApp, "--dry-run"]));
  assert.equal(out.appPath, fakeApp);
  assert.equal(out.telemetry, "false");
  assert.deepEqual(out.launchArgs, ["--remote-debugging-pipe"]);
  assert.ok(out.bundlePath.endsWith("t3tk-core.js"));
  const kept = JSON.parse(run("desktop/launch.mjs", ["--app", fakeApp, "--dry-run", "--keep-telemetry"]));
  assert.equal(kept.telemetry, "(unchanged)");
  // Run from the source folder, the menu switch can't save anything, so it shows as locked.
  assert.deepEqual(out.telemetryState, { offNow: true, offNextStart: true, lockedBy: "not-installed" });
  assert.equal(kept.telemetryState.lockedBy, "flag");
  const userOff = JSON.parse(execFileSync(process.execPath, [join(root, "desktop/launch.mjs"), "--app", fakeApp, "--dry-run", "--keep-telemetry"], { env: { ...env, T3CODE_TELEMETRY_ENABLED: "off" }, encoding: "utf8" }));
  assert.deepEqual(userOff.telemetryState, { offNow: true, offNextStart: true, lockedBy: "user-setting" });
});

test("install, run the installed launcher, uninstall", () => {
  run("desktop/install.mjs", ["--app", fakeApp, "--dir", dir, "--shortcuts", shortcuts]);

  const starter = process.platform === "win32" ? "start.ps1" : "start.sh";
  for (const file of ["launch.mjs", "find-app.mjs", "install.mjs", "splash.mjs", "splash.png", "t3tk-core.js", "config.json", "runtime.txt", starter]) {
    assert.ok(existsSync(join(dir, file)), `${file} installed`);
  }
  if (process.platform !== "win32") assert.ok(statSync(join(dir, "start.sh")).mode & 0o100, "start.sh is executable");
  else {
    const ico = readFileSync(join(dir, "icon.ico"));
    assert.deepEqual(ico, readFileSync(join(root, "assets", "icon.ico")));
    assert.equal(ico.readUInt16LE(2), 1, "Windows icon");
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
    for (const size of [16, 32, 48, 256]) assert.ok(sizes.includes(size), `${size}px icon frame`);
  }
  assert.deepEqual(readFileSync(join(dir, "splash.png")), readFileSync(join(root, "assets", "icon.png")));
  assert.equal(readFileSync(join(dir, "runtime.txt"), "utf8"), fakeApp);

  const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  assert.equal(config.app, fakeApp);
  assert.equal(config.keepTelemetry, false);
  assert.equal(config.shortcuts.length, 1);
  const [entry] = config.shortcuts;
  assert.ok(entry.startsWith(shortcuts), "entry created in the requested folder");
  assert.ok(existsSync(entry), `${entry} exists`);
  if (process.platform === "win32") {
    const exe = join(dir, "T3 Code + Toolkit.exe");
    assert.equal(readFileSync(exe).toString("ascii", 0, 2), "MZ");
    const ps = join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = [
      "$link = (New-Object -ComObject WScript.Shell).CreateShortcut($env:T3TK_TEST_LNK)",
      "$shell = New-Object -ComObject Shell.Application",
      "$item = $shell.Namespace((Split-Path $env:T3TK_TEST_LNK)).ParseName((Split-Path -Leaf $env:T3TK_TEST_LNK))",
      "@{ target = $link.TargetPath; icon = $link.IconLocation; appId = $item.ExtendedProperty('System.AppUserModel.ID') } | ConvertTo-Json -Compress",
    ].join("; ");
    const link = JSON.parse(execFileSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: { ...process.env, T3TK_TEST_LNK: entry },
    }));
    assert.deepEqual(link, { target: exe, icon: exe + ",0", appId: "local.t3codetoolkit.launcher" });
  } else if (process.platform === "darwin") {
    const plist = readFileSync(join(entry, "Contents", "Info.plist"), "utf8");
    assert.match(plist, /<key>CFBundleExecutable<\/key><string>t3tk<\/string>/);
    assert.ok(statSync(join(entry, "Contents", "MacOS", "t3tk")).mode & 0o100);
  } else if (process.platform === "linux") {
    const desktop = readFileSync(entry, "utf8");
    assert.match(desktop, /^\[Desktop Entry\]/);
    assert.ok(desktop.includes(join(dir, "start.sh")));
  }

  // The installed copy uses its own bundle and the app recorded at install time.
  const out = JSON.parse(execFileSync(process.execPath, [join(dir, "launch.mjs"), "--dry-run"], { env, encoding: "utf8" }));
  assert.equal(out.appPath, fakeApp);
  assert.equal(out.bundlePath, join(dir, "t3tk-core.js"));
  assert.equal(out.telemetry, "false");
  assert.deepEqual(out.telemetryState, { offNow: true, offNextStart: true, lockedBy: null });

  run("desktop/install.mjs", ["--uninstall", "--dir", dir]);
  assert.equal(existsSync(dir), false, "install folder removed");
  assert.equal(existsSync(entry), false, "menu entry removed");
  assert.ok(existsSync(fakeApp), "the app itself is untouched");
});

test("install refuses a missing app", () => {
  assert.throws(() => run("desktop/install.mjs", ["--app", join(tmp, "missing"), "--dir", join(tmp, "nope"), "--no-shortcuts"]));
  assert.equal(existsSync(join(tmp, "nope")), false);
});
