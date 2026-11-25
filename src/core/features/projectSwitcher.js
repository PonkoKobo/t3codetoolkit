import { appRoute, cycle, homeHref, isChordKey, projectChordHeld, projectSlotFromKey, projectSlots } from "../projectKeys.js";
import { findPropsUp } from "../react.js";
import { sleep, waitFor } from "../pickerDriver.js";
import { placeFavorite } from "../favoriteOrder.js";
import { toast } from "../styles.js";

// Ctrl+Shift+1-9 opens a new thread in a pinned project; holding Ctrl+Shift shows the projects in a
// strip. A new thread's draft screen has a project picker ("What should we work on?"). The toolkit
// goes to a draft (the "/" route, which reuses the current draft) when none is shown, opens that
// picker unseen to read the projects and which are pinned, and picks one through the picker's own
// onValueChange, so upstream decides how the draft moves to that project.

const HOLD_MS = 400;
const TRIGGER = "[data-draft-project-trigger]";
const ADD_PROJECT = "add-project"; // upstream's "Add project" row
const ORDER_KEY = "t3tk.project-order";
const CACHE_KEY = "t3tk.project-list";
const SILENT = "t3tkProjectSilent";

const comboboxOf = (trigger) =>
  findPropsUp(trigger, (p) => typeof p.onValueChange === "function" && typeof p.onOpenChange === "function" && Array.isArray(p.items), 40);

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not saved; the numbering still works for this session.
  }
}

/** The order to number pinned projects by, and the projects last read (shown before a fresh read). */
const savedOrder = () => {
  const value = readJson(ORDER_KEY, []);
  return Array.isArray(value) ? value.filter((k) => typeof k === "string") : [];
};
const cachedProjects = () => {
  const value = readJson(CACHE_KEY, null);
  return Array.isArray(value) ? value.filter((p) => p && typeof p.key === "string" && typeof p.name === "string") : null;
};

/** Pinned projects numbered in the saved order (shared with the sidebar order); saves the order if it changed. */
export function numbered(projects) {
  const saved = savedOrder();
  const result = projectSlots(saved, projects);
  if (JSON.stringify(result.order) !== JSON.stringify(saved)) writeJson(ORDER_KEY, result.order);
  return result;
}

/** A picker row's project: { key, name, pinned }, or null for "Add project" and unknown rows. */
function readRow(option) {
  const item = findPropsUp(option, (p) => p.value && typeof p.value.value === "string" && typeof p.value.label === "string", 6)?.value;
  if (!item || item.value === ADD_PROJECT) return null;
  // The pin toggle inside the row carries { pinned, onToggle }; rows that can't be pinned have none.
  let pinned = false;
  for (const el of option.querySelectorAll("button, [role='button'], svg")) {
    const props = findPropsUp(el, (p) => typeof p.pinned === "boolean" && typeof p.onToggle === "function", 6);
    if (props) {
      pinned = props.pinned;
      break;
    }
  }
  return { key: item.value, name: item.label, pinned };
}

let busy = false;

// The desktop app routes with the URL hash, the web client with the path.
const hashHistory = () => window.desktopBridge !== undefined;
const route = () => appRoute(location, hashHistory());

/** Shows a draft with the project picker, going to "/" if needed. Returns the trigger or null. */
async function ensureDraft() {
  const trigger = document.querySelector(TRIGGER);
  if (trigger) return trigger;
  if (!route().startsWith("/draft/")) {
    // "/" opens the current new-thread draft (or a fresh one) through the app's own router.
    history.pushState(history.state, "", homeHref(location, hashHistory()));
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }
  await waitFor(() => document.querySelector(TRIGGER), 2500);
  return document.querySelector(TRIGGER);
}

/**
 * Opens the draft's project picker unseen and lists its projects with their pin state.
 * Returns { projects, combobox } or null.
 */
