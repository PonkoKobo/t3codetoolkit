// Pure helpers for the project switcher, kept free of DOM globals so they can be unit-tested.

/** True while Ctrl+Shift is held without Alt or Cmd/Meta (Ctrl+Shift on macOS too: Cmd+Shift+3-5 are screenshots). */
export function projectChordHeld(event) {
  return Boolean(event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey);
}

/** Ctrl+Shift + 1..9 → pinned project slot 1..9, otherwise null. Matched on the physical key (event.code). */
export function projectSlotFromKey(event) {
  if (!projectChordHeld(event) || event.repeat || event.isComposing) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? "");
  return match ? Number(match[1]) : null;
}

/** True for a key event of Ctrl or Shift alone (the start of holding the chord). */
export const isChordKey = (event) => event.key === "Control" || event.key === "Shift";

/**
 * Numbers pinned projects in a stable order. T3 Code lists the current project first, so its order
 * moves as you switch; the toolkit keeps its own order instead. Pinned projects already in `saved` keep
 * their place, newly pinned ones go to the end in list order, and ones now unpinned leave the order.
 * Projects missing from `projects` (an environment that isn't connected) keep their place in the
 * order but get no slot.
 *
 * @param {string[]} saved  project keys in the saved order
 * @param {{key: string, name: string, pinned: boolean, current?: boolean}[]} projects  as listed by the app
 * @returns {{order: string[], slots: object[], others: object[]}}
 *   order: the order to save; slots: pinned projects with `slot` 1..n; others: the unpinned ones in list order.
 */
export function projectSlots(saved, projects) {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const unpinned = new Set(projects.filter((p) => !p.pinned).map((p) => p.key));
  const kept = [...new Set(saved)].filter((key) => typeof key === "string" && !unpinned.has(key));
  const added = projects.filter((p) => p.pinned && !kept.includes(p.key)).map((p) => p.key);
  const order = [...kept, ...added];
  const slots = order.filter((key) => byKey.has(key)).map((key, i) => ({ ...byKey.get(key), slot: i + 1 }));
  const others = projects.filter((p) => !p.pinned).map((p) => ({ ...p, slot: null }));
  return { order, slots, others };
}

/**
 * The app's route. The desktop app uses hash history (`…/index.html#/draft/…`); the web client uses
 * the path.
 */
export function appRoute(loc, hashHistory) {
  if (!hashHistory) return loc.pathname || "/";
  const route = (loc.hash ?? "").split("#")[1] ?? "";
  return route.startsWith("/") ? route.split("?")[0] : "/";
}

/** The URL of the app's "/" route (a new thread) in the same history mode. */
export function homeHref(loc, hashHistory) {
  return hashHistory ? `${loc.pathname}${loc.search ?? ""}#/` : "/";
}

/** The entry `step` places from `index` among `count`, wrapping around. */
export const cycle = (index, step, count) => (count ? (((index + step) % count) + count) % count : -1);
