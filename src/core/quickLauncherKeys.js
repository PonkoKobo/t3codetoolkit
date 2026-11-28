// Pure shortcut parsing and filtering helpers for quick launcher menus (unit-tested).

const MODIFIER_MAP = new Map([
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["cmdorctrl", "mod"],
  ["mod", "mod"],
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
  ["meta", "meta"],
  ["cmd", "meta"],
  ["command", "meta"],
]);

/** Parses a shortcut string such as "Ctrl+G" or "Ctrl+Alt+L", or returns null if invalid. */
export function parseShortcut(text) {
  if (typeof text !== "string") return null;
  const tokens = text.split("+").map((part) => part.trim()).filter(Boolean);
  if (!tokens.length) return null;

  const mods = { ctrl: false, alt: false, shift: false, meta: false, mod: false };
  let key = null;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const mapped = MODIFIER_MAP.get(lower);
    if (mapped) {
      mods[mapped] = true;
    } else if (key === null && token.length === 1 && /^[a-z0-9]$/i.test(token)) {
      key = lower;
    } else {
      return null;
    }
  }
  if (!key) return null;
  return { ...mods, key, label: formatShortcut({ ...mods, key }) };
}

export function formatShortcut({ ctrl, alt, shift, meta, mod, key }) {
  const parts = [];
  if (mod) parts.push("Ctrl");
  if (ctrl) parts.push("Ctrl");
  if (alt) parts.push("Alt");
  if (shift) parts.push("Shift");
  if (meta) parts.push("Meta");
  parts.push(key.toUpperCase());
  return parts.join("+");
}

/** True when a KeyboardEvent matches the parsed shortcut (ignoring repeats, IME, AltGr). */
export function matchesShortcut(event, parsed, isMac = false) {
  if (!parsed || !event) return false;
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (event.getModifierState?.("AltGraph")) return false;
  const wantCtrl = parsed.ctrl || (parsed.mod && !isMac);
  const wantMeta = parsed.meta || (parsed.mod && isMac);
  if (Boolean(event.ctrlKey) !== wantCtrl) return false;
  if (Boolean(event.altKey) !== parsed.alt) return false;
  if (Boolean(event.shiftKey) !== parsed.shift) return false;
  if (Boolean(event.metaKey) !== wantMeta) return false;
  const eventKey = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (eventKey === parsed.key) return true;
  if (/^[a-z]$/.test(parsed.key) && event.code === `Key${parsed.key.toUpperCase()}`) return true;
  if (/^[0-9]$/.test(parsed.key) && event.code === `Digit${parsed.key}`) return true;
  return false;
}

function actionMatches(action, needle) {
  if (!action) return false;
  return (
    action.label?.toLowerCase().includes(needle) ||
    action.category?.toLowerCase().includes(needle) ||
    action.description?.toLowerCase().includes(needle)
  );
}

/**
 * Filters menu items by query and distinguishes group matches from sub-action matches.
 * Returns { item, groupMatches, matchedActions }[] so sub-action matches can expand & select
 * the matching action instead of silently running the group's default command.
 */
export function filterMenuItems(items, query) {
  const list = Array.isArray(items) ? items : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!needle) {
    return list.filter(Boolean).map((item) => ({
      item,
      groupMatches: true,
      matchedActions: item.actions ?? [],
    }));
  }
  const results = [];
  for (const item of list) {
    if (!item) continue;
    const groupMatches = Boolean(
      item.label?.toLowerCase().includes(needle) ||
      item.subtitle?.toLowerCase().includes(needle) ||
      item.defaultAction?.label?.toLowerCase().includes(needle),
    );
    const matchedActions = (item.actions ?? []).filter((action) => actionMatches(action, needle));
    if (groupMatches || matchedActions.length > 0) {
      results.push({ item, groupMatches, matchedActions });
    }
  }
  return results;
}

/** Returns 0-based slot (0..8) for bare keys 1..9 inside an open menu, or -1. */
export function menuDigitSlot(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return -1;
  if (event.repeat || event.isComposing) return -1;
  const key = event.key;
  if (typeof key === "string" && key.length === 1 && key >= "1" && key <= "9") {
    return Number(key) - 1;
  }
  return -1;
}
