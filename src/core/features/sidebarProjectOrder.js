import { sidebarFolderOrders } from "../projectKeys.js";
import { findPropsUp } from "../react.js";
import { numbered } from "./projectSwitcher.js";

// Shows the sidebar's pinned projects in the same order as the Ctrl+Shift numbers (the order set by
// dragging in the new-thread project picker), instead of upstream's thread-activity order, and puts
// each pinned project's number after its name.
//
// Upstream markup used: the sidebar is one flat flex column (`ul.flex.flex-col`). A project folder is
// `li[data-testid="sidebar-project-folder"]` holding `button[data-sidebar-row="folder:<projectKey>"]`,
// whose component props carry `group: { projectKey, pinned }`. The folder's thread rows follow it as
// sibling `li`s containing `[data-sidebar-parent="folder:<projectKey>"]`. The keys match the project
// picker's item values. Rows are only moved visually with CSS `order`; the DOM stays React's.

const FOLDER_LI = 'li[data-testid="sidebar-project-folder"]';
const ROW = 'button[data-sidebar-row^="folder:"]';
const ORDERED = "data-t3tk-sidebar-order";
const SLOT = "data-t3tk-folder-slot";

let list = null;
let observer = null;
let applying = false;

const folderKey = (li) => li.querySelector(ROW)?.dataset.sidebarRow.slice("folder:".length) ?? null;

function describe(child) {
  if (child.matches(FOLDER_LI)) {
    const key = folderKey(child);
    if (!key) return { folder: null, parent: null };
    const group = findPropsUp(child, (p) => p.group && p.group.projectKey === key && typeof p.group.pinned === "boolean", 6)?.group;
    const name = child.querySelector(`${ROW} > span.truncate`)?.textContent.trim() ?? key;
    return { folder: key, pinned: Boolean(group?.pinned), known: Boolean(group), name, el: child };
  }
  const parent = child.querySelector('[data-sidebar-parent^="folder:"]')?.dataset.sidebarParent.slice("folder:".length) ?? null;
  return { folder: null, parent };
}

function clearList(ul) {
  for (const el of ul?.querySelectorAll(`:scope > [${ORDERED}]`) ?? []) {
    el.style.order = "";
    el.removeAttribute(ORDERED);
  }
}

function clearSlots() {
  for (const el of document.querySelectorAll(`[${SLOT}]`)) el.removeAttribute(SLOT);
}

function apply() {
  if (!list?.isConnected || applying) return;
  applying = true;
  try {
    const children = [...list.children];
    const rows = children.map(describe);
    const folders = rows.filter((r) => r.folder);
    // Without the pin state (a changed upstream layout) there is nothing safe to do.
    if (!folders.length || folders.some((f) => !f.known)) {
      clearList(list);
      clearSlots();
      return;
    }
    const { slots } = numbered(folders.map(({ folder, name, pinned }) => ({ key: folder, name, pinned })));
    const slotByKey = new Map(slots.map((s) => [s.key, s.slot]));
    for (const f of folders) {
      const label = f.el.querySelector(`${ROW} > span.truncate`);
      const slot = slotByKey.get(f.folder);
      if (!label) continue;
      if (slot && slot <= 9) {
        if (label.getAttribute(SLOT) !== String(slot)) label.setAttribute(SLOT, String(slot));
      } else if (label.hasAttribute(SLOT)) label.removeAttribute(SLOT);
    }
    const orders = sidebarFolderOrders(rows, slots.map((s) => s.key));
    children.forEach((child, i) => {
      const order = orders?.[i] ?? null;
      if (order === null) {
        if (child.hasAttribute(ORDERED)) {
          child.style.order = "";
          child.removeAttribute(ORDERED);
        }
      } else if (child.getAttribute(ORDERED) !== String(order)) {
        child.style.order = String(order);
        child.setAttribute(ORDERED, String(order));
      }
    });
  } finally {
    applying = false;
  }
}

function watch(ul) {
  if (list === ul) return;
  observer?.disconnect();
  clearList(list);
  list = ul;
  // Re-apply in the same task React adds or moves rows, before the browser paints them out of place.
  observer = new MutationObserver(apply);
  observer.observe(ul, { childList: true });
}

export const sidebarProjectOrder = {
  id: "sidebar-project-order",
  title: "Sidebar keeps pinned projects in the Ctrl+Shift number order",
  surfaces: ["web", "desktop"],
  sync() {
    const ul = document.querySelector(FOLDER_LI)?.parentElement ?? null;
    if (!ul) {
      if (list && !list.isConnected) {
        observer?.disconnect();
        observer = null;
        list = null;
      }
      return "idle";
    }
    watch(ul);
    // Pins and the saved order can change without the list changing (picker drag, pin toggle).
    apply();
    return "ok";
  },
  stop() {
    observer?.disconnect();
    observer = null;
    clearList(list);
    clearSlots();
    list = null;
  },
};
