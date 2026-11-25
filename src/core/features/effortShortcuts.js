import { MAX_EFFORT_KEY, effortLevelFromKey, isOtherTextField, pickEffortRow } from "../effortKeys.js";
import { clearSilent, composerHandle, inPicker, pickerBusy, waitFor, withPicker } from "../pickerDriver.js";
import { toast } from "../styles.js";

// openControl("composer.effort") opens the model picker on its effort column, exactly as upstream's
// Mod+Shift+E does, and the level is then picked by clicking its row, so upstream's own handler
// persists the choice.

/** Rows of the effort control: the first radio group of effort rows in the open picker. */
function effortRows() {
  for (const group of document.querySelectorAll("[role='radiogroup']")) {
    // Stable releases mark the rows with a bare data-effort-level; newer ones put the label in it.
    const rows = group.querySelectorAll("[data-effort-row][data-effort-level]");
    if (rows.length) return [...rows];
  }
  return [];
}

function syncKeyHints(rows) {
  const modifier = /Mac/i.test(navigator.platform) ? "⌥" : "Alt+";
  rows.forEach((row, index) => {
    const key = index + 1;
    let hint = row.querySelector("[data-t3tk-effort-key]");
    if (key > MAX_EFFORT_KEY || row.disabled) {
      if (hint) {
        hint.remove();
        row.removeAttribute("aria-keyshortcuts");
      }
      return;
    }
    if (!hint) {
      hint = document.createElement("kbd");
      hint.className = "t3tk-effort-key";
      hint.dataset.t3tkEffortKey = "";
      hint.setAttribute("aria-hidden", "true");
      row.append(hint);
    }
    const label = `${modifier}${key}`;
    if (hint.textContent !== label) {
      hint.textContent = label;
      row.setAttribute("aria-keyshortcuts", `Alt+${key}`);
    }
  });
}

async function setEffort(level, found) {
  const pick = await withPicker(found, (handle) => handle.openControl("composer.effort"), async () => {
    // A model without effort levels shows a "No effort levels" row instead, so don't wait long.
    await waitFor(() => effortRows().length > 0, 600);
    if (!found.editor.isConnected) return null;
    const pick = pickEffortRow(effortRows(), level);
    pick.row?.click();
    return pick;
  });
  if (pick) toast(pick.row ? `Effort: ${pick.label}` : pick.reason, 1800);
}

function onKeyDown(event) {
  const level = effortLevelFromKey(event);
  if (level === null || document.querySelector(".t3tk-overlay")) return;
  const found = composerHandle();
  if (!found || (isOtherTextField(event.target, found.editor) && !inPicker(event.target))) return;
  // Taken only when a composer is there to act on; otherwise the key goes on as usual.
  event.preventDefault();
  event.stopPropagation();
  if (!pickerBusy()) void setEffort(level, found);
}

let listening = false;

export const effortShortcuts = {
  id: "effort-shortcuts",
  title: "Alt/Option + 1-6 picks the effort level",
  surfaces: ["web", "desktop"],
  sync() {
    if (!listening) {
      window.addEventListener("keydown", onKeyDown, true);
      listening = true;
    }
    const found = composerHandle();
    if (found) syncKeyHints(effortRows());
    return found ? "ok" : "idle";
  },
  stop() {
    window.removeEventListener("keydown", onKeyDown, true);
    listening = false;
    clearSilent();
    for (const hint of document.querySelectorAll("[data-t3tk-effort-key]")) {
      hint.parentElement?.removeAttribute("aria-keyshortcuts");
      hint.remove();
    }
  },
};
