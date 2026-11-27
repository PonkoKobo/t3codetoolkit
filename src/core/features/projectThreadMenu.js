import { COMPACT_KEY, LIMIT_KEY, MAX_LIMIT, MIN_LIMIT, clampLimit, hiddenRows, menuChoice, parseCompact } from "../threadLimit.js";
import { compactIcon, expandIcon } from "../icons.js";
import { toast } from "../styles.js";

// Show more / Show less is a browser sidebar button and a desktop context menu item.
// An expanded project is either full (all
// threads, upstream's view) or compact (only its first few threads; the count is set in the
// toolkit menu). A collapsed project offers Show more, which expands it through upstream's own
// header click. Compact is a toolkit state kept per client; upstream only knows expanded/collapsed.
//
// Upstream markup used (0.1.12): the sidebar is one flat list. A project is
// `li[data-testid="sidebar-project-folder"]` holding `button[data-sidebar-row="folder:<key>"]`
// with aria-expanded. Its threads follow it as sibling `li`s whose row has
// `data-sidebar-parent="folder:<key>"`; other rows right after them (no parent, or not a folder or
// shelf parent) are nested under the thread before them. Rows are hidden with an attribute + CSS,
// so React's list is never changed.

const FOLDER_LI = 'li[data-testid="sidebar-project-folder"]';
const FOLDER_BUTTON = 'button[data-sidebar-row^="folder:"][aria-expanded]';
const FOLDER = `${FOLDER_LI} ${FOLDER_BUTTON}`;
const WEB_CONTROL = "[data-t3tk-thread-visibility]";
const ACTION = "t3tk-project-thread-visibility";
const HIDDEN = "data-t3tk-thread-hidden";

let load = null;
let restore = null;
let compact = null;
let limit = null;
let resync = () => {};
let surface;

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    toast("Could not save this setting; it lasts until the app reloads.");
  }
}

function compactSet() {
  compact ??= parseCompact(readStorage(COMPACT_KEY));
  return compact;
}

export function threadLimit() {
  limit ??= clampLimit(readStorage(LIMIT_KEY) ?? undefined);
  return limit;
}

function setCompact(key, on) {
  const set = compactSet();
  if (on) set.add(key);
  else set.delete(key);
  writeStorage(COMPACT_KEY, JSON.stringify([...set]));
  resync();
}

const folderKey = (button) => button.dataset.sidebarRow.slice("folder:".length);
const rowOf = (li) => li.querySelector("[data-sidebar-row]");

/** The folder's thread `li`s in sidebar order, each marked top-level or nested. */
function folderRows(folderLi, key) {
  const rows = [];
  for (let li = folderLi.nextElementSibling; li && !li.matches(FOLDER_LI); li = li.nextElementSibling) {
    const parent = rowOf(li)?.dataset.sidebarParent ?? "";
    const top = parent === `folder:${key}`;
    if (!top && (parent.startsWith("folder:") || parent.startsWith("shelf:"))) break;
    if (!top && !rows.length) break;
    const current = !!li.querySelector('[aria-current]:not([aria-current="false"])');
    rows.push({ li, top, current });
  }
  return rows;
}

function folderState(button) {
  const key = folderKey(button);
  const folderLi = button.closest(FOLDER_LI);
  const rows = folderLi ? folderRows(folderLi, key) : [];
  const isCompact = compactSet().has(key);
  const result = hiddenRows(rows, isCompact ? threadLimit() : Infinity);
  return { key, rows, isCompact, ...result };
}

function applyLimits() {
  const keep = new Set();
  for (const button of document.querySelectorAll(FOLDER)) {
    if (button.getAttribute("aria-expanded") !== "true" || !compactSet().has(folderKey(button))) continue;
    const { rows, hidden } = folderState(button);
    rows.forEach(({ li }, i) => {
      if (!hidden[i]) return;
      keep.add(li);
      if (!li.hasAttribute(HIDDEN)) li.setAttribute(HIDDEN, "");
    });
  }
  for (const li of document.querySelectorAll(`[${HIDDEN}]`)) if (!keep.has(li)) li.removeAttribute(HIDDEN);
}

function menuItem(button) {
  const expanded = button.getAttribute("aria-expanded");
  if (expanded !== "true" && expanded !== "false") return null;
  const { key, isCompact, hiddenThreads, threads } = folderState(button);
  const { label, action } = menuChoice({
    expanded: expanded === "true", compact: isCompact, threads, hiddenThreads, limit: threadLimit(),
  });
  const run = {
    full: () => setCompact(key, false),
    compact: () => setCompact(key, true),
  }[action] ?? (() => button.click()); // expand / collapse: upstream's own header action
  return { label, action, run };
}

