// Locating the installed T3 Code app and the toolkit's own folder on Windows, macOS and Linux.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";

const home = homedir();
export const windowsAppId = "local.t3codetoolkit.launcher";
export const windowsLauncherName = "T3 Code + Toolkit.exe";

/** Where an installed toolkit lives (launcher, bundle, settings and logs). */
export function installDir() {
  if (platform() === "win32") return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "T3CodeToolkit");
  if (platform() === "darwin") return join(home, "Library", "Application Support", "T3CodeToolkit");
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "t3codetoolkit");
}

const list = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

function macApps() {
  const found = [];
  for (const dir of ["/Applications", join(home, "Applications")]) {
    for (const name of list(dir).filter((n) => /^T3 Code.*\.app$/i.test(n)).sort()) {
      const macos = join(dir, name, "Contents", "MacOS");
      const exe = join(macos, basename(name, ".app"));
      if (existsSync(exe)) found.push(exe);
      else found.push(...list(macos).map((f) => join(macos, f)).slice(0, 1));
    }
  }
  return found;
}

function linuxApps() {
  // T3 Code ships as an AppImage whose file name carries the version, so search for the newest one.
  const dirs = [join(home, "Applications"), join(home, "Downloads"), join(home, ".local", "bin"), join(home, "bin"), join(home, "Desktop"), "/opt"];
  const found = [];
  for (const dir of dirs) {
    for (const name of list(dir)) {
      if (!/t3.?code.*\.appimage$/i.test(name)) continue;
      const file = join(dir, name);
      try {
        found.push({ file, time: statSync(file).mtimeMs });
      } catch {}
    }
  }
  return found.sort((a, b) => b.time - a.time).map((f) => f.file);
}

/** Every plausible T3 Code executable, best guess first. */
export function candidateApps() {
  if (platform() === "win32") {
    const bases = [
      join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Programs", "t3code"),
      process.env.ProgramFiles && join(process.env.ProgramFiles, "t3code"),
      process.env.ProgramFiles && join(process.env.ProgramFiles, "T3 Code"),
    ].filter(Boolean);
    return bases.flatMap((b) => [join(b, "T3 Code (Beta).exe"), join(b, "T3 Code.exe")]);
  }
  if (platform() === "darwin") return macApps();
  return linuxApps();
}

export function findApp() {
  return candidateApps().find((p) => existsSync(p));
}