async function readProjects(trigger) {
  const focused = document.activeElement;
  let combobox = comboboxOf(trigger);
  if (!combobox) return null;
  const wasOpen = combobox.open === true;
  if (!wasOpen) {
    document.documentElement.dataset[SILENT] = "";
    combobox.onOpenChange(true);
  }
  try {
    await waitFor(() => document.querySelector('[data-slot="combobox-popup"] [role="option"]'), 800);
    const projects = [];
    for (const option of document.querySelectorAll('[data-slot="combobox-popup"] [role="option"]')) {
      const row = readRow(option);
      if (row) projects.push({ ...row, current: option.getAttribute("aria-selected") === "true" });
    }
    if (!projects.length) {
      // Fall back to the picker's items without pin state (no row rendered yet).
      combobox = comboboxOf(trigger) ?? combobox;
      for (const item of combobox.items) {
        if (item?.value !== ADD_PROJECT) projects.push({ key: item.value, name: item.label, pinned: false, current: combobox.value?.value === item.value });
      }
    }
    writeJson(CACHE_KEY, projects.map(({ key, name, pinned }) => ({ key, name, pinned })));
    return { projects, combobox: comboboxOf(trigger) ?? combobox };
  } finally {
    if (!wasOpen) {
      comboboxOf(trigger)?.onOpenChange(false);
      await waitFor(() => !document.querySelector('[data-slot="combobox-popup"]'), 400);
      delete document.documentElement.dataset[SILENT];
    }
    if (focused?.isConnected && typeof focused.focus === "function") focused.focus({ preventScroll: true });
  }
}

function focusComposer() {
  const editor = document.querySelector('[contenteditable="true"][role="textbox"], [contenteditable="true"]');
  editor?.focus({ preventScroll: true });
}

/** Opens a new thread in pinned project `slot`, or in the project with `key`. Toasts the result. */
async function openProject({ slot, key }) {
  // A pick made while the strip is still reading the list waits for that read instead of being lost.
  if (busy) await waitFor(() => !busy, 2500);
  if (busy) return;
  busy = true;
  try {
    const trigger = await ensureDraft();
    if (!trigger) {
      toast(route().startsWith("/draft/") ? "Clear this draft's message or start a new thread first" : "Couldn't open a new thread here", 2200);
      return;
    }
    const read = await readProjects(trigger);
    if (!read) return toast("Couldn't read the project list", 2000);
    const { slots, others } = numbered(read.projects);
    const entry = key ? [...slots, ...others].find((p) => p.key === key) : slots.find((p) => p.slot === slot);
    if (!entry) {
      toast(key ? "That project isn't in the list any more" : slots.length ? `No pinned project ${slot}` : "No pinned projects yet. Pin one with 📌 in the project picker.", 2400);
      return;
    }
    const item = read.combobox.items.find((i) => i?.value === entry.key);
    if (item && !entry.current) read.combobox.onValueChange(item);
    await sleep(60);
    focusComposer();
    toast(`New thread in ${entry.name}`, 1600);
  } finally {
    busy = false;
  }
}

// --- Strip shown while the chord is held ---------------------------------------------------------

let holdTimer = 0;
let strip = null; // { panel, entries, index, moved, pending, token, released }
let token = 0;

function stripEntries(projects) {
  const { slots, others } = numbered(projects);
  return [...slots, ...others];
}

