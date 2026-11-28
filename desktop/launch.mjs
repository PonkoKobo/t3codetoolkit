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
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findApp, installDir, windowsAppId, windowsLauncherName } from "./find-app.mjs";
import { readConfig, updateConfig } from "./config.mjs";
import { splashSource } from "./splash.mjs";
import { createBrowserSharing } from "./browser-sharing.mjs";
import { readAntigravityQuota } from "./antigravity-quota.mjs";
import {
  buildLaunchArgs,
  normalizeLaunchers,
  publicLauncherSpecs,
  readMenu,
  resolveActionTarget,
  runLaunchCommand,
  spawnDetached,
  toPublicMenu,
  validateCachedMenu,
} from "./quick-launcher.mjs";

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
  if (installed) config = readConfig(configPath) ?? {};
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
  console.error(`T3CodeToolkit: ERROR: ${message}`);
  log("error", { message });
  process.exit(code);
};

let appPath = option("--app") ?? (process.env.T3TK_APP || undefined) ?? (config.app && existsSync(config.app) ? config.app : undefined);
if (!appPath) {
  appPath = findApp();
  // An AppImage update renames the file; remember where the app is now.
  if (appPath && installed) {
    try {
      config = updateConfig(configPath, () => ({ app: appPath }));
    } catch {}
  }
}
if (!appPath || !existsSync(appPath)) fail("Couldn't find the T3 Code app. Pass --app <path to the executable> or set T3TK_APP.");

const bundlePath = [join(here, "t3tk-core.js"), join(here, "..", "dist", "t3tk-core.js")].find((p) => existsSync(p));
if (!bundlePath) fail("t3tk-core.js is missing. Run `npm run build`, or reinstall the toolkit.");
const quotaAvailable = installed && process.platform === "win32";
const quotaEnabled = quotaAvailable && config.antigravityQuota === true;
const quickLaunchers = normalizeLaunchers(config.quickLaunchers);
const quickLauncherMap = new Map(quickLaunchers.map((entry) => [entry.id, entry]));
const browserSharing = createBrowserSharing(here);
const bundlePrefix = [
  ...(browserSharing.available ? ["window.__T3TK_BROWSER_SHARING__ = true;"] : []),
  ...(quotaAvailable ? [`window.__T3TK_ANTIGRAVITY_QUOTA_AVAILABLE__ = true; window.__T3TK_ANTIGRAVITY_QUOTA__ = ${quotaEnabled};`] : []),
  ...(quickLaunchers.length ? [`window.__T3TK_QUICK_LAUNCHERS__ = ${JSON.stringify(publicLauncherSpecs(quickLaunchers))};`] : []),
].join("\n");
const bundle = (bundlePrefix ? `${bundlePrefix}\n` : "") + readFileSync(bundlePath, "utf8");
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
const keepTelemetry = flag("--keep-telemetry");
const toolkitDisablesTelemetry = () => !keepTelemetry && config.telemetryOff === true;
if (toolkitDisablesTelemetry()) env.T3CODE_TELEMETRY_ENABLED = "false";
const telemetryOffNow = isOff(env.T3CODE_TELEMETRY_ENABLED);
const inheritedTelemetryOff = isOff(process.env.T3CODE_TELEMETRY_ENABLED);

/** What the toolkit menu shows: telemetry now, after the next start, and whether it can be changed. */
function telemetryState() {
  return {
    offNow: telemetryOffNow,
    offNextStart: inheritedTelemetryOff || toolkitDisablesTelemetry(),
    lockedBy: inheritedTelemetryOff ? "user-setting" : keepTelemetry ? "flag" : !installed ? "not-installed" : null,
  };
}

function setTelemetryOff(off) {
  const state = telemetryState();
  if (state.lockedBy) return state;
  config = updateConfig(configPath, () => ({ telemetryOff: off }));
  log("telemetry", { telemetryOff: off });
  return telemetryState();
}

