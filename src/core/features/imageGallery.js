// Project image gallery: a button on each sidebar project row opens every image sent or produced in that
// project's threads. Read-only use of the app's own server API (approved exception, see DESIGN.md §5):
// thread list via `orchestration.subscribeShell`, thread contents via the transcript HTTP endpoints, and
// image URLs via `assets.createUrl`. Nothing is written to the server.
import { openAnnotator } from "../annotate/editor.js";
import { addToComposer, findComposer } from "../composer.js";
import { arrangeImages, embeddedImageBlob, imagesFromRows, projectThreads, SORTS } from "../galleryData.js";
import { homeHref } from "../projectKeys.js";
import { findPropsUp } from "../react.js";
import { galleryIcon } from "../icons.js";
import { toast } from "../styles.js";

const PROTOCOL = "2";
const SCAN_CONCURRENCY = 3;
const HISTORY_PAGE_CAP = 60; // per oversized thread, when the full transcript is refused
const isGroupProps = (p) => p.group && Array.isArray(p.group.memberProjectRefs);

// ---------------------------------------------------------------- connection

let connectionPromise = null;
const threadCache = new Map(); // threadId -> { updatedAt, images }

function trimSlash(url) {
  return String(url).replace(/\/+$/, "");
}

async function openConnection() {
  const bridge = window.desktopBridge;
  let httpBase = location.origin;
  let wsBase = null;
  let token = null;
  if (bridge?.getLocalEnvironmentBootstraps) {
    const boots = (await bridge.getLocalEnvironmentBootstraps()) ?? [];
    const primary = boots.find?.((b) => b.id === "primary") ?? boots[0];
    if (primary?.httpBaseUrl) httpBase = trimSlash(primary.httpBaseUrl);
    if (primary?.wsBaseUrl) wsBase = primary.wsBaseUrl;
    token = (await bridge.getLocalEnvironmentBearerToken?.().catch(() => null)) ?? null;
  }
  const authHeaders = token ? { authorization: `Bearer ${token}` } : {};
  const credentials = token ? "omit" : "include";
  const get = (path, signal) =>
    fetch(`${httpBase}${path}`, { credentials, signal, headers: { ...authHeaders, "x-t3-orchestration-protocol": PROTOCOL } });

  const env = await (await get("/.well-known/t3/environment")).json().catch(() => ({}));

  // Same URL shape the app builds: base path "/" becomes "/ws", plus a short-lived ticket.
  const socketUrl = new URL(wsBase ?? httpBase.replace(/^http/, "ws"));
  if (socketUrl.pathname === "" || socketUrl.pathname === "/") socketUrl.pathname = "/ws";
  socketUrl.searchParams.set("clientSurface", "web");
  socketUrl.searchParams.set("orchestrationProtocol", PROTOCOL);
  const ticket = await issueTicket(httpBase, credentials, authHeaders);
  if (ticket) socketUrl.searchParams.set("wsTicket", ticket);
  else if (token) throw new Error("The desktop server refused a connection ticket.");

  const rpc = await Rpc.open(socketUrl.toString());
  return { httpBase, environmentId: env.environmentId ?? null, get, rpc };
}

async function issueTicket(httpBase, credentials, headers) {
  for (const path of ["/api/auth/websocket-ticket/rpc", "/api/auth/websocket-ticket"]) {
    try {
      const res = await fetch(`${httpBase}${path}`, { method: "POST", credentials, headers });
      if (res.status === 404) continue;
      if (!res.ok) return null;
      return (await res.json()).ticket ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function connection() {
  connectionPromise ??= openConnection().catch((error) => {
    connectionPromise = null;
    throw error;
  });
  return connectionPromise.then((conn) => {
    if (conn.rpc.closed) {
      connectionPromise = null;
      return connection();
    }
    return conn;
  });
}

function closeConnection() {
  const pending = connectionPromise;
  connectionPromise = null;
  pending?.then((conn) => conn.rpc.close()).catch(() => {});
}

/** Minimal client for the app's JSON RPC socket (Request / Chunk+Ack / Exit / Interrupt). */
class Rpc {
  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new Rpc(ws));
      ws.onerror = () => reject(new Error("Couldn't open the app's server connection."));
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.handlers = new Map();
    this.closed = false;
    ws.onmessage = (event) => {
      for (const part of String(event.data).split("\u001e")) {
        if (!part) continue;
        let message;
        try {
          message = JSON.parse(part);
        } catch {
          continue;
        }
        this.handlers.get(message.requestId)?.(message);
      }
    };
    ws.onclose = () => {
      this.closed = true;
      for (const handler of this.handlers.values()) handler({ _tag: "Exit", exit: { _tag: "Failure", cause: "closed" } });
      this.handlers.clear();
    };
  }

  send(message) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  /** Streams chunks to onValue until it returns true (then interrupts) or the server ends the stream. */
  stream(tag, payload, onValue) {
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const finish = (fn) => {
        this.handlers.delete(id);
        fn();
      };
      this.handlers.set(id, (message) => {
        if (message._tag === "Chunk") {
          this.send({ _tag: "Ack", requestId: id });
          for (const value of message.values ?? []) {
            if (onValue(value)) {
              this.send({ _tag: "Interrupt", requestId: id });
              return finish(resolve);
            }
          }
        } else if (message._tag === "Exit") {
          const exit = message.exit ?? {};
          finish(() => (exit._tag === "Success" ? resolve(exit.value) : reject(new Error(describeFailure(exit)))));
        }
      });
      this.send({ _tag: "Request", id, tag, payload, headers: [] });
    });
  }

  call(tag, payload) {
    return this.stream(tag, payload, () => false);
  }

  close() {
    this.closed = true;
    try {
      this.ws.close();
    } catch {}
  }
}

