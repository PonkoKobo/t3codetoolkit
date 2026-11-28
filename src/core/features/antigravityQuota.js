import { askLauncher, hasLauncher } from "../launcher.js";
import { findPropsUp } from "../react.js";

const CONTEXT = "thread-details-context-heading";
const dateFormat = /* @__PURE__ */ new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const detailViews = new Map();
let quotaButton = null;
let current = null;
let quota = null;
let request = null;
let channel = null;
let error = "";

function renderView({ windows, checked, status, refresh }) {
  windows.replaceChildren();
  for (const { label, remaining, resetAt } of quota?.rows ?? []) {
    const row = document.createElement("div");
    row.innerHTML = `
      <div class="t3tk-quota-meter">
        <span></span><progress max="100"></progress><strong></strong>
      </div>
      <small></small>`;
    row.querySelector("span").textContent = `Gemini · ${label}`;
    const meter = row.querySelector("progress");
    meter.setAttribute("aria-label", `Gemini ${label} quota remaining`);
    meter.value = remaining;
    row.querySelector("strong").textContent = `${remaining}%`;
    row.querySelector("small").textContent = Number.isFinite(Date.parse(resetAt))
      ? `Resets ${dateFormat.format(new Date(resetAt))}`
      : "Reset time unavailable";
    windows.append(row);
  }
  checked.textContent = quota ? `Checked ${dateFormat.format(new Date(quota.checkedAt))}` : "No saved Gemini quota";
  refresh.textContent = request ? "Refreshing…" : "Refresh";
  refresh.disabled = Boolean(request);
  status.textContent = error;
}

function render() {
  if (current) renderView(current.view);
  for (const view of detailViews.values()) renderView(view);
}

function buildView() {
  const root = document.createElement("div");
  root.className = "t3tk-quota-view";
  root.innerHTML = `
    <div class="t3tk-quota-windows"></div>
    <div class="t3tk-quota-footer">
      <small></small><button type="button" class="t3tk-btn" aria-label="Refresh Gemini quota">Refresh</button>
    </div>
    <p role="status"></p>`;
  const refresh = root.querySelector("button");
  refresh.addEventListener("click", refreshQuota);
  return {
    root, refresh,
    windows: root.querySelector(".t3tk-quota-windows"),
    checked: root.querySelector("small"),
    status: root.querySelector("p"),
  };
}

function updateQuota(snapshot) {
  const checkedAt = Date.parse(snapshot?.checkedAt);
  if (!Number.isFinite(checkedAt) || !Array.isArray(snapshot.rows) || !snapshot.rows.length) return false;
  if (quota && checkedAt <= Date.parse(quota.checkedAt)) return false;
  quota = snapshot;
  error = "";
  return true;
}

function loadSavedQuota() {
  if (channel) return;
  const connection = new BroadcastChannel("t3tk.gemini-quota");
  channel = connection;
  const readCache = () => {
    askLauncher({ antigravityQuota: "cached" }, 5000).then((snapshot) => {
      if (channel === connection && updateQuota(snapshot)) render();
    }).catch(() => {});
  };
  connection.addEventListener("message", readCache);
  readCache();
}

function refreshQuota() {
  if (request) return;
  error = "";
  const pending = askLauncher({ antigravityQuota: true }, 40_000).then((snapshot) => {
    if (request !== pending) return;
    if (updateQuota(snapshot)) channel?.postMessage("updated");
  }).catch((failure) => {
    if (request !== pending) return;
    error = quota ? `${failure.message} Showing the last successful check.` : failure.message;
  }).finally(() => {
    if (request !== pending) return;
    request = null;
    render();
  });
  request = pending;
  render();
}

function syncDetailViews() {
  const sections = [...document.querySelectorAll("[data-thread-details-card] section")].filter((section) => {
    if (!findPropsUp(section, (props) => props.headingId === CONTEXT, 3)) return false;
    const { usage } = findPropsUp(section, (props) => Array.isArray(props.usage?.providers)) ?? {};
    return /^gemini-/i.test(usage?.model ?? "") && usage.providers.some(
      (provider) => provider.instanceId === usage.providerInstanceId && provider.driver === "antigravity",
    );
  });
  for (const [section, view] of detailViews) {
    if (sections.includes(section)) continue;
    view.root.remove();
    detailViews.delete(section);
  }
  for (const section of sections) {
    let view = detailViews.get(section);
    if (!view) {
      view = buildView();
      view.root.dataset.t3tkDetailQuota = "";
      detailViews.set(section, view);
      renderView(view);
    }
    if (view.root.nextElementSibling !== section) section.before(view.root);
  }
  return sections.length > 0;
}

function closeQuota() {
  if (!current) return;
  const { panel, button, position } = current;
  current = null;
  panel.remove();
  button.setAttribute("aria-expanded", "false");
  window.removeEventListener("resize", position);
}

