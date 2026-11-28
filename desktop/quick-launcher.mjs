import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const DEFAULT_MAX_ITEMS = 100;
const MAX_ACTIONS_PER_ITEM = 50;
const LIST_TIMEOUT_MS = 15_000;
const LIST_MAX_BUFFER = 2 * 1024 * 1024;
const LAUNCH_PENDING_MS = 4_000;
const LAUNCH_MAX_TRACK_MS = 5 * 60_000;

function trimString(value, maxLength = 240) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function normalizeCommand(value) {
  if (typeof value === "string") {
    const exe = value.trim();
    return exe && isAbsolute(exe) ? [exe] : null;
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts = value.map((part) => (typeof part === "string" ? part : null));
  if (parts.some((part) => part === null)) return null;
  const exe = parts[0].trim();
  if (!exe || !isAbsolute(exe)) return null;
  return [exe, ...parts.slice(1)];
}

/** Strips Electron/Node launcher overrides so external GUI/Electron apps start normally. */
export function childEnv(base = process.env) {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

/** Stable fingerprint binding cached menu entries to one provider command configuration. */
export function launcherConfigHash({ listCommand, launchCommand, maxItems }) {
  return createHash("sha256")
    .update(JSON.stringify({ listCommand, launchCommand, maxItems }))
    .digest("hex")
    .slice(0, 24);
}

/** Opaque action token sent to the renderer instead of raw host filesystem paths. */
export function actionIdForTarget(target) {
  return createHash("sha256").update(target).digest("hex").slice(0, 20);
}

/** Validates config.quickLaunchers entries from config.json. */
export function normalizeLaunchers(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = trimString(entry.id, 64);
    const label = trimString(entry.label, 48);
    if (!id || !label || seen.has(id)) continue;
    const openApp = normalizeCommand(entry.openApp);
    const listCommand = normalizeCommand(entry.listCommand);
    const launchCommand = normalizeCommand(entry.launchCommand);
    if (!openApp && !listCommand) continue;
    const shortcut = trimString(entry.shortcut, 32) || null;
    const maxItems = Number.isInteger(entry.maxItems) && entry.maxItems > 0
      ? Math.min(entry.maxItems, 500)
      : DEFAULT_MAX_ITEMS;
    const configHash = launcherConfigHash({ listCommand, launchCommand, maxItems });
    seen.add(id);
    result.push({ id, label, shortcut, openApp, listCommand, launchCommand, maxItems, configHash });
  }
  return result;
}

/** Public metadata injected into the page (never exposes host command paths). */
export function publicLauncherSpecs(launchers) {
  return launchers.map(({ id, label, shortcut, openApp, listCommand, launchCommand }) => ({
    id,
    label,
    shortcut,
    hasMenu: Boolean(listCommand),
    canOpenApp: Boolean(openApp),
    canLaunch: Boolean(launchCommand),
  }));
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== "object") return null;
  const target = trimString(raw.target ?? raw.path, 1024);
  const label = trimString(raw.label ?? raw.name, 160);
  if (!target || !label) return null;
  const category = trimString(raw.category, 32);
  const meta = trimString(raw.meta ?? raw.modified, 64);
  const description = trimString(raw.description ?? raw.when, 280);
  const group = trimString(raw.group ?? raw.game, 120);
  return {
    actionId: actionIdForTarget(target),
    label,
    target,
    ...(group ? { group } : {}),
    ...(category ? { category } : {}),
    ...(meta ? { meta } : {}),
    ...(description ? { description } : {}),
  };
}