function describeFailure(exit) {
  const text = JSON.stringify(exit.cause ?? exit);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

// ---------------------------------------------------------------- data

export async function listThreads(conn) {
  const threads = [];
  let archiveIncluded = false;
  await conn.rpc.stream(
    "orchestration.subscribeShell",
    { requestCompletionMarker: true, omitIdleSubagents: false, omitOlderSettled: false },
    (value) => {
      if (value.kind === "snapshot" && value.snapshot) {
        archiveIncluded ||= Boolean(value.snapshot.archivedThreads?.length);
        threads.push(...(value.snapshot.threads ?? []), ...(value.snapshot.archivedThreads ?? []));
      } else if (value.thread) {
        threads.push(value.thread);
      }
      return value.kind === "synchronized";
    },
  );
  // Newer servers keep the archive outside the initial active-thread snapshot.
  try {
    const archive = await conn.rpc.call("orchestration.getArchivedShellSnapshot", {});
    for (const thread of archive.threads) threads.push(thread);
    archiveIncluded = true;
  } catch {
    // Older hosts may supply archived threads directly in the subscription.
  }
  return { threads, archiveIncluded };
}

async function threadRows(conn, threadId, signal) {
  const base = `/api/orchestration/threads/${encodeURIComponent(threadId)}`;
  const full = await conn.get(`${base}/transcript`, signal);
  if (full.ok) return { rows: (await full.json()).items ?? [], truncated: false };
  const reason = await full.text().catch(() => "");
  if (!/too_large/i.test(reason)) throw new Error(`Transcript request failed (${full.status}).`);

  // Very long thread: read the recent window, then page back through history.
  const bounded = await conn.get(`${base}/bounded`, signal);
  if (!bounded.ok) throw new Error(`Thread request failed (${bounded.status}).`);
  const first = await bounded.json();
  const rows = [...(first.projection?.visibleTurnItems ?? [])];
  let cursor = first.hasMoreHistory ? first.historyCursor : null;
  for (let page = 0; cursor && page < HISTORY_PAGE_CAP; page++) {
    const res = await conn.get(`${base}/history?cursor=${encodeURIComponent(cursor)}`, signal);
    if (!res.ok) break;
    const body = await res.json();
    rows.push(...(body.items ?? []));
    cursor = body.hasMoreHistory ? body.nextCursor : null;
  }
  return { rows, truncated: !!cursor };
}

const mintedUrls = new Map(); // image key -> { url, expiresAt }

async function imageUrl(image, { fresh = false } = {}) {
  if (image.url) return image.url;
  const cached = mintedUrls.get(image.key);
  if (!fresh && cached && cached.expiresAt - Date.now() > 30_000) return cached.url;
  const conn = await connection();
  const result = await conn.rpc.call("assets.createUrl", { resource: image.resource });
  const url = new URL(result.relativeUrl, `${conn.httpBase}/`).toString();
  const expiresAt = Date.parse(result.expiresAt ?? "") || Date.now() + 5 * 60_000;
  mintedUrls.set(image.key, { url, expiresAt });
  return url;
}

// ---------------------------------------------------------------- gallery overlay

let openGallery = null;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const formatDate = (iso) => (Date.parse(iso ?? "") ? dateFormat.format(new Date(iso)) : "");
const formatSize = (bytes) =>
  typeof bytes === "number" ? (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`) : "";

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function closeGallery() {
  openGallery?.close();
}

function showGallery(group) {
  closeGallery();
  const abort = new AbortController();
  const state = { sort: "newest", query: "", from: "all", images: new Map(), scanned: 0, total: 0, failed: 0, truncated: 0, skippedRemote: 0, done: false, error: "" };
  const previousFocus = document.activeElement;

  const status = el("span", { className: "t3tk-hint t3tk-gallery-status", role: "status" });
  const search = el("input", { type: "search", className: "t3tk-gallery-input", placeholder: "Search name or thread", "aria-label": "Search images" });
  const sort = el("select", { className: "t3tk-gallery-input", "aria-label": "Sort images" }, ...Object.entries(SORTS).map(([value, { label }]) => el("option", { value }, label)));
  const from = el(
    "select",
    { className: "t3tk-gallery-input", "aria-label": "Show images from" },
    el("option", { value: "all" }, "All images"),
    el("option", { value: "you" }, "Sent by you"),
    el("option", { value: "agent" }, "From agents"),
  );
  const closeButton = el("button", { type: "button", className: "t3tk-btn", title: "Close (Esc)", onclick: () => close() }, "Close");
  const grid = el("div", { className: "t3tk-gallery-grid", role: "list" });
  const empty = el("p", { className: "t3tk-hint t3tk-gallery-empty" });
  const root = el(
    "div",
    { className: "t3tk-overlay t3tk-gallery", role: "dialog", "aria-modal": "true", "aria-label": `Images in ${group.title ?? "project"}`, dataset: { t3tkGallery: "" } },
    el(
      "div",
      { className: "t3tk-gallery-bar" },
      el("strong", { className: "t3tk-gallery-title" }, el("span", { className: "t3tk-gallery-icon" }, galleryIcon()), `Images · ${group.displayName ?? group.title ?? "Project"}`),
      search,
      sort,
      from,
      status,
      el("span", { className: "t3tk-spacer" }),
      closeButton,
    ),
    el("div", { className: "t3tk-gallery-body" }, grid, empty),
  );

  // Tiles mint their URL only when scrolled near the viewport.
  const visible = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        visible.unobserve(entry.target);
        const image = state.images.get(entry.target.dataset.key);
        if (image) loadThumb(entry.target, image);
      }
    },
    { root: grid, rootMargin: "400px" },
  );

  const tiles = new Map(); // key -> tile element, reused across re-renders
  function tileFor(image) {
    let tile = tiles.get(image.key);
    if (tile) return tile;
    const img = el("img", { alt: image.name, loading: "lazy", decoding: "async" });
    tile = el(
      "button",
      { type: "button", className: "t3tk-gallery-tile", role: "listitem", title: `${image.name}\n${image.threadTitle}`, dataset: { key: image.key }, onclick: () => showLightbox(image) },
      el("span", { className: "t3tk-gallery-thumb" }, img),
      el("span", { className: "t3tk-gallery-caption" }, el("span", {}, image.name), el("small", {}, `${image.from === "you" ? "You" : "Agent"} · ${formatDate(image.createdAt)}`)),
    );
    tiles.set(image.key, tile);
    visible.observe(tile);
    return tile;
  }

  async function loadThumb(tile, image, retried = false) {
    const img = tile.querySelector("img");
    try {
      img.src = await imageUrl(image, { fresh: retried });
    } catch {
      return dropImage(image);
    }
    img.onerror = () => (retried ? dropImage(image) : loadThumb(tile, image, true));
  }

  function dropImage(image) {
    // Missing on disk or no longer servable: hide it rather than show a broken tile.
    state.images.delete(image.key);
    tiles.get(image.key)?.remove();
    tiles.delete(image.key);
    state.missing = (state.missing ?? 0) + 1;
    renderStatus();
  }

  function renderStatus() {
    const parts = [];
    parts.push(state.done ? `${state.total} threads scanned` : `Scanning ${state.scanned} of ${state.total || "…"} threads`);
    parts.push(`${state.images.size} images`);
    if (state.archiveUnavailable) parts.push("Archive unavailable");
    if (state.failed) parts.push(`${state.failed} threads unreadable`);
    if (state.truncated) parts.push(`${state.truncated} very long thread${state.truncated > 1 ? "s" : ""} only partly read`);
    if (state.missing) parts.push(`${state.missing} missing files hidden`);
    if (state.skippedRemote) parts.push(`${state.skippedRemote} remote project${state.skippedRemote > 1 ? "s" : ""} not included`);
    status.textContent = state.error || parts.join(" · ");
  }

  let renderTimer = 0;
  function render() {
    renderTimer = 0;
    const list = arrangeImages([...state.images.values()], state);
    placeTiles(grid, list.map(tileFor));
    empty.textContent = list.length
      ? ""
      : state.error
        ? state.error
        : !state.done
          ? "Looking for images…"
          : state.images.size
            ? "No images match."
            : "No images in this project's threads yet.";
    empty.hidden = list.length > 0;
    renderStatus();
  }
  const scheduleRender = () => (renderTimer ||= setTimeout(render, 150));

  search.addEventListener("input", () => {
    state.query = search.value;
    scheduleRender();
  });
  sort.addEventListener("change", () => {
    state.sort = sort.value;
    render();
  });
  from.addEventListener("change", () => {
    state.from = from.value;
    render();
  });

  // ---- lightbox
  let lightbox = null;
  function closeLightbox() {
    lightbox?.remove();
    lightbox = null;
  }
  async function showLightbox(image) {
    closeLightbox();
    const img = el("img", { alt: image.name });
    const actions = el("div", { className: "t3tk-gallery-actions" });
    const action = (label, title, onclick) => actions.append(el("button", { type: "button", className: "t3tk-btn", title, onclick }, label));
    action("Open thread", "Go to the thread this image is in", () => {
      close();
      goToThread(image.environmentId, image.threadId);
    });
    action("Add to message", "Attach this image to the message you're writing", () => attachImage(image));
    action("Annotate", "Draw and comment on this image, then add it to your message", async () => {
      const src = await imageUrl(image).catch(() => null);
      if (!src) return toast("Couldn't load this image.");
      close();
      void openAnnotator({ src, name: image.name });
    });
    action("Open full size", "Open the image in a new tab", async () => {
      const src = await imageUrl(image).catch(() => null);
      if (src) window.open(src, "_blank", "noopener");
    });
    const details = el(
      "div",
      { className: "t3tk-gallery-details" },
      el("strong", {}, image.name),
      el("span", {}, `${image.from === "you" ? "Sent by you" : "From the agent"} · ${formatDate(image.createdAt)}${image.sizeBytes ? ` · ${formatSize(image.sizeBytes)}` : ""}`),
      el("span", {}, `Thread: ${image.threadTitle || "Untitled"}`),
      image.path ? el("span", { className: "t3tk-gallery-path" }, image.path) : null,
      actions,
    );
    lightbox = el(
      "div",
      { className: "t3tk-gallery-lightbox", onclick: (e) => e.target === lightbox && closeLightbox() },
      el("button", { type: "button", className: "t3tk-btn t3tk-gallery-back", onclick: closeLightbox, title: "Back to all images (Esc)" }, "← All images"),
      el("div", { className: "t3tk-gallery-full" }, img),
      details,
    );
    root.append(lightbox);
    lightbox.querySelector("button")?.focus();
    try {
      img.src = await imageUrl(image);
      img.onerror = async () => {
        img.onerror = null;
        img.src = await imageUrl(image, { fresh: true }).catch(() => "");
      };
    } catch {
      toast("Couldn't load this image.");
    }
  }

  async function attachImage(image) {
    const composer = findComposer();
    if (!composer) return toast("Open a thread first, then add the image to its message box.");
    try {
      const src = await imageUrl(image);
      const blob = /^data:/i.test(src) ? embeddedImageBlob(src) : await (await fetch(src)).blob();
      const type = blob.type || image.mimeType || "image/png";
      const ext = type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+.*/, "") || "png";
      const name = /\.[a-z0-9]{2,5}$/i.test(image.name) ? image.name : `${image.name.replace(/\s+/g, "-")}.${ext}`;
      const landed = await addToComposer(composer.editor, { file: new File([blob], name, { type }) });
      toast(landed.file ? "Added to your message." : "The message box didn't accept the image.");
      if (landed.file) close();
    } catch {
      toast("Couldn't load this image to attach it.");
    }
  }

  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    if (lightbox) closeLightbox();
    else close();
  };
  document.addEventListener("keydown", onKey, true);

  function close() {
    if (openGallery !== handle) return;
    openGallery = null;
    abort.abort();
    clearTimeout(renderTimer);
    visible.disconnect();
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    if (previousFocus?.isConnected) previousFocus.focus?.();
  }
  const handle = { close };
  openGallery = handle;
  document.body.append(root);
  search.focus();
  render();

  void scan(group, state, abort.signal, scheduleRender, render).catch((error) => {
    if (abort.signal.aborted) return;
    state.error = `Couldn't read this project's threads: ${error.message}`;
    state.done = true;
    render();
  });
}

/**
 * Puts tiles in order, moving only the ones that changed place. Rebuilding the whole grid on every
 * scan update made the view jump while scrolling, because the browser lost its scroll anchor.
 */
function placeTiles(grid, tiles) {
  const keep = new Set(tiles);
  for (const child of [...grid.children]) if (!keep.has(child)) child.remove();
  let cursor = grid.firstElementChild;
  for (const tile of tiles) {
    if (tile === cursor) cursor = cursor.nextElementSibling;
    else grid.insertBefore(tile, cursor);
  }
}

async function scan(group, state, signal, scheduleRender, render) {
  const conn = await connection();
  if (signal.aborted) return;
  const local = (group.memberProjectRefs ?? []).filter((ref) => !conn.environmentId || ref.environmentId === conn.environmentId);
  state.skippedRemote = (group.memberProjectRefs ?? []).length - local.length;
  const { threads, archiveIncluded } = await listThreads(conn);
  state.archiveUnavailable = !archiveIncluded;
  if (signal.aborted) return;
  const queue = projectThreads(threads, local.map((ref) => ref.projectId)).filter((t) => t.itemCount !== 0);
  state.total = queue.length;
  scheduleRender();

  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const thread = queue.shift();
      try {
        let entry = threadCache.get(thread.id);
        if (!entry || entry.updatedAt !== thread.updatedAt) {
          const { rows, truncated } = await threadRows(conn, thread.id, signal);
          entry = { updatedAt: thread.updatedAt, truncated, images: imagesFromRows(rows, thread) };
          threadCache.set(thread.id, entry);
        }
        if (entry.truncated) state.truncated++;
        for (const image of entry.images) state.images.set(image.key, { ...image, environmentId: conn.environmentId ?? local[0]?.environmentId, threadTitle: thread.title ?? image.threadTitle });
      } catch (error) {
        if (signal.aborted) return;
        state.failed++;
        console.warn("[t3tk] gallery: couldn't read a thread", error);
      }
      state.scanned++;
      scheduleRender();
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
  if (signal.aborted) return;
  state.done = true;
  render();
}

function goToThread(environmentId, threadId) {
  if (!environmentId) return;
  const router = window.__TSR_ROUTER__;
  if (typeof router?.navigate === "function") {
    router.navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } })
      .catch(() => toast("Could not open this thread."));
    return;
  }
  // Older clients without an exposed router still follow history changes.
  history.pushState(history.state, "", `${homeHref(location, !!window.desktopBridge)}${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`);
  dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

// ---------------------------------------------------------------- sidebar row button

function projectRows() {
  return document.querySelectorAll('li[data-testid="sidebar-project-folder"]');
}

export const imageGallery = {
  id: "image-gallery",
  title: "Image gallery for each sidebar project",
  surfaces: ["web", "desktop"],
  sync() {
    const rows = projectRows();
    for (const row of rows) {
      const newThread = row.querySelector("button[data-sidebar-action-for]");
      if (!newThread) continue;
      const existing = row.querySelector("[data-t3tk-gallery-open]");
      if (existing && existing.nextElementSibling === newThread) continue;
      existing?.remove();
      const button = document.createElement("button");
      button.type = "button";
      button.className = `${newThread.className} t3tk-gallery-open`;
      button.dataset.t3tkGalleryOpen = "";
      const title = (newThread.getAttribute("aria-label") ?? "").replace(/^New thread in\s*/i, "") || "this project";
      button.setAttribute("aria-label", `Images in ${title}`);
      button.title = `Images in ${title}`;
      button.append(galleryIcon());
      // The sidebar's drag sensors listen for pointer presses; keep this click from starting a drag.
      for (const type of ["pointerdown", "mousedown", "touchstart"]) button.addEventListener(type, (e) => e.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const props = findPropsUp(row, isGroupProps, 40) ?? findPropsUp(row.querySelector("[data-sidebar-row]") ?? row, isGroupProps, 40);
        if (!props) return toast("Couldn't read this project. Try again after the sidebar finishes loading.");
        showGallery(props.group);
      });
      newThread.before(button);
    }
    return rows.length ? "ok" : "idle";
  },
  stop() {
    closeGallery();
    closeConnection();
    document.querySelectorAll("[data-t3tk-gallery-open],[data-t3tk-gallery]").forEach((node) => node.remove());
  },
};
