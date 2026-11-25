// Pure helpers for the model switcher, kept free of DOM globals so they can be unit-tested.

/**
 * True while Ctrl+Alt (Ctrl+Option on macOS) is held, with or without Shift. AltGr reports as Ctrl+Alt
 * on Windows; it types characters on many layouts, so it never counts.
 */
export function switcherChordHeld(event) {
  if (!event.ctrlKey || !event.altKey || event.metaKey) return false;
  return !(typeof event.getModifierState === "function" && event.getModifierState("AltGraph"));
}

/**
 * Ctrl+Alt (+Shift) + 1..9 → favorite slot 1..9, otherwise null. Matched on the physical key
 * (event.code), so it works on any layout.
 */
export function modelSlotFromKey(event) {
  if (!switcherChordHeld(event) || event.repeat || event.isComposing) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? "");
  return match ? Number(match[1]) : null;
}

/** True for a key event of Ctrl, Alt or Shift alone (the start of holding the chord). */
export const isModifierKey = (event) => ["Control", "Alt", "Shift"].includes(event.key);

/**
 * Favorites numbered the way the arranged picker numbers them: slot = position in `order` + 1.
 * Keys in the order that aren't current favorites keep their number but are left out.
 */
export function favoriteSlots(order, models) {
  const slots = [];
  order.forEach((key, index) => {
    const model = models.get(key);
    if (model) slots.push({ slot: index + 1, key, ...model });
  });
  return slots;
}

/** The slot `step` places from `index` among `count`, wrapping around. */
export const cycle = (index, step, count) => (count ? (((index + step) % count) + count) % count : -1);
