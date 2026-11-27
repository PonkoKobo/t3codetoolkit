import { isOtherTextField } from "../effortKeys.js";
import { decodeModelKey, effectiveOrder } from "../favoriteOrder.js";
import { cycle, favoriteSlots, isModifierKey, modelSlotFromKey, switcherChordHeld } from "../modelKeys.js";
import { PICKER, clearSilent, composerHandle, inPicker, pickerBusy, waitFor, withPicker } from "../pickerDriver.js";
import { toast } from "../styles.js";
import { pickerContext, readOrder } from "./arrangeFavorites.js";

// Ctrl+Alt+1-9 switches to a favorite model; holding Ctrl+Alt shows them all. Both open the model
// picker unseen on its Favorites tab, read the same list Arrange Favorites numbers, and select through
// the native combobox's own callback, so upstream's provider guard and persistence apply.

const HOLD_MS = 350;
const FAVORITES_TAB = '[data-model-picker-provider="favorites"] button';

/** The open picker's favorites, on the Favorites tab. Clicks the tab first if another one shows. */
async function favoritesContext() {
  await waitFor(() => document.querySelector(PICKER), 600);
  const tab = document.querySelector(`${PICKER} ${FAVORITES_TAB}`);
  if (!tab) return null;
  if (tab.getAttribute("aria-pressed") !== "true") tab.click();
  await waitFor(() => pickerContext(), 600);
  return pickerContext();
}

/** Favorites in the order the user sees: the arranged order, or the native one if that's switched off. */
function slotsOf(context) {
  const arranged = window.__t3tk?.enabled?.().includes("arrange-favorites") !== false;
  const order = effectiveOrder(arranged ? readOrder(context.storageKey) : [], context.models.keys());
  return favoriteSlots(order, context.models);
}

const openPicker = (handle) => handle.toggleModelPicker();

async function readFavorites(found) {
  return withPicker(found, openPicker, async () => {
    const context = await favoritesContext();
    if (!context) return null;
    // Provider tabs are all mounted, even when the model rows are virtualized.
    const icons = new Map();
    for (const tab of context.picker.querySelectorAll("[data-model-picker-provider]")) {
      const icon = tab.querySelector("button")?.firstElementChild;
      if (icon) icons.set(tab.dataset.modelPickerProvider, icon);
    }
    return slotsOf(context).map((entry) => ({
      ...entry,
      icon: icons.get(decodeModelKey(entry.key)?.instanceId)?.cloneNode(true),
    }));
  });
}

/** Selects favorite `slot` (or the one with `key`). Toasts the result. */
async function chooseFavorite(found, { slot, key }, event) {
  const outcome = await withPicker(found, openPicker, async () => {
    const context = await favoritesContext();
    if (!context) return { message: "No favorite models to switch to" };
    const slots = slotsOf(context);
    const entry = slots.find((s) => (key ? s.key === key : s.slot === slot));
    if (!entry) return { message: `No favorite model ${slot}` };
    if (entry.disabled) return { message: `${entry.name} isn't available right now` };
    if (!entry.selected) context.combobox.onValueChange(entry.key, { event });
    return { message: `Model: ${entry.name} (${entry.provider})` };
  });
  if (outcome) toast(outcome.message, 1800);
}

// --- Carousel shown while the chord is held ---------------------------------------------------

let holdTimer = 0;
let carousel = null; // { panel, found, slots, index, moved, pending, token }
let token = 0;