/** Validates and normalizes JSON returned by a launcher's listCommand. */
export function normalizeMenuData(raw, maxItems = DEFAULT_MAX_ITEMS) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.items)) {
    throw new Error("Quick launcher returned invalid menu data.");
  }
  const items = [];
  for (const entry of raw.items) {
    if (items.length >= maxItems) break;
    if (!entry || typeof entry !== "object") continue;
    const label = trimString(entry.label ?? entry.name, 120);
    if (!label) continue;
    const id = trimString(entry.id, 120) || label;
    const subtitle = trimString(entry.subtitle, 160);
    const defaultAction = normalizeAction(entry.defaultAction);
    const actions = [];
    if (Array.isArray(entry.actions)) {
      for (const actionRaw of entry.actions) {
        if (actions.length >= MAX_ACTIONS_PER_ITEM) break;
        const action = normalizeAction(actionRaw);
        if (action) actions.push(action);
      }
    }
    if (!defaultAction && actions.length === 0) continue;
    items.push({
      id,
      label,
      ...(subtitle ? { subtitle } : {}),
      defaultAction,
      actions,
    });
  }
  const quickResume = normalizeAction(raw.quickResume);
  return { quickResume, items };
}

/** Validates a disk-cached entry against the launcher's current configHash and menu schema. */
export function validateCachedMenu(entry, launcher) {
  if (!entry || typeof entry !== "object" || !launcher) return null;
  if (entry.configHash !== launcher.configHash) return null;
  const snapshot = entry.snapshot;
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.items)) return null;
  const checkedAt = typeof snapshot.checkedAt === "string" && Number.isFinite(Date.parse(snapshot.checkedAt))
    ? snapshot.checkedAt
    : null;
  if (!checkedAt) return null;
  try {
    return {
      ...normalizeMenuData(snapshot, launcher.maxItems),
      checkedAt,
    };
  } catch {
    return null;
  }
}

function stripActionTarget(action) {
  if (!action) return null;
  const { target: _target, ...publicAction } = action;
  return publicAction;
}

/** Strips host target paths before sending a menu snapshot to the renderer. */
export function toPublicMenu(menu) {
  if (!menu) return null;
  return {
    checkedAt: menu.checkedAt,
    quickResume: stripActionTarget(menu.quickResume),
    items: (menu.items ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      defaultAction: stripActionTarget(item.defaultAction),
      actions: (item.actions ?? []).map(stripActionTarget),
    })),
  };
}

/** Maps opaque actionId -> host target for every action present in a normalized menu snapshot. */
export function collectAllowedActionMap(menu) {
  const map = new Map();
  if (!menu || typeof menu !== "object") return map;
  const record = (action) => {
    if (action?.actionId && typeof action.target === "string" && action.target) {
      map.set(action.actionId, action.target);
    }
  };
  record(menu.quickResume);
  for (const item of menu.items ?? []) {
    record(item?.defaultAction);
    for (const action of item?.actions ?? []) record(action);
  }
  return map;
}

/** Resolves an opaque actionId back to its allow-listed host target, or null. */
export function resolveActionTarget(menu, actionId) {
  if (typeof actionId !== "string" || !actionId) return null;
  return collectAllowedActionMap(menu).get(actionId) ?? null;
}

/** Builds argv for launchCommand in one pass so literal $$/$&/{path} inside target are preserved. */
export function buildLaunchArgs(launchCommand, target) {
  const [executable, ...templateArgs] = launchCommand;
  let replaced = false;
  const args = templateArgs.map((arg) =>
    arg.replace(/\{(?:target|path)\}/g, () => {
      replaced = true;
      return target;
    }),
  );
  if (!replaced) args.push(target);
  return { executable, args };
}

