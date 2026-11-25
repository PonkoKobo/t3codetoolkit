import { findComposer } from "./composer.js";
import { currentFiberOf } from "./react.js";

// ChatComposer exposes an imperative handle (upstream's own keybindings call it). It is found by
// shape. The effort and model shortcuts use it to open the model picker unseen, click upstream's own
// rows so upstream's handlers persist the choice, and close it again. One lock covers both features.
const isHandle = (h) =>
  h && typeof h.openControl === "function" && typeof h.isModelPickerOpen === "function" && typeof h.toggleModelPicker === "function";

/** A ref object's value when `value` is one ({ current }), else null. */
const refValue = (value) => (value && typeof value === "object" && "current" in value ? value.current : null);

/** The handle among a fiber's refs: its ref prop, or a useRef hook (the view that owns the composer). */
function handleOn(fiber) {
  for (const ref of [fiber.ref, fiber.memoizedProps?.ref]) if (isHandle(refValue(ref))) return refValue(ref);
  for (let hook = fiber.memoizedState, i = 0; hook && typeof hook === "object" && "next" in hook && i < 400; hook = hook.next, i++) {
    if (isHandle(refValue(hook.memoizedState))) return refValue(hook.memoizedState);
  }
  return null;
}

/** The composer's imperative handle and its editor, or null when no composer is shown. */
export function composerHandle() {
  const composer = findComposer();
  if (!composer) return null;
  let fiber = currentFiberOf(composer.editor);
  for (let depth = 0; fiber && depth < 150; depth++, fiber = fiber.return) {
    const handle = handleOn(fiber);
    if (handle) return { handle, editor: composer.editor };
  }
  return null;
}

export const PICKER = "[data-model-picker-content]";
const SILENT = "t3tkEffortSilent";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(check, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) if (check()) return true;
  return check();
}

/** True for the model picker's own fields (its search box), where the shortcuts have no other use. */
export const inPicker = (target) => target instanceof Element && !!target.closest(PICKER);

let busy = false;
export const pickerBusy = () => busy;

/**
 * Runs `work()` with the model picker open. If it was closed, it is opened with `open(handle)` while
 * kept invisible (styles.js), closed again afterwards, and focus goes back where it was. Returns
 * `work()`'s result, or undefined when another shortcut is already driving the picker.
 */
export async function withPicker(found, open, work) {
  if (busy) return undefined;
  busy = true;
  const focused = document.activeElement;
  const wasOpen = found.handle.isModelPickerOpen();
  try {
    if (!wasOpen) {
      document.documentElement.dataset[SILENT] = "";
      open(found.handle);
    }
    const result = await work();
    if (!wasOpen) {
      await sleep(30); // let React commit; the handle is rebuilt with the new state
      const current = composerHandle();
      if (current?.editor === found.editor && current.handle.isModelPickerOpen()) current.handle.toggleModelPicker();
    }
    if (focused?.isConnected && typeof focused.focus === "function") focused.focus({ preventScroll: true });
    return result;
  } finally {
    // Show popups again only once this picker has gone, or after a short limit if it stays open.
    if (!wasOpen) await waitFor(() => !document.querySelector(PICKER), 400);
    delete document.documentElement.dataset[SILENT];
    busy = false;
  }
}

/** Clears the invisible-picker flag (a feature's stop()). */
export const clearSilent = () => delete document.documentElement.dataset[SILENT];