function renderCarousel() {
  if (!carousel) return;
  const { panel, slots, index } = carousel;
  const list = panel.querySelector(".t3tk-carousel-list");
  if (!slots) {
    list.replaceChildren(Object.assign(document.createElement("span"), { className: "t3tk-hint", textContent: "Loading favorites…" }));
    return;
  }
  if (!slots.length) {
    list.replaceChildren(Object.assign(document.createElement("span"), { className: "t3tk-hint", textContent: "No favorite models yet. Star models in the picker (Ctrl+Shift+M)." }));
    return;
  }
  list.replaceChildren(
    ...slots.map((entry, i) => {
      const item = document.createElement("div");
      item.className = "t3tk-carousel-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === index));
      item.toggleAttribute("data-current", entry.selected);
      item.toggleAttribute("data-disabled", entry.disabled);
      const key = document.createElement("kbd");
      key.textContent = entry.slot <= 9 ? String(entry.slot) : "";
      const name = document.createElement("span");
      name.textContent = entry.name;
      const provider = document.createElement("small");
      provider.textContent = entry.selected ? `${entry.provider} · current` : entry.provider;
      item.append(key);
      if (entry.icon) {
        const logo = document.createElement("div");
        logo.className = "t3tk-model-icon";
        logo.setAttribute("aria-hidden", "true");
        logo.append(entry.icon);
        item.append(logo);
      }
      item.append(name, provider);
      item.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        commit(entry.key, e);
      });
      return item;
    }),
  );
  list.children[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function openCarousel(found) {
  closeCarousel();
  const panel = document.createElement("div");
  panel.className = "t3tk-carousel";
  panel.dataset.t3tkCarousel = "";
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", "Favorite models");
  const list = document.createElement("div");
  list.className = "t3tk-carousel-list";
  const hint = document.createElement("div");
  hint.className = "t3tk-hint";
  hint.textContent = "1–9 to pick · ←/→ or scroll, then release to switch · Esc to cancel";
  panel.append(list, hint);
  document.body.append(panel);
  const mine = ++token;
  carousel = { panel, found, slots: null, index: 0, moved: false, pending: 0, token: mine };
  renderCarousel();
  const slots = await readFavorites(found);
  if (carousel?.token !== mine) return;
  if (!slots) {
    closeCarousel();
    return;
  }
  carousel.slots = slots;
  carousel.index = Math.max(0, slots.findIndex((s) => s.selected));
  renderCarousel();
  // Scrolls made while the favorites were loading.
  if (carousel.pending) step(carousel.pending);
}

function closeCarousel() {
  clearTimeout(holdTimer);
  holdTimer = 0;
  carousel?.panel.remove();
  carousel = null;
}

function commit(key, event) {
  const found = carousel?.found;
  closeCarousel();
  if (found && key && !pickerBusy()) void chooseFavorite(found, { key }, event);
}

function step(offset) {
  if (carousel && !carousel.slots) {
    carousel.pending += offset;
    return;
  }
  if (!carousel?.slots?.length) return;
  carousel.index = cycle(carousel.index, offset, carousel.slots.length);
  carousel.moved = true;
  renderCarousel();
}

// --- Keys ----------------------------------------------------------------------------------------

function target(event) {
  if (document.querySelector(".t3tk-overlay")) return null;
  const found = composerHandle();
  if (!found || (isOtherTextField(event.target, found.editor) && !inPicker(event.target))) return null;
  return found;
}

function onKeyDown(event) {
  if (carousel) {
    // While it shows, the carousel takes every key, so nothing is typed into the composer.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat && !event.key.startsWith("Arrow")) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? "");
    if (event.key === "Escape") closeCarousel();
    else if (digit) {
      const entry = carousel.slots?.find((s) => s.slot === Number(digit[1]));
      if (entry) commit(entry.key, event);
      else if (carousel.slots) toast(`No favorite model ${digit[1]}`, 1500);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) step(1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Tab") step(-1);
    else if (event.key === "Enter") commit(carousel.slots?.[carousel.index]?.key, event);
    return;
  }

  const slot = modelSlotFromKey(event);
  if (slot !== null) {
    clearTimeout(holdTimer);
    const found = target(event);
    if (!found) return;
    // Taken only when a composer is there to act on; otherwise the key goes on as usual.
    event.preventDefault();
    event.stopPropagation();
    if (!pickerBusy()) void chooseFavorite(found, { slot }, event);
    return;
  }

  if (isModifierKey(event) && switcherChordHeld(event) && !event.repeat) {
    clearTimeout(holdTimer);
    if (!target(event)) return;
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      const found = composerHandle();
      if (found && !pickerBusy()) void openCarousel(found);
    }, HOLD_MS);
  } else if (!isModifierKey(event)) {
    // Ctrl+Alt+<other key> is some other shortcut; don't pop the carousel over it.
    clearTimeout(holdTimer);
    holdTimer = 0;
  }
}

function onKeyUp(event) {
  if (switcherChordHeld(event)) return; // still held (Shift released, say)
  clearTimeout(holdTimer);
  holdTimer = 0;
  if (!carousel) return;
  event.preventDefault();
  event.stopPropagation();
  // Releasing commits only a choice made with the arrows; just peeking changes nothing.
  if (carousel.moved && carousel.slots?.[carousel.index]) commit(carousel.slots[carousel.index].key, event);
  else closeCarousel();
}

// Ctrl+Alt+wheel moves through the favorites instead of zooming the window. A trackpad sends many
// small deltas, so they add up before each step.
const WHEEL_STEP = 40;
let wheelSum = 0;

function onWheel(event) {
  if (!switcherChordHeld(event)) return;
  if (!carousel) {
    const found = target(event);
    if (!found || pickerBusy()) return;
    clearTimeout(holdTimer);
    holdTimer = 0;
    wheelSum = 0;
    void openCarousel(found);
  }
  event.preventDefault();
  event.stopPropagation();
  const delta = event.deltaMode === 0 ? event.deltaY || event.deltaX : (event.deltaY || event.deltaX) * WHEEL_STEP;
  if (Math.sign(delta) !== Math.sign(wheelSum)) wheelSum = 0;
  wheelSum += delta;
  // At most one step per event, so one mouse notch is one model whatever its delta.
  if (Math.abs(wheelSum) >= WHEEL_STEP) {
    step(Math.sign(wheelSum));
    wheelSum = 0;
  }
}

// Keyups are lost when the window loses focus, so give up rather than stay open.
const cancel = () => closeCarousel();
const onVisibility = () => document.hidden && closeCarousel();

let listening = false;

export const modelSwitcher = {
  id: "model-switcher",
  title: "Ctrl+Alt + 1-9 switches favorite models (hold to see them)",
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
    if (carousel && !carousel.found.editor.isConnected) closeCarousel();
    return composerHandle() ? "ok" : "idle";
  },
  stop() {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("wheel", onWheel, { capture: true });
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", onVisibility);
    listening = false;
    closeCarousel();
    clearSilent();
  },
};
