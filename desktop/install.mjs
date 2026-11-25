#!/usr/bin/env node
// Installs T3CodeToolkit for the desktop app: copies the launcher and toolkit into a per-user
// folder and adds a "T3 Code + Toolkit" entry (Start Menu on Windows, an app in ~/Applications on
// macOS, an applications-menu entry on Linux). T3 Code's own install is never modified.
//
//   install.mjs [--app <path to T3 Code executable>] [--keep-telemetry]
//               [--dir <install folder>] [--shortcuts <folder>] [--no-shortcuts]
//   install.mjs --uninstall [--dir <install folder>]
//
// The install.cmd / install.sh / install.command wrappers run this with T3 Code's own binary
// as Node, so Node doesn't need to be installed.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findApp, installDir, windowsAppId, windowsLauncherName } from "./find-app.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const os = platform();
const NAME = "T3 Code + Toolkit";

const dir = resolve(option("--dir") ?? installDir());
const say = (message) => console.log(message);
const die = (message) => {
  console.error(`T3CodeToolkit: ${message}`);
  process.exit(1);
};

function defaultShortcutDir() {
  if (os === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs");
  if (os === "darwin") return join(homedir(), "Applications");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "applications");
}

const readConfig = () => {
  try {
    return JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  } catch {
    return null;
  }
};

if (flag("--uninstall")) {
  const config = readConfig();
  if (!config) die(`No toolkit install found in ${dir}.`);
  for (const shortcut of config.shortcuts ?? []) {
    rmSync(shortcut, { recursive: true, force: true });
    say(`Removed ${shortcut}`);
  }
  process.chdir(homedir()); // Windows can't delete the folder we're standing in
  rmSync(dir, { recursive: true, force: true });
  say(`Removed ${dir}\nT3CodeToolkit is uninstalled. T3 Code itself was not changed.`);
  process.exit(0);
}

// ---- install ----

const previous = readConfig();
const appPath = option("--app") ?? (process.env.T3TK_APP || undefined) ?? findApp();
if (!appPath || !existsSync(appPath)) die("Couldn't find T3 Code. Install it first, or pass --app <path to the T3 Code executable>.");

const bundle = [join(root, "dist", "t3tk-core.js"), join(here, "t3tk-core.js")].find((p) => existsSync(p));
if (!bundle) die("dist/t3tk-core.js is missing. Use a release package, or run `npm install` and `npm run build` first.");
const iconPng = join(root, "extension", "icon-128.png");
const splashPng = join(root, "assets", "icon.png");
const windowsIcon = join(root, "assets", "icon.ico");

let version = "0.0.0";
try {
  version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
} catch {}

mkdirSync(dir, { recursive: true });
const copy = (from, to = from.split(/[\\/]/).pop()) => copyFileSync(from, join(dir, to));
copy(join(here, "launch.mjs"));
copy(join(here, "find-app.mjs"));
copy(join(here, "splash.mjs"));
copy(join(here, "install.mjs")); // so `install.mjs --uninstall` works from the install folder too
copy(bundle, "t3tk-core.js");
if (existsSync(join(root, "package.json"))) copy(join(root, "package.json")); // records the installed version
if (existsSync(iconPng)) copy(iconPng, "icon.png");
if (existsSync(splashPng)) copy(splashPng, "splash.png");
if (os === "win32") {
  copy(join(here, "start.ps1"));
  if (existsSync(windowsIcon)) copy(windowsIcon);
}
else {
  copy(join(here, "start.sh"));
  chmodSync(join(dir, "start.sh"), 0o755);
}
writeFileSync(join(dir, "runtime.txt"), appPath);

const shortcuts = [];
if (!flag("--no-shortcuts")) {
  const target = resolve(option("--shortcuts") ?? defaultShortcutDir());
  mkdirSync(target, { recursive: true });
  if (os === "win32") shortcuts.push(windowsShortcut(target));
  else if (os === "darwin") shortcuts.push(macApp(target));
  else shortcuts.push(linuxDesktopEntry(target));
}

const config = {
  version,
  app: appPath,
  keepTelemetry: flag("--keep-telemetry"),
  // Keep entries from an earlier install that this run didn't recreate, so uninstall finds them.
  shortcuts: [...new Set([...(previous?.shortcuts ?? []).filter((s) => existsSync(s)), ...shortcuts])],
  installedAt: new Date().toISOString(),
};
writeFileSync(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);

