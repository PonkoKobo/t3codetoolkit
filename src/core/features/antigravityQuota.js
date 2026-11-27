import { askLauncher, hasLauncher } from "../launcher.js";

const BUTTON = "[data-t3tk-quota]";
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
let current = null;
let snapshot = null;
let request = null;
let error = "";

function render() {
  if (!current) return;
  const { status, results, refresh } = current;
  refresh.textContent = request ? "Refreshing…" : "Refresh";
  refresh.disabled = Boolean(request);
  const updated = snapshot ? `Updated ${dateFormat.format(new Date(snapshot.checkedAt))}` : "";
  status.textContent = request ? "Checking the local Antigravity CLI…" : [error, updated].filter(Boolean).join(" ");
  results.replaceChildren();
  const groups = Map.groupBy(snapshot?.rows ?? [], (row) => row.group);
  for (const [group, rows] of groups) {
    const title = document.createElement("h3");
    title.textContent = group;
    const list = document.createElement("dl");
    for (const { limit, remaining, resetAt } of rows) {
      const term = document.createElement("dt");
      term.textContent = limit.replace(/ Limit Remaining$/i, "");
      const reset = document.createElement("small");
      reset.textContent = resetAt ? `Resets ${dateFormat.format(new Date(resetAt))}` : "Reset time unavailable";
      term.append(reset);
      const value = document.createElement("dd");
      value.textContent = `${remaining}% left`;
      list.append(term, value);
    }
    results.append(title, list);
  }
}

function refreshQuota() {
  if (request) return;
  error = "";
  request = askLauncher({ antigravityQuota: true }, 40_000).then((data) => {
    snapshot = data;
  }, (failure) => {
    error = snapshot ? `${failure.message} Showing the last successful check.` : failure.message;
  }).finally(() => {
    request = null;
    render();
  });
  render();
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
  panel.setAttribute("aria-label", "Antigravity subscription quota");
  const title = document.createElement("h2");
  title.textContent = "Antigravity quota";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "t3tk-quota-open-terminal";
  refresh.addEventListener("click", refreshQuota);
  const header = document.createElement("header");
  header.append(title, refresh);
  const results = document.createElement("div");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  panel.append(header, results, status);
  document.body.append(panel);

  const position = () => {
    const box = button.getBoundingClientRect();
    const maxRight = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    panel.style.top = `${Math.round(box.bottom + 6)}px`;
    panel.style.right = `${Math.min(maxRight, Math.max(8, Math.round(window.innerWidth - box.right)))}px`;
  };
  current = { panel, button, status, results, refresh, position };
  panel.addEventListener("toggle", (event) => {
    if (event.newState === "closed" && current?.panel === panel) closeQuota();
  });
  panel.showPopover({ source: button });
  position();
  window.addEventListener("resize", position);
  button.setAttribute("aria-expanded", "true");
  if (request) render();
  else refreshQuota();
}

export function syncQuotaButtons() {
  if (!window.__T3TK_ANTIGRAVITY_QUOTA__ || !hasLauncher()) return false;
  if (current && !current.button.isConnected) closeQuota();
  const toolkitButtons = document.querySelectorAll("[data-workspace-titlebar-controls] > [data-t3tk-loaded]");
  for (const toolkit of toolkitButtons) {
    const existing = toolkit.parentElement.querySelector(`:scope > ${BUTTON}`);
    if (existing) {
      if (existing.nextElementSibling !== toolkit) toolkit.before(existing);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "t3tk-loaded";
    button.dataset.t3tkQuota = "";
    button.textContent = "Gemini quota";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => openQuota(button));
    toolkit.before(button);
  }
  return toolkitButtons.length > 0;
}

export function stopQuotaButtons() {
  closeQuota();
  document.querySelectorAll(BUTTON).forEach((button) => button.remove());
  snapshot = null;
  error = "";
}
