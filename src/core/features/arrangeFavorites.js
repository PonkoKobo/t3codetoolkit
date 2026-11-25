import { decodeModelKey, effectiveOrder, moveFavorite, placeFavorite } from "../favoriteOrder.js";
import { findPropsUp } from "../react.js";
import { toast } from "../styles.js";

const PICKER = "[data-model-picker-content]";
const STORAGE_PREFIX = "t3tk.favorite-order:";
let view = null;
let listening = false;

export function pickerContext() {
  for (const picker of document.querySelectorAll(PICKER)) {
    if (!picker.querySelector('[data-model-picker-provider="favorites"] button[aria-pressed="true"]')) continue;
    if (picker.querySelector("[data-model-picker-sortable-index]") || !picker.getClientRects().length) continue;
    const search = picker.querySelector('input[role="combobox"]');
    const nativeList = picker.querySelector('[role="listbox"]')?.parentElement;
    if (!search || search.value.trim() || !nativeList?.parentElement?.contains(search) || nativeList.contains(search)) continue;
    const catalog = findPropsUp(search, (p) => typeof p.environmentId === "string" &&
      p.modelOptionsByInstance instanceof Map && Array.isArray(p.instanceEntries) &&
      typeof p.onInstanceModelChange === "function");
    const combobox = findPropsUp(search, (p) => p.virtualized === true && p.filter === null &&
      Array.isArray(p.filteredItems) && typeof p.onValueChange === "function");
    if (!catalog || !combobox) continue;

    const providers = new Map(catalog.instanceEntries.map((entry) => [entry.instanceId, entry.displayName]));
    const models = new Map();
    for (const key of combobox.filteredItems) {
      const identity = decodeModelKey(key);
      if (!identity) continue;
      const { instanceId, slug } = identity;
      const model = catalog.modelOptionsByInstance.get(instanceId)?.find((candidate) => candidate.slug === slug);
      if (!model) continue;
      models.set(key, {
        name: model.name || slug,
        provider: providers.get(instanceId) || instanceId,
        disabled: Boolean(catalog.getModelDisabledReason?.(instanceId, slug)) || model.isUnavailable === true,
        selected: Array.isArray(combobox.value) ? combobox.value.includes(key) : combobox.value === key,
      });
    }
    if (models.size) return { picker, search, nativeList, combobox, models, storageKey: STORAGE_PREFIX + catalog.environmentId };
  }
  return null;
}

export function readOrder(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(value)) return effectiveOrder(value, []);
  } catch {
    // A malformed or unavailable preference should fall back to the native picker.
  }
  return [];
}

function button(text, action, label = text) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "t3tk-btn";
  element.textContent = text;
  element.setAttribute("aria-label", label);
  element.addEventListener("click", (event) => {
    // Let the native popover finish handling the click before a redraw detaches its target.
    setTimeout(() => {
      if (element.isConnected) action(event);
    }, 0);
  });
  return element;
}

function disposeView() {
  if (!view) return;
  if (view.panel.contains(document.activeElement)) view.search.focus({ preventScroll: true });
  delete view.nativeList.dataset.t3tkFavoritesNative;
  view.panel.remove();
  view = null;
}

function createView(context) {
  const panel = document.createElement("section");
  panel.className = "t3tk-favorites";
  panel.setAttribute("aria-label", "Favorite model order");
  const toolbar = document.createElement("div");
  toolbar.className = "t3tk-favorites-toolbar";
  const rows = document.createElement("ol");
  rows.className = "t3tk-favorites-list";
  rows.setAttribute("aria-label", "Ordered favorites");
  const status = document.createElement("span");
  status.className = "t3tk-favorites-status";
  status.setAttribute("role", "status");
  panel.append(toolbar, rows, status);
  context.nativeList.before(panel);
  return { ...context, panel, toolbar, rows, status, editing: false, useNative: false, signature: "" };
}

function pickModel(key, event) {
  const context = pickerContext();
  const model = context?.models.get(key);
  if (!model || model.disabled || context.picker !== view?.picker) return;
  // This is the same callback as selecting a native row, including the thread's provider guard.
  context.combobox.onValueChange(key, { event });
}

