#!/usr/bin/env node
// Starts the installed T3 Code desktop app with the toolkit injected into its main window.
// Nothing in the install is modified, so it keeps working across T3 Code updates.
//
// It talks to the app over a private DevTools pipe (--remote-debugging-pipe), not a network
// port, so no other program can attach. It runs under any Node 18+, including T3 Code's own
// binary started with ELECTRON_RUN_AS_NODE=1, which is how the installed starters run it.
//
//   launch.mjs [--app <path to T3 Code executable>] [--keep-telemetry] [--dry-run]
//
// Exit codes: the app's own exit code, 1 on a launcher error, 3 when T3 Code was already
// running (the app allows one copy, so the new one handed over to it and quit).

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findApp, installDir, windowsAppId, windowsLauncherName } from "./find-app.mjs";
import { splashSource } from "./splash.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// Settings written by the installer, next to this file.
const configPath = join(here, "config.json");
const installed = existsSync(configPath);
let config = {};
try {
  if (installed) config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {}

// An installed copy logs next to itself; a copy run from the source folder uses the default folder.
const logDir = installed ? here : installDir();
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, "launcher.log");
const log = (event, details = {}) => {
  try {
    appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`);
  } catch {}
};
const say = (message) => {
  console.log(`T3CodeToolkit: ${message}`);
  log("info", { message });
};
const fail = (message, code = 1) => {
  console.error(`T3CodeToolkit: ${message}`);
  log("error", { message });
  process.exit(code);
};

let appPath = option("--app") ?? (process.env.T3TK_APP || undefined) ?? (config.app && existsSync(config.app) ? config.app : undefined);
if (!appPath) {
  appPath = findApp();
  // An AppImage update renames the file; remember where the app is now.
  if (appPath && installed) {
    try {
      writeFileSync(configPath, `${JSON.stringify({ ...config, app: appPath }, null, 2)}\n`);
    } catch {}
  }
}
if (!appPath || !existsSync(appPath)) fail("Couldn't find the T3 Code app. Pass --app <path to the executable> or set T3TK_APP.");

const bundlePath = [join(here, "t3tk-core.js"), join(here, "..", "dist", "t3tk-core.js")].find((p) => existsSync(p));
if (!bundlePath) fail("t3tk-core.js is missing. Run `npm run build`, or reinstall the toolkit.");
const bundle = readFileSync(bundlePath, "utf8");
const logoPath = [join(here, "splash.png"), join(here, "..", "assets", "icon.png")].find((path) => existsSync(path));
const startupScript = logoPath ? splashSource(readFileSync(logoPath, "base64")) : null;

const env = { ...process.env };
if (process.platform === "win32" && installed && existsSync(join(here, windowsLauncherName))) {
  // Match the shortcut's identity before Electron opens its first window.
  env.T3CODE_DESKTOP_APP_USER_MODEL_ID = windowsAppId;
}
// Only reaches the backend this app starts. Remote servers you connect to keep their own setting.
// T3 Code treats these values as "off".
const isOff = (value) => /^(false|no|off|0|n)$/i.test(String(value ?? "").trim());
const keepTelemetry = flag("--keep-telemetry") || config.keepTelemetry === true;
if (!keepTelemetry) env.T3CODE_TELEMETRY_ENABLED = "false";
const telemetryOffNow = isOff(env.T3CODE_TELEMETRY_ENABLED);
// Set for the whole user account (scripts/telemetry), which the launcher can't override.
const telemetryOffForUser = isOff(process.env.T3CODE_TELEMETRY_ENABLED);

/** What the toolkit menu shows: telemetry now, after the next start, and whether it can be changed. */
function telemetryState() {
  const keep = flag("--keep-telemetry") || config.keepTelemetry === true;
  return {
    offNow: telemetryOffNow,
    offNextStart: telemetryOffForUser || !keep,
    lockedBy: telemetryOffForUser ? "user-setting" : flag("--keep-telemetry") ? "flag" : !installed ? "not-installed" : null,
  };
}

function setTelemetryOff(off) {
  const state = telemetryState();
  if (state.lockedBy) return state;
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {}
  config = { ...saved, keepTelemetry: !off };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}
`);
  log("telemetry", { keepTelemetry: !off });
  return telemetryState();
}
// We may be running as Node inside T3 Code's own binary; the app itself must start normally.
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

