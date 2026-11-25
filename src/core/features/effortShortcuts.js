import { MAX_EFFORT_KEY, effortChordHeld, effortLevelFromKey, effortRowLabel, isOtherTextField, pickEffortRow, stepEffortIndex } from "../effortKeys.js";
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

function withEffortRows(found, useRows) {
  return withPicker(found, (handle) => handle.openControl("composer.effort"), async () => {
    // A model without effort levels shows a "No effort levels" row instead, so don't wait long.
    await waitFor(() => effortRows().length > 0, 600);
    if (!found.editor.isConnected) return null;
    return useRows(effortRows());
  });
}

async function setEffort(level, found, expectedLabel) {
  const pick = await withEffortRows(found, (rows) => {
    const pick = pickEffortRow(rows, level);
    if (pick.row && expectedLabel !== undefined && pick.label !== expectedLabel) return null;
    pick.row?.click();
    return pick;
  });
  if (pick) toast(pick.row ? `Effort: ${pick.label}` : pick.reason, 1800);
}

const HOLD_MS = 350;
const WHEEL_STEP = 40;
let holdTimer = 0;
let carousel = null;

function closeCarousel() {
  clearTimeout(holdTimer);
  holdTimer = 0;
  carousel?.panel.remove();
  carousel = null;
}

function chooseLevel(level, expectedLabel) {
  const state = carousel;
  if (!state.entries) {
    state.digit = level;
    return;
  }
  closeCarousel();
  const found = composerHandle();
  if (location.href === state.url && found?.editor === state.editor) {
    void setEffort(level, found, expectedLabel);
  }
}

function finishCarousel() {
  const { entries, index, current } = carousel;
  if (entries?.[index] && index !== current) chooseLevel(index + 1, entries[index].label);
  else closeCarousel();
}

function highlightLevel(state) {
  [...state.list.children].forEach((item, index) => {
    item.setAttribute("aria-selected", String(index === state.index));
  });
  state.list.children[state.index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function step(state, direction) {
  if (!state.entries) {
    state.pending.push(direction);
    return;
  }
  state.index = stepEffortIndex(state.entries, state.index, direction);
  highlightLevel(state);
}

async function openCarousel(found) {
  const panel = document.createElement("div");
  panel.className = "t3tk-carousel";
  panel.dataset.t3tkEffortCarousel = "";
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", "Reasoning effort");
  const list = document.createElement("div");
  list.className = "t3tk-carousel-list";
  const hint = document.createElement("div");
  hint.className = "t3tk-hint";
  hint.textContent = "Loading effort levels…";
  panel.append(list, hint);
  document.body.append(panel);
  const state = { panel, list, editor: found.editor, url: location.href, entries: null, pending: [], wheelSum: 0 };
  carousel = state;

  const entries = await withEffortRows(found, (rows) => rows.map((row, index) => ({
    label: effortRowLabel(row) || String(index + 1),
    disabled: row.disabled,
    current: row.getAttribute("aria-checked") === "true",
  }))).catch(() => null);
  if (carousel !== state) return;
  if (!entries || !state.editor.isConnected || location.href !== state.url) {
    closeCarousel();
    return;
  }
  state.entries = entries;
  if (state.digit) {
    chooseLevel(state.digit);
    return;
  }
  state.current = entries.findIndex((entry) => entry.current);
  state.index = state.pending.reduce((index, direction) => stepEffortIndex(entries, index, direction), state.current);
  if (state.released) {
    if (!entries.length) toast("This model has no effort levels", 1800);
    finishCarousel();
    return;
  }
  hint.textContent = !entries.length ? "This model has no effort levels"
    : entries.every((entry) => entry.disabled) ? "Effort is set in the message (ultrathink)"
      : "1–6 to pick · ←/→ or scroll, then release to apply · Esc to cancel";
  entries.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "t3tk-carousel-item";
    item.setAttribute("role", "option");
    item.setAttribute("aria-disabled", String(entry.disabled));
    item.toggleAttribute("data-current", entry.current);
    item.toggleAttribute("data-disabled", entry.disabled);
    const digit = document.createElement("kbd");
    digit.textContent = index < MAX_EFFORT_KEY && !entry.disabled ? String(index + 1) : "";
    const label = document.createElement("span");
    label.textContent = entry.label;
    item.append(digit, label);
    if (entry.current) item.append(Object.assign(document.createElement("small"), { textContent: "Current" }));
    item.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || entry.disabled) return;
      event.preventDefault();
      chooseLevel(index + 1, entry.label);
    });
    list.append(item);
  });
  highlightLevel(state);
}

