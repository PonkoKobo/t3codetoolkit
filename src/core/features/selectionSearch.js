import { toast } from "../styles.js";

const SEARCH = "search-in-browser";
const NATIVE_TARGET = "input, textarea, select, img, video, audio, canvas";

async function onContextMenu(event) {
  const target = event.target;
  if (event.defaultPrevented || !event.isTrusted || !target?.closest ||
      target.isContentEditable || target.closest(NATIVE_TARGET)) return;

  const selection = window.getSelection();
  const text = selection?.toString();
  const query = text?.replace(/\s+/g, " ").trim();
  if (!query || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const { clientX: x, clientY: y } = event;
  const fromPointer = event.button === 2 || Boolean(event.pointerType);
  // A selection can survive a right-click elsewhere in the page.
  if (fromPointer
    ? !Array.from(range.getClientRects()).some(({ left, right, top, bottom }) =>
      x >= left && x <= right && y >= top && y <= bottom)
    : !range.intersectsNode(target)) return;

  const bridge = window.desktopBridge;
  const link = target.closest("a[href]");
  // Keep the host's special menus for non-web links, such as mailto links.
  if (link && !/^https?:\/\//i.test(link.href)) return;

  const items = [
    { id: "copy", label: "Copy" },
    { id: "select-all", label: "Select All" },
    { id: SEARCH, label: "Search in browser", separatorBefore: true },
  ];
  if (link) items.unshift({ id: "copy-link", label: "Copy Link" });
  event.preventDefault();
  try {
    const picked = await bridge.showContextMenu(items, { x, y });
    if (picked === SEARCH) {
      const url = new URL("https://www.google.com/search");
      url.searchParams.set("q", query);
      if (!await bridge.openExternal(url.href)) toast("Could not open the search in your browser.");
    } else if (picked === "copy") {
      if (window.getSelection()?.toString() === text && document.execCommand("copy")) return;
      await navigator.clipboard.writeText(text);
    } else if (picked === "copy-link") {
      await navigator.clipboard.writeText(link.href);
    } else if (picked === "select-all") {
      document.execCommand("selectAll");
    }
  } catch {
    toast("Could not complete the right-click action.");
  }
}

let listening = false;

export const selectionSearch = {
  id: "selection-search",
  title: "Search selected text in the browser",
  surfaces: ["desktop"],
  sync() {
    const bridge = window.desktopBridge;
    if (typeof bridge?.showContextMenu !== "function" || typeof bridge.openExternal !== "function") return "idle";
    if (!listening) {
      // Let T3 Code's own context-menu handlers run first.
      window.addEventListener("contextmenu", onContextMenu);
      listening = true;
    }
    return "ok";
  },
  stop() {
    window.removeEventListener("contextmenu", onContextMenu);
    listening = false;
  },
};