/** Saves a new order for the open picker. Returns the context it saved for, or null. */
function saveOrder(reorder) {
  const context = pickerContext();
  if (!context || context.picker !== view?.picker || !view.editing) return null;
  const order = effectiveOrder(readOrder(context.storageKey), context.models.keys());
  const movable = new Set([...context.models].filter(([, model]) => !model.disabled).map(([id]) => id));
  const next = reorder(order, movable);
  if (next === order) return null;
  try {
    localStorage.setItem(context.storageKey, JSON.stringify(next));
  } catch {
    toast("Could not save favorite order in this client.");
    return null;
  }
  sync();
  return { context, next };
}

function changeOrder(key, offset) {
  const saved = saveOrder((order, movable) => moveFavorite(order, movable, key, offset));
  if (!saved) return;
  const controls = view?.controls.get(key);
  const preferred = controls?.[offset === -1 ? 0 : 1];
  const other = controls?.[offset === -1 ? 1 : 0];
  (preferred?.disabled ? other : preferred)?.focus();
  if (view) view.status.textContent = `${saved.context.models.get(key).name} moved to position ${saved.next.indexOf(key) + 1}.`;
}

// Drag by the grip. Rows only slide (CSS transforms) while dragging: moving DOM nodes would drop
// pointer capture and trigger redraws. The order is saved once, on drop.
function startDrag(event, row, key) {
  if (event.button !== 0 || !view?.editing) return;
  event.preventDefault();
  event.stopPropagation();
  const list = row.parentElement;
  const rows = [...list.children].filter((item) => item.dataset.movable !== undefined);
  const from = rows.indexOf(row);
  if (from < 0) return;
  const boxes = rows.map((item) => item.getBoundingClientRect());
  const step = rows.length > 1 ? Math.abs(boxes[1].top - boxes[0].top) : boxes[0].height;
  const startY = event.clientY;
  let target = from;
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Window listeners below still follow the pointer.
  }
  row.setAttribute("data-dragging", "");
  const move = (e) => {
    if (e.pointerId !== event.pointerId) return;
    const dy = e.clientY - startY;
    row.style.transform = `translateY(${dy}px)`;
    target = rows.filter((other, index) => index !== from && boxes[index].top + boxes[index].height / 2 < boxes[from].top + boxes[from].height / 2 + dy).length;
    rows.forEach((other, index) => {
      if (other === row) return;
      const shift = index > from && index <= target ? -step : index < from && index >= target ? step : 0;
      other.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };
  const end = (e) => {
    if (e.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    row.removeAttribute("data-dragging");
    for (const item of rows) item.style.transform = "";
    if (e.type !== "pointerup" || target === from) return;
    const saved = saveOrder((order, movable) => placeFavorite(order, movable, key, target));
    if (saved && view) view.status.textContent = `${saved.context.models.get(key).name} moved to position ${saved.next.indexOf(key) + 1}.`;
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
}

function render(current, saved, order) {
  // Keep focus inside the native popover while replacing focused toolkit controls.
  if (current.panel.contains(document.activeElement)) current.search.focus({ preventScroll: true });
  const arranged = current.editing || (saved.length > 0 && !current.useNative);
  current.nativeList.toggleAttribute("data-t3tk-favorites-native", arranged);
  current.panel.toggleAttribute("data-arranged", arranged);
  current.rows.hidden = !arranged;

  const arrange = button(current.editing ? "Done" : "Arrange Favorites", () => {
    current.editing = !current.editing;
    current.useNative = false;
    sync();
    view?.toolbar.firstElementChild?.focus();
  });
  arrange.disabled = !current.editing && [...current.models.values()].filter((model) => !model.disabled).length < 2;
  current.toolbar.replaceChildren(arrange);
  if (saved.length && !current.editing) {
    current.toolbar.append(button(current.useNative ? "Ordered list" : "Original list", () => {
      current.useNative = !current.useNative;
      sync();
      view?.toolbar.lastElementChild?.focus();
    }));
  }

  current.controls = new Map();
  current.rows.replaceChildren();
  if (!arranged) return;
  const movable = order.filter((key) => current.models.has(key) && !current.models.get(key).disabled);
  for (const [position, key] of order.entries()) {
    const model = current.models.get(key);
    if (!model) continue;
    const row = document.createElement("li");
    const number = document.createElement("span");
    number.textContent = String(position + 1);
    number.className = "t3tk-favorites-number";
    const label = `${model.name} (${model.provider})`;
    const select = button(model.name, (event) => pickModel(key, event), label);
    select.classList.add("t3tk-favorite-model");
    select.disabled = model.disabled || current.editing;
    select.toggleAttribute("data-active", model.selected);
    select.setAttribute("aria-pressed", String(model.selected));
    select.title = label;
    const provider = document.createElement("small");
    provider.textContent = model.provider;
    select.append(provider);
    row.append(number, select);
    if (current.editing) {
      const index = movable.indexOf(key);
      if (index >= 0) {
        row.dataset.movable = "";
        const grip = document.createElement("span");
        grip.className = "t3tk-favorites-grip";
        grip.title = "Drag to reorder";
        grip.setAttribute("aria-hidden", "true");
        grip.textContent = "⠿";
        grip.addEventListener("pointerdown", (event) => startDrag(event, row, key));
        row.prepend(grip);
      }
      const up = button("↑", () => changeOrder(key, -1), `Move ${label} up`);
      const down = button("↓", () => changeOrder(key, 1), `Move ${label} down`);
      up.disabled = index <= 0;
      down.disabled = index < 0 || index === movable.length - 1;
      current.controls.set(key, [up, down]);
      row.append(up, down);
    }
    current.rows.append(row);
  }
}

function onKeyDown(event) {
  if (!view?.panel.hasAttribute("data-arranged") || event.defaultPrevented || event.isComposing) return;
  const { panel, picker, rows, search, editing, order } = view;
  if (!panel.isConnected || !picker.isConnected || search.value.trim()) return;
  const inPicker = event.target instanceof Element && picker.contains(event.target);
  // The app's own Ctrl/Cmd+1-9 jump listens on the whole window while the picker is open and
  // skips events already handled, so this one (registered earlier) answers first, in our order.
  const modifier = /Mac/.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const listJump = inPicker && panel.contains(event.target) && !event.ctrlKey && !event.metaKey;
  const digit = /^[1-9]$/.test(event.key) && !event.altKey && !event.shiftKey && (modifier || listJump);
  const navigate = inPicker && event.target === search && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey &&
    ["ArrowDown", "ArrowUp", "Enter"].includes(event.key);
  if (!digit && !navigate) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat || editing) return;
  if (digit) pickModel(order[Number(event.key) - 1], event);
  else {
    const choices = rows.querySelectorAll("button:not(:disabled)");
    if (event.key === "Enter") choices[0]?.click();
    else (event.key === "ArrowDown" ? choices[0] : choices[choices.length - 1])?.focus();
  }
}

function sync() {
  const context = pickerContext();
  if (!context) {
    disposeView();
    return "idle";
  }
  if (view?.nativeList !== context.nativeList || view.storageKey !== context.storageKey || !view.panel.isConnected) {
    disposeView();
    view = createView(context);
  }
  const saved = readOrder(context.storageKey);
  const order = effectiveOrder(saved, context.models.keys());
  const signature = JSON.stringify([saved, [...context.models], view.editing, view.useNative]);
  Object.assign(view, context, { order });
  if (signature !== view.signature) {
    view.signature = signature;
    render(view, saved, order);
  }
  return "ok";
}

export const arrangeFavorites = {
  id: "arrange-favorites",
  title: "Arrange Favorites",
  surfaces: ["web", "desktop"],
  sync() {
    if (!listening) {
      listening = true;
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("storage", sync);
    }
    return sync();
  },
  stop() {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("storage", sync);
    listening = false;
    disposeView();
  },
};