function targetComposer(event) {
  if (document.querySelector(".t3tk-overlay") ||
    (event.target instanceof Element && event.target.closest(".xterm, [data-terminal], [data-keybinding-capture]"))) return null;
  const found = composerHandle();
  return found && (!isOtherTextField(event.target, found.editor) || inPicker(event.target)) ? found : null;
}

function onKeyDown(event) {
  const level = effortLevelFromKey(event);
  if (carousel && effortChordHeld(event)) {
    if (event.key === "Alt") return;
    if (event.key === "Escape" || level !== null || ["ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") closeCarousel();
      else if (level !== null) chooseLevel(level);
      else if (event.key === "Enter") {
        if (carousel.entries) finishCarousel();
        else carousel.released = true;
      } else step(carousel, event.key === "ArrowRight" ? 1 : -1);
      return;
    }
  }
  if (event.key === "Alt" && event.repeat) return;
  closeCarousel();
  const found = level !== null || (event.key === "Alt" && effortChordHeld(event)) ? targetComposer(event) : null;
  if (!found) return;
  if (level === null) {
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      const current = targetComposer({ target: document.activeElement });
      if (current?.editor === found.editor && !pickerBusy()) void openCarousel(current);
    }, HOLD_MS);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (!pickerBusy()) void setEffort(level, found);
}

function onKeyUp(event) {
  if (event.key !== "Alt" || event.altKey) return;
  clearTimeout(holdTimer);
  holdTimer = 0;
  if (!carousel) return;
  event.preventDefault();
  event.stopPropagation();
  if (!carousel.entries && (carousel.pending.length || carousel.digit)) carousel.released = true;
  else finishCarousel();
}

function onWheel(event) {
  if (!effortChordHeld(event) || !event.deltaY) return;
  if (!carousel) {
    const found = targetComposer(event);
    if (!found || pickerBusy()) return;
    closeCarousel();
    void openCarousel(found);
  }
  event.preventDefault();
  event.stopPropagation();
  const delta = event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * WHEEL_STEP;
  if (Math.sign(delta) !== Math.sign(carousel.wheelSum)) carousel.wheelSum = 0;
  carousel.wheelSum += delta;
  if (Math.abs(carousel.wheelSum) >= WHEEL_STEP) {
    step(carousel, -Math.sign(carousel.wheelSum));
    carousel.wheelSum = 0;
  }
}

function onPointerDown(event) {
  if (!carousel?.panel.contains(event.target)) closeCarousel();
}

const onVisibility = () => document.hidden && closeCarousel();
let listening = false;

export const effortShortcuts = {
  id: "effort-shortcuts",
  title: "Alt/Option + 1–6 picks effort (hold or scroll to see levels)",
  surfaces: ["web", "desktop"],
  sync() {
    if (!listening) {
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", onKeyUp, true);
      window.addEventListener("wheel", onWheel, { capture: true, passive: false });
      window.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("blur", closeCarousel);
      document.addEventListener("visibilitychange", onVisibility);
      listening = true;
    }
    const found = composerHandle();
    if (carousel && (carousel.editor !== found?.editor || carousel.url !== location.href)) closeCarousel();
    if (found) syncKeyHints(effortRows());
    return found ? "ok" : "idle";
  },
  stop() {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("wheel", onWheel, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("blur", closeCarousel);
    document.removeEventListener("visibilitychange", onVisibility);
    listening = false;
    closeCarousel();
    clearSilent();
    for (const hint of document.querySelectorAll("[data-t3tk-effort-key]")) {
      hint.parentElement?.removeAttribute("aria-keyshortcuts");
      hint.remove();
    }
  },
};