function syncWebControls() {
  let found = false;
  for (const folder of document.querySelectorAll(FOLDER_LI)) {
    const header = folder.querySelector(FOLDER_BUTTON);
    const newThread = folder.querySelector("button[data-sidebar-action-for]");
    const item = header && menuItem(header);
    let button = folder.querySelector(WEB_CONTROL);
    if (!newThread || !item) {
      button?.remove();
      continue;
    }
    found = true;
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.t3tkThreadVisibility = "";
      // Match the gallery action: a pointer press on the button is not a sidebar drag.
      for (const type of ["pointerdown", "mousedown", "touchstart"]) {
        button.addEventListener(type, (event) => event.stopPropagation());
      }
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const currentHeader = folder.querySelector(FOLDER_BUTTON);
        if (currentHeader) menuItem(currentHeader)?.run();
      });
    }
    if (button.className !== newThread.className) button.className = newThread.className;
    if (button.title !== item.label) button.title = item.label;
    const project = header.textContent.trim();
    const accessibleLabel = project ? `${item.label} · ${project}` : item.label;
    if (button.getAttribute("aria-label") !== accessibleLabel) button.setAttribute("aria-label", accessibleLabel);
    if (button.dataset.action !== item.action) {
      button.dataset.action = item.action;
      const isMore = item.action === "expand" || item.action === "full";
      button.replaceChildren(isMore ? expandIcon() : compactIcon());
    }
    if (button.parentElement !== newThread.parentElement) newThread.before(button);
  }
  return found ? "ok" : "idle";
}

function install(menu) {
  const show = menu.show;
  let pending = null;
  let active = true;

  function capture(event) {
    const row = event.target?.closest?.(FOLDER);
    pending = row ? { row, x: event.clientX, y: event.clientY, at: performance.now() } : null;
  }

  async function showWithVisibility(items, position, source) {
    if (!items.some((item) => item.id === "new-thread") ||
        !items.some((item) => item.id === "copy-path") ||
        !items.some((item) => item.id === "project-settings") ||
        !pending || pending.x !== position?.x || pending.y !== position?.y ||
        performance.now() - pending.at > 1000) {
      return show.call(this, items, position, source);
    }

    const { row } = pending;
    pending = null;
    const item = row.isConnected ? menuItem(row) : null;
    if (!item) return show.call(this, items, position, source);

    const expanded = row.getAttribute("aria-expanded");
    const selected = await show.call(this, [...items, { id: ACTION, label: item.label }], position, source);
    if (selected !== ACTION) return selected;
    // Header clicks reuse upstream's action so T3 owns sidebar state, focus and persistence.
    if (active && row.isConnected && row.getAttribute("aria-expanded") === expanded) item.run();
    return null;
  }

  menu.show = showWithVisibility;
  document.addEventListener("contextmenu", capture, true);
  return () => {
    active = false;
    pending = null;
    document.removeEventListener("contextmenu", capture, true);
    if (menu.show === showWithVisibility) menu.show = show;
  };
}

export function toastModuleUrl({ document, location, performance } = window) {
  // Chromium omits t3code:// module loads from Resource Timing. Vite's module
  // preload links expose the actual hashed URL in the desktop renderer.
  const candidates = [
    ...Array.from(document.querySelectorAll('link[rel="modulepreload"][href]'), (link) => link.href),
    ...performance.getEntriesByType("resource").map(({ name }) => name),
  ];
  return candidates.find((url) => {
    const asset = new URL(url, location.href);
    return asset.protocol === location.protocol && asset.host === location.host &&
      /^\/assets\/toast-[\w-]+\.js$/.test(asset.pathname);
  });
}

// T3 Code 0.1.12's loaded toast chunk exports the shared UI API as S. The
// renderer routes both web and Electron context menus through this object.
async function projectContextMenu(url) {
  const { S: getUiApi } = await import(url);
  if (typeof getUiApi !== "function" || !getUiApi.toString().includes("typeof window")) return null;
  const menu = getUiApi()?.contextMenu;
  return typeof menu?.show === "function" ? menu : null;
}

function syncDesktopMenu() {
  if (restore) return "ok";
  if (load || !document.querySelector(FOLDER)) return "idle";
  const url = toastModuleUrl();
  if (!url) return "idle";

  const request = projectContextMenu(url);
  load = request;
  request.then((menu) => {
    if (load === request && menu) restore = install(menu);
  }).catch(() => {});
  return "idle";
}

function settings() {
  const row = document.createElement("label");
  row.className = "t3tk-menu-row t3tk-menu-setting";
  const text = document.createElement("span");
  text.textContent = "Threads shown with Show less";
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(MIN_LIMIT);
  input.max = String(MAX_LIMIT);
  input.step = "1";
  input.value = String(threadLimit());
  const save = (tidy) => {
    // While typing, only save whole numbers in range; on change, tidy up whatever was typed.
    const n = Number(input.value);
    if (!tidy && !(input.value.trim() && Number.isInteger(n) && n >= MIN_LIMIT && n <= MAX_LIMIT)) return;
    const next = clampLimit(input.value);
    if (tidy) input.value = String(next);
    if (next === limit) return;
    limit = next;
    writeStorage(LIMIT_KEY, String(limit));
    resync();
  };
  // The menu closes on an outside click or Esc, sometimes before change fires; input saves first.
  input.addEventListener("input", () => save(false));
  input.addEventListener("change", () => save(true));
  row.append(text, input);
  return row;
}

export const projectThreadMenu = {
  id: "project-thread-menu",
  title: "Show more or fewer threads in a sidebar project",
  surfaces: ["web", "desktop"],
  init(context) {
    resync = context.resync;
    surface = context.surface;
  },
  settings,
  sync() {
    applyLimits();
    return __T3TK_EXTENSION__ || surface === "web" ? syncWebControls() : syncDesktopMenu();
  },
  stop() {
    load = null;
    restore?.();
    restore = null;
    for (const button of document.querySelectorAll(WEB_CONTROL)) button.remove();
    for (const li of document.querySelectorAll(`[${HIDDEN}]`)) li.removeAttribute(HIDDEN);
  },
};