say(`T3CodeToolkit ${version} is installed in ${dir}`);
say(`T3 Code: ${appPath}`);
for (const s of shortcuts) say(`Start it from: ${s}`);
say(
  config.keepTelemetry
    ? "Telemetry: left as T3 Code has it."
    : "Telemetry: off for T3 Code started this way. (scripts/telemetry also turns it off for normal starts.)",
);
say("Quit T3 Code before starting it from the toolkit entry; the app only runs one copy at a time.");

// ---- per-OS entries ----

function windowsShortcut(target) {
  const lnk = join(target, `${NAME}.lnk`);
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // Values travel in environment variables so paths never need quoting inside the script.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$csc = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'",
    "& $csc /nologo /target:winexe ('/win32icon:' + $env:T3TK_ICON) ('/out:' + $env:T3TK_EXE) $env:T3TK_SOURCE",
    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:T3TK_LNK)",
    "$s.TargetPath = $env:T3TK_EXE",
    "$s.Arguments = ''",
    "$s.WorkingDirectory = $env:T3TK_DIR",
    "$s.IconLocation = $env:T3TK_EXE + ',0'",
    "$s.Description = 'T3 Code with the unofficial T3CodeToolkit add-on'",
    "$s.WindowStyle = 1",
    "$s.Save()",
    "& $env:T3TK_SHELL -ShortcutPath $env:T3TK_LNK -AppId $env:T3TK_APPID",
  ].join("; ");
  execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    stdio: "inherit",
    env: {
      ...process.env,
      T3TK_LNK: lnk,
      T3TK_EXE: join(dir, windowsLauncherName),
      T3TK_SOURCE: join(here, "windows-launcher.cs"),
      T3TK_SHELL: join(here, "windows-shell.ps1"),
      T3TK_APPID: windowsAppId,
      T3TK_DIR: dir,
      T3TK_ICON: join(dir, "icon.ico"),
    },
  });
  return lnk;
}

// Function declarations (hoisted): macApp runs during top-level install code above this point.
function shQuote(s) {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}
function xml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function macApp(target) {
  const app = join(target, `${NAME}.app`);
  const contents = join(app, "Contents");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  mkdirSync(join(contents, "Resources"), { recursive: true });
  const exe = join(contents, "MacOS", "t3tk");
  writeFileSync(exe, `#!/bin/sh\nexec ${shQuote(join(dir, "start.sh"))} "$@"\n`);
  chmodSync(exe, 0o755);
  if (existsSync(iconPng)) {
    // An .icns holding the 128px PNG as its "ic07" image.
    const png = readFileSync(iconPng);
    const entry = Buffer.alloc(8);
    entry.write("ic07", 0, "ascii");
    entry.writeUInt32BE(8 + png.length, 4);
    const head = Buffer.alloc(8);
    head.write("icns", 0, "ascii");
    head.writeUInt32BE(16 + png.length, 4);
    writeFileSync(join(contents, "Resources", "icon.icns"), Buffer.concat([head, entry, png]));
  }
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${xml(NAME)}</string>
  <key>CFBundleDisplayName</key><string>${xml(NAME)}</string>
  <key>CFBundleIdentifier</key><string>local.t3codetoolkit.launcher</string>
  <key>CFBundleExecutable</key><string>t3tk</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xml(version)}</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`,
  );
  return app;
}

function linuxDesktopEntry(target) {
  const file = join(target, "t3code-toolkit.desktop");
  const execQuote = (s) => `"${s.replace(/(["`$\\])/g, "\\$1")}"`;
  writeFileSync(
    file,
    [
      "[Desktop Entry]",
      "Type=Application",
      `Name=${NAME}`,
      "Comment=T3 Code with the unofficial T3CodeToolkit add-on",
      `Exec=${execQuote(join(dir, "start.sh"))}`,
      ...(existsSync(iconPng) ? [`Icon=${join(dir, "icon.png")}`] : []),
      "Terminal=false",
      "Categories=Development;",
      "",
    ].join("\n"),
  );
  chmodSync(file, 0o755);
  try {
    execFileSync("update-desktop-database", [target], { stdio: "ignore" });
  } catch {}
  return file;
}