const launchArgs = ["--remote-debugging-pipe"];
if (flag("--dry-run")) {
  console.log(JSON.stringify({ appPath, bundlePath, launchArgs, telemetry: env.T3CODE_TELEMETRY_ENABLED ?? "(unchanged)", telemetryState: telemetryState(), logFile }, null, 2));
  process.exit(0);
}

// fds 3 and 4 are the DevTools pipe: we write commands to 3 and read replies from 4.
// Chromium quits when this pipe closes, so the launcher stays running (hidden) for as long as
// the app does. When T3 Code restarts itself (some settings changes, updates) the new copy
// has no pipe; a start with the flag but no pipe runs normally, so it should simply lack the
// toolkit until it's next started from here (not yet tried with a real relaunch).
const child = spawn(appPath, launchArgs, { env, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
log("started", { label: "T3CodeToolkit · desktop launcher", pid: child.pid, launcherPid: process.pid, app: appPath });
say(`started T3 Code (pid ${child.pid}). Log: ${logFile}`);

let sawAppWindow = false;
child.on("error", (error) => fail(`couldn't start T3 Code: ${error.message}`));
child.on("exit", (code, signal) => {
  log("exited", { pid: child.pid, code, signal, sawAppWindow });
  if (!sawAppWindow) {
    fail("T3 Code was already running, so the toolkit couldn't attach. Quit T3 Code, then start it again from the toolkit.", 3);
  }
  process.exit(code ?? 1);
});

const toApp = child.stdio[3];
const fromApp = child.stdio[4];
toApp.on("error", () => {}); // the pipe breaks when the app quits; the exit handler reports that

const APP_URL = /^t3code(-dev)?:\/\/app(\/|$)/;
const COMMAND_TIMEOUT_MS = 15_000;
let nextId = 1;
const pending = new Map();

function send(method, params = {}, sessionId, timeout = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!toApp.writable) return reject(new Error("DevTools pipe is closed"));
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    toApp.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
}

// Messages are NUL-terminated JSON. Split on raw bytes so a UTF-8 character cut across two
// chunks is decoded only once the whole message is in.
let partial = [];
fromApp.on("data", (chunk) => {
  let start = 0;
  for (let end = chunk.indexOf(0); end !== -1; end = chunk.indexOf(0, start)) {
    partial.push(chunk.subarray(start, end));
    const text = Buffer.concat(partial).toString("utf8");
    partial = [];
    start = end + 1;
    try {
      onMessage(JSON.parse(text));
    } catch (error) {
      log("error", { message: `bad DevTools message: ${error.message}` });
    }
  }
  if (start < chunk.length) partial.push(chunk.subarray(start));
});
fromApp.on("close", () => {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error("DevTools pipe closed"));
  }
  pending.clear();
});

const injected = new Set();
const inFlight = new Set();
const attempts = new Map();
const splashRegistrations = new Map();

function registerSplash(targetId, sessionId) {
  if (!splashRegistrations.has(targetId)) {
    // Enable Page before registering so the script survives a cross-process navigation.
    const registration = send("Page.enable", {}, sessionId, 2000)
      .then(() => send("Page.addScriptToEvaluateOnNewDocument", {
        source: startupScript,
        runImmediately: true,
      }, sessionId, 2000))
      .catch((error) => {
        splashRegistrations.delete(targetId);
        log("error", { message: `splash setup failed: ${error.message}` });
      });
    splashRegistrations.set(targetId, registration);
  }
  return splashRegistrations.get(targetId);
}