function quotaState() {
  return { available: quotaAvailable, enabledNow: quotaEnabled, enabledNextStart: quotaAvailable && config.antigravityQuota === true };
}
// We may be running as Node inside T3 Code's own binary; the app itself must start normally.
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

const launchArgs = ["--remote-debugging-pipe"];
if (flag("--dry-run")) {
  console.log(JSON.stringify({ appPath, bundlePath, launchArgs, telemetry: env.T3CODE_TELEMETRY_ENABLED ?? "(unchanged)", telemetryState: telemetryState(), quotaState: quotaState(), quickLaunchers: quickLaunchers.length, logFile }, null, 2));
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
  if (!sawAppWindow && code === 0) {
    fail("T3 Code closed before Toolkit could reach its window. This can happen when another copy is already open.", 3);
  }
  if (!sawAppWindow) {
    fail(`T3 Code exited before Toolkit could reach its window (${signal ?? `exit code ${code}`}).`, code ?? 1);
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
const injectionRetries = new Map();
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
  if (injected.has(id) || inFlight.has(id) || injectionRetries.has(id)) return;
  inFlight.add(id);
  const attempt = (attempts.get(id) ?? 0) + 1;
  attempts.set(id, attempt);
  try {
    const { sessionId } = await send("Target.attachToTarget", { targetId: id, flatten: true });
    if (startupScript) await registerSplash(id, sessionId);
    await send("Page.enable", {}, sessionId);
    // A private channel for settings and quota (see onLauncherRequest). Bindings
    // survive reloads. Runtime.enable makes sure binding calls are reported back to us.
    await send("Runtime.addBinding", { name: BINDING }, sessionId);
    if (quickLaunchers.length) {
      await send("Runtime.addBinding", { name: GUARD_BINDING, executionContextName: GUARD_WORLD }, sessionId);
    }
    await send("Runtime.enable", {}, sessionId);
    if (quickLaunchers.length) {
      await send("Page.addScriptToEvaluateOnNewDocument", { source: quickLauncherGuardScript, worldName: GUARD_WORLD }, sessionId);
      const tree = await send("Page.getFrameTree", {}, sessionId, 2000).catch(() => null);
      const topFrameId = tree?.frameTree?.frame?.id;
      if (topFrameId) {
        const world = await send("Page.createIsolatedWorld", { frameId: topFrameId, worldName: GUARD_WORLD }, sessionId, 2000).catch(() => null);
        if (Number.isInteger(world?.executionContextId)) {
          guardWorldsBySession.set(`${sessionId}:${topFrameId}`, world.executionContextId);
          await send("Runtime.evaluate", { contextId: world.executionContextId, expression: quickLauncherGuardScript }, sessionId, 2000).catch(() => {});
        }
      }
    }
    // Registered first, so every later load or reload of this window gets the toolkit too.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: bundle }, sessionId);
    const result = await send("Runtime.evaluate", { expression: bundle }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    await send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
    injected.add(id);
    // The page may still be loading, in which case the toolkit starts once its DOM is ready.
    const waitForToolkit = `new Promise((done) => { let n = 0; const poll = () => window.__t3tk ? done(window.__t3tk.version) : document.querySelector(".t3tk-compatibility") ? done("waiting for compatibility choice") : ++n > 50 ? done(null) : setTimeout(poll, 100); poll(); })`;
    const check = await send("Runtime.evaluate", { expression: waitForToolkit, awaitPromise: true, returnByValue: true }, sessionId).catch(() => null);
    const active = check?.result?.value;
    say(active ? `toolkit ${active} active in ${target.url}` : `injected into ${target.url}, but the toolkit didn't start there`);
  } catch (error) {
    if (!attempts.has(id)) return; // The window closed during the attempt.
    log("error", { message: `injection attempt ${attempt} failed: ${error.message}` });
    console.error(`T3CodeToolkit: injection attempt ${attempt} failed: ${error.message}`);
    // A slow login can time out a command without changing the target again.
    if (attempt < 3 && fromApp.readable && toApp.writable) {
      injectionRetries.set(id, setTimeout(() => {
        injectionRetries.delete(id);
        void inject(target);
      }, 2000));
    } else {
      injected.add(id);
    }
  } finally {
    inFlight.delete(id);
  }
}

const BINDING = "__t3tkLauncher";
const GUARD_WORLD = "t3tk-guard";
const GUARD_BINDING = "__t3tkGuard";
const AUTH_TTL_MS = 2000;

// Runs only in the isolated GUARD_WORLD; authorizes quick-launcher actions strictly from trusted
// user clicks/keypresses on quick-launcher controls so unrelated page events cannot trigger launches.
const quickLauncherGuardScript = `(() => {
  if (globalThis.__t3tkGuardInstalled) return;
  globalThis.__t3tkGuardInstalled = true;
  const emit = (payload) => {
    try { globalThis.${GUARD_BINDING}?.(JSON.stringify(payload)); } catch {}
  };
  const matchShortcut = (event, label) => {
    if (!label) return false;
    const parts = label.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return false;
    const key = parts[parts.length - 1];
    const mods = new Set(parts.slice(0, -1));
    if (Boolean(event.ctrlKey) !== mods.has("ctrl")) return false;
    if (Boolean(event.altKey) !== mods.has("alt")) return false;
    if (Boolean(event.shiftKey) !== mods.has("shift")) return false;
    if (Boolean(event.metaKey) !== mods.has("meta")) return false;
    const evKey = typeof event.key === "string" ? event.key.toLowerCase() : "";
    return evKey === key || (/^[a-z]$/.test(key) && event.code === "Key" + key.toUpperCase()) || (/^[0-9]$/.test(key) && event.code === "Digit" + key);
  };
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const launchEl = event.target.closest("[data-t3tk-ql-launch][data-t3tk-ql-action]");
    if (launchEl) {
      emit({ kind: "launch", launcherId: launchEl.dataset.t3tkQlLaunch, actionId: launchEl.dataset.t3tkQlAction });
      return;
    }
    const openEl = event.target.closest("[data-t3tk-ql-open]");
    if (openEl) {
      emit({ kind: "open", launcherId: openEl.dataset.t3tkQlOpen });
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.repeat || event.isComposing) return;
    if (event.getModifierState?.("AltGraph")) return;
    const active = document.activeElement instanceof Element ? document.activeElement : null;
    const target = event.target instanceof Element ? event.target : active;
    const menu = target?.closest?.("[data-t3tk-quick-launcher-menu]") ?? document.querySelector("[data-t3tk-quick-launcher-menu]:popover-open");
    if (menu) {
      const launcherId = menu.dataset.t3tkQuickLauncherMenu;
      const inInput = active?.tagName === "INPUT";
      if (!inInput && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key >= "1" && event.key <= "9") {
        const slotEl = menu.querySelector('[data-t3tk-ql-slot="' + event.key + '"][data-t3tk-ql-action]');
        if (slotEl) emit({ kind: "launch", launcherId, actionId: slotEl.dataset.t3tkQlAction });
        return;
      }
      if (event.key === "Enter") {
        if (active?.dataset?.t3tkQlOpen) {
          emit({ kind: "open", launcherId: active.dataset.t3tkQlOpen });
          return;
        }
        if (active?.dataset?.t3tkQlAction) {
          emit({ kind: "launch", launcherId, actionId: active.dataset.t3tkQlAction });
          return;
        }
        const selected = menu.querySelector('[data-selected="true"]');
        const selectedBtn = selected?.matches?.("[data-t3tk-ql-action]") ? selected : selected?.querySelector?.("[data-t3tk-ql-action]");
        const fallback = selectedBtn ?? menu.querySelector("[data-t3tk-ql-resume][data-t3tk-ql-action]") ?? menu.querySelector("[data-t3tk-ql-action]");
        if (fallback?.dataset?.t3tkQlAction) {
          emit({ kind: "launch", launcherId, actionId: fallback.dataset.t3tkQlAction });
        }
        return;
      }
    }
    if (target?.closest?.(".xterm, [data-terminal]")) return;
    for (const btn of document.querySelectorAll("button[data-t3tk-ql-open][data-t3tk-ql-shortcut]")) {
      if (matchShortcut(event, btn.dataset.t3tkQlShortcut)) {
        emit({ kind: "open", launcherId: btn.dataset.t3tkQlOpen });
        return;
      }
    }
  }, true);
})();`;

const quotaCachePath = join(here, "antigravity-quota-cache.json");
let quotaSnapshot = null;
if (quotaEnabled) {
  try { quotaSnapshot = JSON.parse(readFileSync(quotaCachePath, "utf8")); } catch {}
}
let quotaRequest = null;

function saveQuota(snapshot) {
  quotaSnapshot = snapshot;
  try {
    const staging = `${quotaCachePath}.${process.pid}.tmp`;
    writeFileSync(staging, JSON.stringify(snapshot));
    renameSync(staging, quotaCachePath);
  } catch (error) {
    log("error", { message: `couldn't save Gemini quota: ${error.message}` });
  }
  return snapshot;
}

const quickLauncherCachePath = join(here, "quick-launcher-cache.json");
const quickLauncherCache = new Map();
const quickLauncherLiveSnapshots = new Map();
if (quickLaunchers.length) {
  try {
    const parsed = JSON.parse(readFileSync(quickLauncherCachePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const launcher of quickLaunchers) {
        const valid = validateCachedMenu(parsed[launcher.id], launcher);
        if (valid) quickLauncherCache.set(launcher.id, valid);
      }
    }
  } catch {}
}
const quickLauncherRequests = new Map();
const contextsBySession = new Map();
const guardWorldsBySession = new Map();
const pendingAuthorizations = new Map();
const inFlightGuards = new Map();

function saveQuickLauncherCache(launcher, snapshot) {
  quickLauncherCache.set(launcher.id, snapshot);
  quickLauncherLiveSnapshots.set(launcher.id, snapshot);
  try {
    const serialized = {};
    for (const entry of quickLaunchers) {
      const current = quickLauncherCache.get(entry.id);
      if (current) serialized[entry.id] = { configHash: entry.configHash, snapshot: current };
    }
    const staging = `${quickLauncherCachePath}.${process.pid}.tmp`;
    writeFileSync(staging, JSON.stringify(serialized));
    renameSync(staging, quickLauncherCachePath);
  } catch (error) {
    log("error", { message: `couldn't save quick launcher cache: ${error.message}` });
  }
  return snapshot;
}

function refreshQuickLauncher(launcher) {
  let pendingRequest = quickLauncherRequests.get(launcher.id);
  if (!pendingRequest) {
    pendingRequest = readMenu(launcher, (message) => log("error", { message }))
      .then((snapshot) => saveQuickLauncherCache(launcher, snapshot))
      .finally(() => { quickLauncherRequests.delete(launcher.id); });
    quickLauncherRequests.set(launcher.id, pendingRequest);
  }
  return pendingRequest;
}

function authKey(sessionId, frameId, kind, launcherId, actionId = "") {
  return `${sessionId}:${frameId}:${kind}:${launcherId}:${actionId}`;
}

function clearSessionAuthorizations(sessionId) {
  for (const key of pendingAuthorizations.keys()) {
    if (key.startsWith(`${sessionId}:`)) pendingAuthorizations.delete(key);
  }
}

function consumeAuthorization(sessionId, frameId, kind, launcherId, actionId = "") {
  const now = Date.now();
  for (const [key, expiresAt] of pendingAuthorizations) {
    if (expiresAt <= now) pendingAuthorizations.delete(key);
  }
  const key = authKey(sessionId, frameId, kind, launcherId, actionId);
  const expiresAt = pendingAuthorizations.get(key);
  if (!expiresAt || expiresAt <= now) return false;
  pendingAuthorizations.delete(key);
  return true;
}

async function onGuardBinding(sessionId, { payload, executionContextId }) {
  if (!Number.isInteger(executionContextId)) return;
  const ctx = contextsBySession.get(sessionId)?.get(executionContextId);
  if (!ctx || ctx.name !== GUARD_WORLD || ctx.auxData?.isDefault !== false || !ctx.auxData?.frameId) return;
  const tree = await send("Page.getFrameTree", {}, sessionId, 2000).catch(() => null);
  const topFrame = tree?.frameTree?.frame;
  if (!topFrame || topFrame.id !== ctx.auxData.frameId || !APP_URL.test(topFrame.url ?? "")) return;
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return;
  }
  if (!data || typeof data.launcherId !== "string") return;
  if (data.kind === "launch" && typeof data.actionId === "string" && data.actionId) {
    pendingAuthorizations.set(authKey(sessionId, topFrame.id, "launch", data.launcherId, data.actionId), Date.now() + AUTH_TTL_MS);
  } else if (data.kind === "open") {
    pendingAuthorizations.set(authKey(sessionId, topFrame.id, "open", data.launcherId), Date.now() + AUTH_TTL_MS);
  }
}

async function verifyAppContext(sessionId, executionContextId, requireActivation) {
  if (!Number.isInteger(executionContextId)) return null;
  const ctx = contextsBySession.get(sessionId)?.get(executionContextId);
  if (!ctx || ctx.auxData?.isDefault !== true || !ctx.auxData?.frameId) return null;
  const tree = await send("Page.getFrameTree", {}, sessionId, 2000).catch(() => null);
  const topFrame = tree?.frameTree?.frame;
  if (!topFrame || topFrame.id !== ctx.auxData.frameId || !APP_URL.test(topFrame.url ?? "")) return null;
  if (!requireActivation) return { frameId: topFrame.id };

  // Evaluate userActivation in an isolated world so main-world JS cannot spoof navigator properties.
  const worldKey = `${sessionId}:${topFrame.id}`;
  let guardContextId = guardWorldsBySession.get(worldKey);
  if (!Number.isInteger(guardContextId)) {
    const created = await send("Page.createIsolatedWorld", {
      frameId: topFrame.id,
      worldName: GUARD_WORLD,
    }, sessionId, 2000).catch(() => null);
    guardContextId = created?.executionContextId;
    if (!Number.isInteger(guardContextId)) return null;
    guardWorldsBySession.set(worldKey, guardContextId);
  }
  const active = await send("Runtime.evaluate", {
    contextId: guardContextId,
    expression: "Boolean(navigator.userActivation && navigator.userActivation.isActive)",
    returnByValue: true,
  }, sessionId, 2000).catch(() => {
    guardWorldsBySession.delete(worldKey);
    return null;
  });
  return active?.result?.value === true ? { frameId: topFrame.id } : null;
}

async function replyInContext(sessionId, executionContextId, reply) {
  await send("Runtime.evaluate", {
    contextId: executionContextId,
    expression: `window.__t3tkLauncherReply?.(${JSON.stringify(reply)})`,
  }, sessionId).catch(() => {});
}

async function notifyContext(sessionId, executionContextId, event) {
  await send("Runtime.evaluate", {
    contextId: executionContextId,
    expression: `window.__t3tkLauncherEvent?.(${JSON.stringify(event)})`,
  }, sessionId).catch(() => {});
}

async function onLauncherRequest(sessionId, { payload, executionContextId }) {
  let request;
  try {
    request = JSON.parse(payload);
  } catch {
    return;
  }
  if (!request || !Number.isInteger(request.id)) return;
  if (browserSharing.available && typeof request.browserSharing === "string") {
    const operation = request.browserSharing;
    if (!["status", "enable", "disable"].includes(operation)) return;
    if (!await verifyAppContext(sessionId, executionContextId, operation !== "status")) return;
    const reply = { id: request.id };
    try {
      if (operation === "enable") await browserSharing.enable(request.extensionId);
      if (operation === "disable") await browserSharing.disable();
      reply.state = browserSharing.status();
    } catch (error) { reply.error = error.message; }
    await replyInContext(sessionId, executionContextId, reply);
    return;
  }
  const refreshQuota = request.antigravityQuota === true;
  const readQuota = refreshQuota || request.antigravityQuota === "cached";
  const changeQuota = typeof request.geminiQuotaEnabled === "boolean";
  const quotaCommand = readQuota || changeQuota || request.getGeminiQuota === true;
  if (quotaCommand) {
    if (!quotaAvailable || (readQuota && !quotaEnabled)) return;
    if (!await verifyAppContext(sessionId, executionContextId, refreshQuota || changeQuota)) return;

    let reply;
    try {
      if (readQuota) {
        if (refreshQuota) quotaRequest ??= readAntigravityQuota().then(saveQuota).finally(() => { quotaRequest = null; });
        reply = { id: request.id, state: refreshQuota ? await quotaRequest : quotaSnapshot };
      } else {
        if (changeQuota) config = updateConfig(configPath, () => ({ antigravityQuota: request.geminiQuotaEnabled }));
        reply = { id: request.id, state: quotaState() };

      }
    } catch (error) {
      reply = { id: request.id, error: readQuota ? error.message : `Couldn't save the setting: ${error.message}` };
    }
    await replyInContext(sessionId, executionContextId, reply);
    return;
  }
  if (request.quickLauncher === "cached" || request.quickLauncher === "refresh") {
    if (!quickLaunchers.length || typeof request.launcherId !== "string") return;
    const launcher = quickLauncherMap.get(request.launcherId);
    if (!launcher?.listCommand) return;
    if (!await verifyAppContext(sessionId, executionContextId, false)) return;

    const reply = { id: request.id };
    if (request.quickLauncher === "cached") {
      reply.state = toPublicMenu(quickLauncherCache.get(launcher.id) ?? null);
    } else {
      try { reply.state = toPublicMenu(await refreshQuickLauncher(launcher)); }
      catch (error) { reply.error = error.message; }
    }
    await replyInContext(sessionId, executionContextId, reply);
    return;
  }
  if (request.quickLauncherLaunch && typeof request.quickLauncherLaunch === "object") {
    const { launcherId, actionId } = request.quickLauncherLaunch;
    const launcher = typeof launcherId === "string" ? quickLauncherMap.get(launcherId) : null;
    if (!launcher?.launchCommand || typeof actionId !== "string" || !actionId) return;
    await inFlightGuards.get(sessionId);
    const verified = await verifyAppContext(sessionId, executionContextId, true);
    if (!verified || !consumeAuthorization(sessionId, verified.frameId, "launch", launcher.id, actionId)) return;

    const reply = { id: request.id };
    let liveSnapshot = quickLauncherLiveSnapshots.get(launcher.id);
    if (!liveSnapshot && launcher.listCommand) {
      try {
        liveSnapshot = await refreshQuickLauncher(launcher);
      } catch (error) {
        reply.error = error.message;
        await replyInContext(sessionId, executionContextId, reply);
        return;
      }
    }
    const target = resolveActionTarget(liveSnapshot, actionId);
    if (!target) {
      reply.error = "That target is not in the current launcher list. Refresh the menu and try again.";
    } else {
      try {
        const { executable, args } = buildLaunchArgs(launcher.launchCommand, target);
        reply.state = await runLaunchCommand(executable, args, {
          onDiagnostic: (message) => log("error", { message }),
          onLateResult: (outcome) => {
            void notifyContext(sessionId, executionContextId, {
              type: "quickLauncherResult",
              launcherId: launcher.id,
              ...outcome,
            });
          },
        });
      } catch (error) {
        reply.error = error.message;
      }
    }
    await replyInContext(sessionId, executionContextId, reply);
    return;
  }
  if (request.quickLauncherOpen && typeof request.quickLauncherOpen === "object") {
    const { launcherId } = request.quickLauncherOpen;
    const launcher = typeof launcherId === "string" ? quickLauncherMap.get(launcherId) : null;
    if (!launcher?.openApp) return;
    await inFlightGuards.get(sessionId);
    const verified = await verifyAppContext(sessionId, executionContextId, true);
    if (!verified || !consumeAuthorization(sessionId, verified.frameId, "open", launcher.id)) return;

    const reply = { id: request.id };
    try {
      reply.state = await spawnDetached(
        launcher.openApp[0],
        launcher.openApp.slice(1),
        launcher.label,
        (message) => log("error", { message }),
      );
    } catch (error) {
      reply.error = error.message;
    }
    await replyInContext(sessionId, executionContextId, reply);
    return;
  }
  if (!await verifyAppContext(sessionId, executionContextId, false)) return;
  let reply;
  try {
    if (typeof request.telemetryOff === "boolean") reply = { id: request.id, state: setTelemetryOff(request.telemetryOff) };
    else if (request.get === true) reply = { id: request.id, state: telemetryState() };
    else return;
  } catch (error) {
    reply = { id: request.id, error: `Couldn't save the setting: ${error.message}` };
  }
  await replyInContext(sessionId, executionContextId, reply);
}

function clearSessionGuards(sessionId) {
  contextsBySession.delete(sessionId);
  clearSessionAuthorizations(sessionId);
  for (const key of guardWorldsBySession.keys()) {
    if (key.startsWith(`${sessionId}:`)) guardWorldsBySession.delete(key);
  }
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
  if (message.method === "Runtime.executionContextCreated" && message.sessionId && message.params?.context) {
    let map = contextsBySession.get(message.sessionId);
    if (!map) {
      map = new Map();
      contextsBySession.set(message.sessionId, map);
    }
    map.set(message.params.context.id, message.params.context);
    return;
  }
  if (message.method === "Runtime.executionContextDestroyed" && message.sessionId) {
    const destroyedId = message.params?.executionContextId;
    contextsBySession.get(message.sessionId)?.delete(destroyedId);
    for (const [key, id] of guardWorldsBySession) {
      if (id === destroyedId && key.startsWith(`${message.sessionId}:`)) guardWorldsBySession.delete(key);
    }
    return;
  }
  if (message.method === "Runtime.executionContextsCleared" && message.sessionId) {
    clearSessionGuards(message.sessionId);
    return;
  }
  if (message.method === "Page.frameNavigated" && message.sessionId && !message.params?.frame?.parentId) {
    clearSessionAuthorizations(message.sessionId);
    return;
  }
  if (message.method === "Target.detachedFromTarget" && message.params?.sessionId) {
    clearSessionGuards(message.params.sessionId);
    return;
  }
  if (message.method === "Runtime.bindingCalled" && message.params?.name === GUARD_BINDING && message.sessionId) {
    const sid = message.sessionId;
    const prev = inFlightGuards.get(sid) ?? Promise.resolve();
    const next = prev.then(() => onGuardBinding(sid, message.params)).catch(() => {});
    inFlightGuards.set(sid, next);
    void next.finally(() => { if (inFlightGuards.get(sid) === next) inFlightGuards.delete(sid); });
    return;
  }
  if (message.method === "Runtime.bindingCalled" && message.params?.name === BINDING && message.sessionId) {
    void onLauncherRequest(message.sessionId, message.params);
    return;
  }
  if (message.method === "Target.attachedToTarget" && !message.sessionId && startupScript) {
    prepareSplash(message.params);
    return;
  }
  if (message.method === "Target.targetDestroyed") {
    const { targetId } = message.params;
    splashRegistrations.delete(targetId);
    attempts.delete(targetId);
    clearTimeout(injectionRetries.get(targetId));
    injectionRetries.delete(targetId);
  }
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
async function discoverTargets() {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts && fromApp.readable && toApp.writable; attempt++) {
    try {
      await send("Target.setDiscoverTargets", { discover: true });
      log("discovery-ready", { attempt });
      return;
    } catch (error) {
      log("error", { message: `window discovery attempt ${attempt}/${maxAttempts} failed: ${error.message}` });
      // Target discovery can time out while Windows is still starting other apps.
      if (attempt < maxAttempts && fromApp.readable && toApp.writable) await new Promise((done) => setTimeout(done, 2000));
    }
  }
}

void discoverTargets();