export async function readMenu(launcher, onDiagnostic = null) {
  if (!launcher?.listCommand) throw new Error("This launcher does not provide a menu.");
  const [executable, ...args] = launcher.listCommand;
  let stdout;
  try {
    ({ stdout } = await exec(executable, args, {
      env: childEnv(),
      windowsHide: true,
      timeout: LIST_TIMEOUT_MS,
      maxBuffer: LIST_MAX_BUFFER,
    }));
  } catch (error) {
    onDiagnostic?.(`quick-launcher list failed (${launcher.id}): ${error.message}`);
    if (error.killed) throw new Error(`${launcher.label} took too long to list items.`);
    throw new Error(`Could not load ${launcher.label}. Check launcher.log for details.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    onDiagnostic?.(`quick-launcher returned non-JSON (${launcher.id})`);
    throw new Error(`${launcher.label} returned non-JSON menu output.`);
  }
  return {
    ...normalizeMenuData(parsed, launcher.maxItems),
    checkedAt: new Date().toISOString(),
  };
}

export function spawnDetached(executable, args = [], label = "launcher", onDiagnostic = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    try {
      const child = spawn(executable, args, {
        env: childEnv(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", (error) => {
        onDiagnostic?.(`quick-launcher open failed (${label}): ${error.message}`);
        finish(reject, new Error(`Could not start ${label}. Check launcher.log for details.`));
      });
      child.once("spawn", () => {
        child.unref();
        finish(resolve, { ok: true });
      });
    } catch (error) {
      onDiagnostic?.(`quick-launcher open failed (${label}): ${error.message}`);
      finish(reject, new Error(`Could not start ${label}. Check launcher.log for details.`));
    }
  });
}

function exitResult(code, stderr, onDiagnostic) {
  if (code === 0) return { ok: true };
  if (code === 3) return { ok: false, cancelled: true };
  if (stderr.trim()) onDiagnostic?.(`quick-launcher stderr (exit ${code}): ${stderr.trim()}`);
  if (code === 2) {
    return { ok: false, error: "That command is no longer available. Refresh the menu and try again." };
  }
  return { ok: false, error: `Could not launch that command (exit code ${code ?? "unknown"}). Check launcher.log for details.` };
}

/**
 * Runs a launchCommand and reports fast CLI outcomes directly.
 * If the command stays alive past pendingAfterMs (e.g. a Build confirmation dialog),
 * resolves { ok: true, pending: true } and reports the eventual exit via onLateResult
 * (up to maxTrackMs) so delayed cancellations or failures are never lost.
 */
export function runLaunchCommand(
  executable,
  args = [],
  { pendingAfterMs = LAUNCH_PENDING_MS, maxTrackMs = LAUNCH_MAX_TRACK_MS, onLateResult = null, onDiagnostic = null } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pendingTimer = null;
    let maxTimer = null;
    let stderr = "";
    const clearTimers = () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      if (maxTimer) clearTimeout(maxTimer);
      pendingTimer = null;
      maxTimer = null;
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
      fn(value);
    };
    let child;
    try {
      child = spawn(executable, args, {
        env: childEnv(),
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      onDiagnostic?.(`quick-launcher spawn failed: ${error.message}`);
      finish(reject, new Error("Could not start launcher. Check launcher.log for details."));
      return;
    }

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 2048) stderr += chunk;
    });

    child.once("error", (error) => {
      clearTimers();
      child.stderr?.destroy();
      onDiagnostic?.(`quick-launcher process error: ${error.message}`);
      const message = "Could not start launcher. Check launcher.log for details.";
      if (!settled) finish(reject, new Error(message));
      else onLateResult?.({ ok: false, error: message });
    });

    child.once("exit", (code) => {
      clearTimers();
      child.stderr?.destroy();
      const outcome = exitResult(code, stderr, onDiagnostic);
      if (!settled) {
        if (outcome.error) finish(reject, new Error(outcome.error));
        else finish(resolve, outcome);
      } else {
        onLateResult?.(outcome);
      }
    });

    child.once("spawn", () => {
      child.unref();
      pendingTimer = setTimeout(() => {
        finish(resolve, { ok: true, pending: true });
      }, pendingAfterMs);
      maxTimer = setTimeout(() => {
        child.removeAllListeners("exit");
        child.stderr?.destroy();
      }, maxTrackMs);
      maxTimer.unref?.();
    });
  });
}
