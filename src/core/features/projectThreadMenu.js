const FOLDER = 'li[data-testid="sidebar-project-folder"] button[data-sidebar-row^="folder:"]';
const ACTION = "t3tk-project-thread-visibility";

let load = null;
let restore = null;

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
    const expanded = row.getAttribute("aria-expanded");
    if (!row.isConnected || (expanded !== "true" && expanded !== "false")) {
      return show.call(this, items, position, source);
    }

    const selected = await show.call(this, [...items, {
      id: ACTION,
      label: expanded === "true" ? "Show less" : "Show more",
    }], position, source);
    if (selected !== ACTION) return selected;
    // Reuse the header action so T3 owns sidebar state, focus and persistence.
    if (active && row.isConnected && row.getAttribute("aria-expanded") === expanded) row.click();
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

// T3 Code 0.1.12's loaded toast chunk exports the shared UI API as S. The
// renderer routes both web and Electron context menus through this object.
async function projectContextMenu(url) {
  const { S: getUiApi } = await import(url);
  if (typeof getUiApi !== "function" || !getUiApi.toString().includes("typeof window")) return null;
  const menu = getUiApi()?.contextMenu;
  return typeof menu?.show === "function" ? menu : null;
}

export const projectThreadMenu = {
  id: "project-thread-menu",
  title: "Show more or less in the project menu",
  surfaces: ["web", "desktop"],
  sync() {
    if (restore) return "ok";
    if (load || !document.querySelector(FOLDER)) return "idle";
    const url = performance.getEntriesByType("resource").find(({ name }) => {
      const asset = new URL(name);
      return asset.protocol === location.protocol && asset.host === location.host &&
        /^\/assets\/toast-[\w-]+\.js$/.test(asset.pathname);
    })?.name;
    if (!url) return "idle";

    const request = projectContextMenu(url);
    load = request;
    request.then((menu) => {
      if (load === request && menu) restore = install(menu);
    }).catch(() => {});
    return "idle";
  },
  stop() {
    load = null;
    restore?.();
    restore = null;
  },
};