function prepareSplash({ sessionId, targetInfo }) {
  // A new Electron window can be about:blank before its first navigation.
  const url = targetInfo.url;
  if (targetInfo.type === "page" && (!url || url === "about:blank" || APP_URL.test(url) || url.startsWith("data:text/html"))) {
    void registerSplash(targetInfo.targetId, sessionId);
  }
}

async function inject(target) {
  const id = target.targetId;
  if (target.type !== "page" || !APP_URL.test(target.url)) return;
  sawAppWindow = true;
  if (injected.has(id) || inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const { sessionId } = await send("Target.attachToTarget", { targetId: id, flatten: true });
    if (startupScript) await registerSplash(id, sessionId);
    await send("Page.enable", {}, sessionId);
    // A private channel for the toolkit menu's telemetry switch (see onLauncherRequest). Bindings
    // survive reloads. Runtime.enable makes sure binding calls are reported back to us.
    await send("Runtime.addBinding", { name: BINDING }, sessionId);
    await send("Runtime.enable", {}, sessionId);
    // Registered first, so every later load or reload of this window gets the toolkit too.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: bundle }, sessionId);
    const result = await send("Runtime.evaluate", { expression: bundle }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    await send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
    injected.add(id);
    // The page may still be loading, in which case the toolkit starts once its DOM is ready.
    const waitForToolkit = `new Promise((done) => { let n = 0; const poll = () => window.__t3tk ? done(window.__t3tk.version) : ++n > 50 ? done(null) : setTimeout(poll, 100); poll(); })`;
    const check = await send("Runtime.evaluate", { expression: waitForToolkit, awaitPromise: true, returnByValue: true }, sessionId).catch(() => null);
    const active = check?.result?.value;
    say(active ? `toolkit ${active} active in ${target.url}` : `injected into ${target.url}, but the toolkit didn't start there`);
  } catch (error) {
    const n = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, n);
    log("error", { message: `injection attempt ${n} failed: ${error.message}` });
    console.error(`T3CodeToolkit: injection attempt ${n} failed: ${error.message}`);
    // The next targetInfoChanged event retries, up to three times per window.
    if (n >= 3) injected.add(id);
  } finally {
    inFlight.delete(id);
  }
}

const BINDING = "__t3tkLauncher";

// The page asks with {id, get: true} or {id, telemetryOff: boolean}; anything else is ignored.
function onLauncherRequest(sessionId, payload) {
  let request;
  try {
    request = JSON.parse(payload);
  } catch {
    return;
  }
  if (!request || !Number.isInteger(request.id)) return;
  let reply;
  try {
    if (typeof request.telemetryOff === "boolean") reply = { id: request.id, state: setTelemetryOff(request.telemetryOff) };
    else if (request.get === true) reply = { id: request.id, state: telemetryState() };
    else return;
  } catch (error) {
    reply = { id: request.id, error: `Couldn't save the setting: ${error.message}` };
  }
  send("Runtime.evaluate", { expression: `window.__t3tkLauncherReply?.(${JSON.stringify(reply)})` }, sessionId).catch(() => {});
}

function onMessage(message) {
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === "Runtime.bindingCalled" && message.params?.name === BINDING && message.sessionId) {
    onLauncherRequest(message.sessionId, message.params.payload);
    return;
  }
  if (message.method === "Target.attachedToTarget" && !message.sessionId && startupScript) {
    prepareSplash(message.params);
    return;
  }
  if (message.method === "Target.targetDestroyed") splashRegistrations.delete(message.params.targetId);
  if (message.method === "Target.targetCreated" || message.method === "Target.targetInfoChanged") {
    void inject(message.params.targetInfo);
  }
}

if (startupScript) {
  await send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false, // Electron's initially hidden window needs to initialize normally.
    flatten: true,
    filter: [{ type: "page" }, { exclude: true }],
  }, undefined, 2000).catch((error) => log("error", { message: `early splash setup unavailable: ${error.message}` }));
}
send("Target.setDiscoverTargets", { discover: true }).catch((error) => log("error", { message: `discover failed: ${error.message}` }));