function renderStrip() {
  if (!strip) return;
  const { panel, entries, index } = strip;
  const list = panel.querySelector(".t3tk-carousel-list");
  if (!entries) {
    list.replaceChildren(Object.assign(document.createElement("span"), { className: "t3tk-hint", textContent: "Loading projects…" }));
    return;
  }
  if (!entries.length) {
    list.replaceChildren(Object.assign(document.createElement("span"), { className: "t3tk-hint", textContent: "No projects yet." }));
    return;
  }
  list.replaceChildren(
    ...entries.map((entry, i) => {
      const item = document.createElement("div");
      item.className = "t3tk-carousel-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === index));
      item.toggleAttribute("data-current", Boolean(entry.current));
      const keyLabel = document.createElement("kbd");
      keyLabel.textContent = entry.slot && entry.slot <= 9 ? String(entry.slot) : "";
      const name = document.createElement("span");
      name.textContent = entry.name;
      const note = document.createElement("small");
      note.textContent = [entry.pinned ? "pinned" : "", entry.current ? "current" : ""].filter(Boolean).join(" · ") || " ";
      item.append(keyLabel, name, note);
      item.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        commit(entry.key);
      });
      return item;
    }),
  );
  list.children[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function openStrip() {
  closeStrip();
  const panel = document.createElement("div");
  panel.className = "t3tk-carousel";
  panel.dataset.t3tkCarousel = "projects";
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", "Projects");
  const list = document.createElement("div");
  list.className = "t3tk-carousel-list";
  const hint = document.createElement("div");
  hint.className = "t3tk-hint";
  hint.textContent = "1–9 pinned project · ←/→ or scroll, then release for a new thread there · Esc to cancel";
  panel.append(list, hint);
  document.body.append(panel);
  const mine = ++token;
  const trigger = document.querySelector(TRIGGER);
  // The last list read shows at once; on a draft the picker's value says which project is current.
  const currentKey = trigger ? comboboxOf(trigger)?.value?.value : undefined;
  const cached = cachedProjects()?.map((p) => ({ ...p, current: p.key === currentKey }));
  const entries = cached ? stripEntries(cached) : null;
  strip = { panel, entries, index: Math.max(0, entries?.findIndex((e) => e.current) ?? 0), moved: false, pending: 0, token: mine };
  renderStrip();
  // A fresh read needs a draft's picker; elsewhere the cached list is all there is, and a pick reads again.
  if (!trigger || busy) {
    if (!strip.entries) strip.entries = [];
    renderStrip();
    applyPending();
    return;
  }
  busy = true;
  let read = null;
  try {
    read = await readProjects(trigger);
  } finally {
    busy = false;
  }
  if (strip?.token !== mine) return;
  if (read) {
    strip.entries = stripEntries(read.projects);
    if (!strip.moved) strip.index = Math.max(0, strip.entries.findIndex((e) => e.current));
  } else if (!strip.entries) strip.entries = [];
  renderStrip();
  applyPending();
  // The keys were let go while the list loaded, after moving: pick what was moved to.
  if (strip.released) {
    if (strip.moved && strip.entries[strip.index]) commit(strip.entries[strip.index].key);
    else closeStrip();
  }
}

function applyPending() {
  if (strip?.pending) {
    const offset = strip.pending;
    strip.pending = 0;
    step(offset);
  }
}

function closeStrip() {
  clearTimeout(holdTimer);
  holdTimer = 0;
  strip?.panel.remove();
  strip = null;
}

function commit(key) {
  closeStrip();
  if (key) void openProject({ key });
}

function step(offset) {
  if (strip && !strip.entries) {
    strip.pending += offset;
    return;
  }
  if (!strip?.entries?.length) return;
  strip.index = cycle(strip.index, offset, strip.entries.length);
  strip.moved = true;
  renderStrip();
}

// --- Numbers and drag order in the project picker ------------------------------------------------
// While the new-thread project picker is open, pinned rows show their Ctrl+Shift number and a grip.
// Dragging a grip changes that number order. Rows are only re-ordered visually (CSS `order`), since
// the list's DOM belongs to the app; arrow keys in the picker still follow the app's own order.

const PICKER_LIST = "data-t3tk-project-list";
const SLOT_CLASS = "t3tk-project-slot";
let pickerSignature = "";
let dragging = false;
let lastSlots = new Map(); // numbers from the last unfiltered list, kept while searching

function projectPicker() {
  if (document.documentElement.dataset[SILENT] !== undefined) return null;
  for (const popup of document.querySelectorAll('[data-slot="combobox-popup"]')) {
    const search = popup.querySelector('input[aria-label="Search projects"]');
    const list = popup.querySelector('[data-slot="combobox-list"]');
    if (search && list) return { search, list };
  }
  return null;
}

function clearPicker() {
  for (const el of document.querySelectorAll(`.${SLOT_CLASS}`)) el.remove();
  for (const el of document.querySelectorAll(`[${PICKER_LIST}]`)) el.removeAttribute(PICKER_LIST);
  for (const el of document.querySelectorAll("[data-t3tk-slot]")) {
    el.style.order = "";
    el.style.transform = "";
    el.removeAttribute("data-t3tk-slot");
    el.removeAttribute("data-t3tk-dragging");
  }
}

function decoratePicker() {
  if (dragging) return;
  const picker = projectPicker();
  if (!picker) {
    if (pickerSignature) clearPicker();
    pickerSignature = "";
    return;
  }
  const { list, search } = picker;
  const rows = [];
  for (const option of list.querySelectorAll('[role="option"]')) {
    const row = readRow(option);
    if (row) rows.push({ ...row, option });
  }
  const filtering = search.value.trim().length > 0;
  // Numbering needs the whole list. While searching, keep the saved numbers without changing the order.
  let slotByKey;
  if (filtering) {
    slotByKey = new Map(rows.filter((r) => r.pinned && lastSlots.has(r.key)).map((r) => [r.key, lastSlots.get(r.key)]));
  } else {
    slotByKey = new Map(numbered(rows).slots.map((s) => [s.key, s.slot]));
    lastSlots = slotByKey;
  }
  const signature = JSON.stringify([filtering, rows.map((r) => [r.key, slotByKey.get(r.key) ?? 0])]);
  const intact = rows.every((r) => !slotByKey.has(r.key) || r.option.querySelector(`:scope > .${SLOT_CLASS}`));
  if (signature === pickerSignature && intact && list.hasAttribute(PICKER_LIST) === !filtering) return;
  pickerSignature = signature;

  list.toggleAttribute(PICKER_LIST, !filtering);
  for (const { key, name, option } of rows) {
    const slot = slotByKey.get(key);
    option.querySelector(`:scope > .${SLOT_CLASS}`)?.remove();
    if (!slot) {
      option.style.order = "";
      option.removeAttribute("data-t3tk-slot");
      continue;
    }
    option.dataset.t3tkSlot = String(slot);
    option.style.order = filtering ? "" : String(slot - 10000);
    const badge = document.createElement("span");
    badge.className = SLOT_CLASS;
    badge.title = slot <= 9 ? `Ctrl+Shift+${slot}${filtering ? "" : " · drag to reorder"}` : filtering ? "" : "Drag to reorder";
    const grip = document.createElement("span");
    grip.className = "t3tk-project-grip";
    grip.textContent = "⠿";
    grip.setAttribute("aria-hidden", "true");
    const number = document.createElement("kbd");
    number.textContent = slot <= 9 ? String(slot) : "·";
    badge.append(grip, number);
    // Keep the row's own select behaviour away from the handle.
    for (const type of ["mousedown", "mouseup", "click", "pointerup"]) {
      badge.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }
    badge.addEventListener("pointerdown", (e) => {
      if (filtering) {
        e.preventDefault();
        e.stopPropagation();
      } else startProjectDrag(e, option, key, name);
    });
    option.prepend(badge);
  }
}

// Drag by the badge. Rows only slide (CSS transforms) while dragging; the order is saved once, on drop.
function startProjectDrag(event, row, key, name) {
  event.preventDefault();
  event.stopPropagation();
  if (event.button !== 0) return;
  const list = row.parentElement;
  // Pinned rows in their shown (slot) order.
  const rows = [...list.querySelectorAll(":scope > [data-t3tk-slot]")].sort((a, b) => Number(a.dataset.t3tkSlot) - Number(b.dataset.t3tkSlot));
  const from = rows.indexOf(row);
  if (from < 0 || rows.length < 2) return;
  const keys = rows.map((r) => readRow(r)?.key);
  if (keys.some((k) => !k)) return;
  const boxes = rows.map((item) => item.getBoundingClientRect());
  const startY = event.clientY;
  let target = from;
  dragging = true;
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Window listeners below still follow the pointer.
  }
  row.setAttribute("data-t3tk-dragging", "");
  const move = (e) => {
    if (e.pointerId !== event.pointerId) return;
    e.preventDefault();
    const dy = Math.max(boxes[0].top - boxes[from].top, Math.min(boxes[rows.length - 1].top - boxes[from].top, e.clientY - startY));
    row.style.transform = `translateY(${dy}px)`;
    const centre = boxes[from].top + boxes[from].height / 2 + dy;
    target = rows.filter((other, index) => index !== from && boxes[index].top + boxes[index].height / 2 < centre).length;
    rows.forEach((other, index) => {
      if (other === row) return;
      const shift = index > from && index <= target ? boxes[index - 1].top - boxes[index].top
        : index < from && index >= target ? boxes[index + 1].top - boxes[index].top : 0;
      other.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };
  const end = (e) => {
    if (e.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    row.removeAttribute("data-t3tk-dragging");
    for (const item of rows) item.style.transform = "";
    dragging = false;
    if (e.type === "pointerup" && target !== from) {
      const order = savedOrder();
      const next = placeFavorite(order, new Set(keys), key, target);
      if (next !== order) {
        writeJson(ORDER_KEY, next);
        const slot = next.filter((k) => keys.includes(k)).indexOf(key) + 1;
        toast(slot <= 9 ? `${name} is now ${slot} (Ctrl+Shift+${slot})` : `${name} moved`, 1600);
      }
    }
    pickerSignature = "";
    decoratePicker();
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
}

// --- Keys ----------------------------------------------------------------------------------------

/** Places the shortcut stays out of: the toolkit's overlays, the terminal, and the Usage page (its own Ctrl+Shift+1-4). */
function blocked(event) {
  if (document.querySelector(".t3tk-overlay")) return true;
  if (route().startsWith("/usage")) return true;
  const target = event.target;
  return target instanceof Element && !!target.closest(".xterm, [data-terminal]");
}

/** True when focus is in a text field that has text: there Ctrl+Shift+arrows select by word. */
function editingText() {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.length > 0;
  return el.isContentEditable && (el.textContent ?? "").trim().length > 0;
}

function onKeyDown(event) {
  if (strip) {
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? "");
    const arrow = event.key.startsWith("Arrow");
    // In a field with text, Ctrl+Shift+arrows keep selecting words; the wheel and digits still work.
    const handled = event.key === "Escape" || digit || event.key === "Tab" || event.key === "Enter" || (arrow && !editingText());
    if (!handled) {
      // Any other key is someone else's Ctrl+Shift shortcut: get out of its way.
      if (!isChordKey(event)) closeStrip();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat && !event.key.startsWith("Arrow")) return;
    if (event.key === "Escape") closeStrip();
    else if (digit) {
      const entry = strip.entries?.find((e) => e.slot === Number(digit[1]));
      if (entry) commit(entry.key);
      else {
        closeStrip();
        void openProject({ slot: Number(digit[1]) });
      }
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "Tab") step(1); // Shift is part of the chord
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") step(-1);
    else if (event.key === "Enter") commit(strip.entries?.[strip.index]?.key);
    return;
  }

  const slot = projectSlotFromKey(event);
  if (slot !== null) {
    clearTimeout(holdTimer);
    holdTimer = 0;
    if (blocked(event)) return;
    event.preventDefault();
    event.stopPropagation();
    void openProject({ slot });
    return;
  }

  if (isChordKey(event) && projectChordHeld(event) && !event.repeat) {
    clearTimeout(holdTimer);
    if (blocked(event)) return;
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      if (!busy) void openStrip();
    }, HOLD_MS);
  } else if (!isChordKey(event)) {
    // Ctrl+Shift+<other key> is another shortcut; don't pop the strip over it.
    clearTimeout(holdTimer);
    holdTimer = 0;
  }
}

function onKeyUp(event) {
  if (projectChordHeld(event)) return;
  clearTimeout(holdTimer);
  holdTimer = 0;
  if (!strip) return;
  if (!strip.entries) {
    // Still loading: if the wheel moved, finish the pick once the list is in (see openStrip).
    if (strip.pending) strip.released = true;
    else closeStrip();
    return;
  }
  // Releasing commits only a choice made with the arrows or wheel; just peeking changes nothing.
  if (strip.moved && strip.entries?.[strip.index]) commit(strip.entries[strip.index].key);
  else closeStrip();
}

// Ctrl+Shift+wheel moves through the projects instead of zooming or scrolling sideways.
const WHEEL_STEP = 40;
let wheelSum = 0;

function onWheel(event) {
  if (!projectChordHeld(event)) return;
  if (!strip) {
    if (blocked(event) || busy) return;
    clearTimeout(holdTimer);
    holdTimer = 0;
    wheelSum = 0;
    void openStrip();
  }
  event.preventDefault();
  event.stopPropagation();
  // Shift turns a vertical wheel into deltaX in some browsers, so take whichever is set.
  const raw = event.deltaY || event.deltaX;
  const delta = event.deltaMode === 0 ? raw : raw * WHEEL_STEP;
  if (Math.sign(delta) !== Math.sign(wheelSum)) wheelSum = 0;
  wheelSum += delta;
  if (Math.abs(wheelSum) >= WHEEL_STEP) {
    step(Math.sign(wheelSum));
    wheelSum = 0;
  }
}

const cancel = () => closeStrip();
const onVisibility = () => document.hidden && closeStrip();

let listening = false;

export const projectSwitcher = {
  id: "project-switcher",
  title: "Ctrl+Shift + 1-9 opens a new thread in a pinned project (hold to see them)",
  surfaces: ["web", "desktop"],
  sync() {
    if (!listening) {
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", onKeyUp, true);
      window.addEventListener("wheel", onWheel, { capture: true, passive: false });
      window.addEventListener("blur", cancel);
      document.addEventListener("visibilitychange", onVisibility);
      listening = true;
    }
    decoratePicker();
    return document.querySelector(TRIGGER) || cachedProjects() ? "ok" : "idle";
  },
  stop() {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("wheel", onWheel, { capture: true });
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", onVisibility);
    listening = false;
    closeStrip();
    clearPicker();
    pickerSignature = "";
    dragging = false;
    delete document.documentElement.dataset[SILENT];
  },
};
