// Pure helpers for the effort shortcuts, kept free of DOM globals so they can be unit-tested.

export const MAX_EFFORT_KEY = 6;

export function effortChordHeld(event) {
  return Boolean(event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    !event.getModifierState?.("AltGraph"));
}

/**
 * Alt (Option on macOS) + 1..6 → 1..6, otherwise null. Matched on the physical key (event.code), so
 * it works on any keyboard layout and with Option's special characters on macOS. Shift+digit is not
 * used because it types punctuation, and Ctrl/Cmd+digit already switch threads in T3 Code.
 */
export function effortLevelFromKey(event) {
  if (!effortChordHeld(event)) return null;
  if (event.repeat || event.isComposing) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? "");
  if (!match) return null;
  const level = Number(match[1]);
  return level <= MAX_EFFORT_KEY ? level : null;
}

/** Move one enabled row in effort order, stopping at either end. */
export function stepEffortIndex(entries, index, direction) {
  const start = index < 0 && direction < 0 ? entries.length : index;
  for (let next = start + direction; next >= 0 && next < entries.length; next += direction) {
    if (!entries[next].disabled) return next;
  }
  return index;
}

/** True when the key went to some other text field (a terminal, a search box), not the composer. */
export function isOtherTextField(target, composerEditor) {
  if (!target || target === composerEditor) return false;
  if (composerEditor && typeof composerEditor.contains === "function" && composerEditor.contains(target)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

/** The row for effort level `level` (1-based) among the picker's rows, or why there isn't one. */
export function pickEffortRow(rows, level) {
  if (rows.length === 0) return { reason: "This model has no effort levels" };
  if (level > rows.length) return { reason: `This model has ${rows.length} effort level${rows.length === 1 ? "" : "s"}` };
  const row = rows[level - 1];
  if (row.disabled) return { reason: "Effort is set in the message (ultrathink)" };
  return { row, label: effortRowLabel(row) || String(level) };
}

/** A row's level name: its first text span (a "default" badge may follow), else data-effort-level. */
export function effortRowLabel(row) {
  const text = row.querySelector?.("span")?.textContent?.trim() || row.textContent?.trim();
  if (text) return text;
  const attr = row.dataset?.effortLevel;
  return attr && attr !== "true" ? attr : "";
}