function openQuota(button) {
  const wasOpen = current?.button === button && current.panel.matches(":popover-open");
  closeQuota();
  if (wasOpen) return;

  const panel = document.createElement("section");
  panel.className = "t3tk-menu t3tk-quota-popover";
  panel.setAttribute("popover", "auto");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Gemini quota from the local Antigravity CLI");
  const view = buildView();
  panel.append(view.root);
  document.body.append(panel);

  const position = () => {
    const box = button.getBoundingClientRect();
    const maxRight = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    panel.style.top = `${Math.round(box.bottom + 6)}px`;
    panel.style.right = `${Math.min(maxRight, Math.max(8, Math.round(window.innerWidth - box.right)))}px`;
  };
  current = { panel, button, view, position };
  panel.addEventListener("toggle", (event) => {
    if (event.newState === "closed" && current?.panel === panel) closeQuota();
  });
  panel.showPopover({ source: button });
  position();
  window.addEventListener("resize", position);
  button.setAttribute("aria-expanded", "true");
  renderView(view);
}

export function syncQuota() {
  if (!window.__T3TK_ANTIGRAVITY_QUOTA__ || !hasLauncher()) return false;
  loadSavedQuota();
  const toolkit = document.querySelector("[data-workspace-titlebar-controls] > [data-t3tk-loaded]");
  if (!toolkit) {
    closeQuota();
    quotaButton?.remove();
  } else {
    if (!quotaButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "t3tk-loaded";
      button.dataset.t3tkQuota = "";
      button.textContent = "Gemini quota";
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => openQuota(button));
      quotaButton = button;
    }
    if (quotaButton.nextElementSibling !== toolkit) {
      closeQuota();
      toolkit.before(quotaButton);
    }
  }
  return syncDetailViews() || Boolean(toolkit);
}

export function stopQuota() {
  closeQuota();
  quotaButton?.remove();
  quotaButton = null;
  for (const view of detailViews.values()) view.root.remove();
  detailViews.clear();
  channel?.close();
  channel = null;
  quota = null;
  request = null;
  error = "";
}

export const quotaCSS = `
.t3tk-antigravity-usage {
  display: grid; gap: 5px; flex: none; padding: 10px 20px;
  border-bottom: 1px solid var(--border, rgb(128 128 128 / 25%));
  color: var(--muted-foreground, inherit); font-size: 12px;
}
.t3tk-antigravity-usage h2 { margin: 0; color: var(--foreground, inherit); font: inherit; font-weight: 600; }
.t3tk-antigravity-usage p { margin: 0; }
.t3tk-quota-commands, .t3tk-quota-step { display: flex; flex-wrap: wrap; align-items: center; }
.t3tk-quota-commands { gap: 5px 16px; }
.t3tk-quota-step { gap: 6px; }
.t3tk-quota-step button, .t3tk-quota-open-terminal {
  padding: 1px 7px; border: 1px solid var(--border, rgb(128 128 128 / 25%)); border-radius: 5px;
  background: var(--muted, transparent); color: var(--foreground, inherit);
  font: 12px/18px var(--font-mono, monospace); cursor: pointer;
}
.t3tk-quota-open-terminal { font-family: inherit; }
.t3tk-quota-step button:hover, .t3tk-quota-open-terminal:hover { border-color: var(--muted-foreground, #888); }
.t3tk-quota-step button:focus-visible, .t3tk-quota-open-terminal:focus-visible { outline: 2px solid var(--ring, #6b8cff); outline-offset: 2px; }
.t3tk-quota-popover { inset: auto; margin: 0; width: min(320px, calc(100vw - 16px)); }
.t3tk-quota-view {
  display: grid; gap: 5px; font-size: 12px; color: var(--muted-foreground, #999);
}
.t3tk-quota-view[data-t3tk-detail-quota] {
  padding: 8px 18px;
  border-block-start: 1px solid var(--border, rgb(128 128 128 / 25%));
}
.t3tk-quota-windows { display: grid; gap: 6px; }
.t3tk-quota-windows:empty { display: none; }
.t3tk-quota-meter { display: grid; grid-template-columns: auto minmax(2rem, 1fr) auto; align-items: center; gap: 10px; min-height: 20px; }
.t3tk-quota-meter progress {
  width: 100%; min-width: 0; height: 3px; appearance: none; border: 0; border-radius: 999px;
  overflow: hidden; background: var(--border, #444); color: var(--muted-foreground, #999);
}
.t3tk-quota-meter progress::-webkit-progress-bar { background: transparent; }
.t3tk-quota-meter progress::-webkit-progress-value { background: currentColor; }
.t3tk-quota-meter progress::-moz-progress-bar { background: currentColor; }
.t3tk-quota-meter strong { color: var(--foreground, inherit); font-weight: 600; font-variant-numeric: tabular-nums; }
.t3tk-quota-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.t3tk-quota-footer .t3tk-btn { height: 22px; padding-inline: 7px; font-size: 11px; }
.t3tk-quota-view small, .t3tk-quota-view p { margin: 0; font-size: 11px; }
.t3tk-quota-view p:empty { display: none; }
`;
