import { askLauncher, hasLauncher } from "../launcher.js";
import { isOtherTextField } from "../effortKeys.js";
import { launcherIcon } from "../icons.js";
import { filterMenuItems, matchesShortcut, menuDigitSlot, parseShortcut } from "../quickLauncherKeys.js";
import { toast } from "../styles.js";

const STALE_MS = 30_000;
const TERMINAL = ".xterm, [data-terminal]";
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const buttons = new Map();
const menus = new Map();
const refreshing = new Map();
const errors = new Map();
let activePopover = null;
let keyListener = null;
let channel = null;
let eventRegistered = false;

function configuredLaunchers() {
  const list = window.__T3TK_QUICK_LAUNCHERS__;
  return Array.isArray(list) ? list : [];
}

function isMacPlatform() {
  return /mac/i.test(navigator.platform || navigator.userAgent || "");
}

function getLauncher(id) {
  return configuredLaunchers().find((entry) => entry.id === id) ?? null;
}

function updateMenuSnapshot(launcherId, snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.items)) return false;
  const incomingAt = Date.parse(snapshot.checkedAt ?? "");
  const existing = menus.get(launcherId);
  const existingAt = Date.parse(existing?.checkedAt ?? "");
  if (Number.isFinite(existingAt) && Number.isFinite(incomingAt) && incomingAt < existingAt) return false;
  menus.set(launcherId, snapshot);
  return true;
}

function ensureHostEventHandler() {
  if (eventRegistered) return;
  eventRegistered = true;
  window.__t3tkLauncherEvent = (event) => {
    if (!event || event.type !== "quickLauncherResult") return;
    if (event.cancelled) {
      toast("Launch cancelled.", 2200);
    } else if (event.error) {
      toast(event.error, 4500);
    } else if (event.ok && typeof event.launcherId === "string" && getLauncher(event.launcherId)?.hasMenu) {
      setTimeout(() => {
        if (getLauncher(event.launcherId)?.hasMenu) void refreshLauncher(event.launcherId, true);
      }, 1000);
    }
  };
}

function ensureChannel() {
  if (channel) return;
  const connection = new BroadcastChannel("t3tk.quick-launcher");
  channel = connection;
  connection.addEventListener("message", (event) => {
    const launcherId = event.data?.launcherId;
    if (typeof launcherId !== "string") return;
    loadCached(launcherId);
  });
}

function loadCached(launcherId) {
  askLauncher({ quickLauncher: "cached", launcherId }).then((snapshot) => {
    if (!updateMenuSnapshot(launcherId, snapshot)) return;
    if (activePopover?.launcher.id === launcherId) renderPopover();
  }).catch(() => {});
}

function refreshLauncher(launcherId, silent = false) {
  if (refreshing.has(launcherId)) return refreshing.get(launcherId);
  if (!silent) errors.delete(launcherId);
  const pending = askLauncher({ quickLauncher: "refresh", launcherId }, 20_000).then((snapshot) => {
    if (updateMenuSnapshot(launcherId, snapshot)) {
      errors.delete(launcherId);
      channel?.postMessage({ launcherId });
    }
  }).catch((failure) => {
    if (!silent || !menus.has(launcherId)) errors.set(launcherId, failure.message);
  }).finally(() => {
    refreshing.delete(launcherId);
    if (activePopover?.launcher.id === launcherId) renderPopover();
  });
  refreshing.set(launcherId, pending);
  if (activePopover?.launcher.id === launcherId) renderPopover();
  return pending;
}

function isStale(snapshot) {
  const checkedAt = Date.parse(snapshot?.checkedAt ?? "");
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt > STALE_MS;
}

function openExternalApp(launcher) {
  if (!launcher.canOpenApp) return;
  closePopover();
  toast(`Opening ${launcher.label}…`, 2200);
  askLauncher({ quickLauncherOpen: { launcherId: launcher.id } }, 8000).catch((failure) => {
    toast(failure.message, 4500);
  });
}

function runAction(launcher, action) {
  if (!launcher.canLaunch || !action?.actionId) return;
  closePopover();
  toast(`Launching ${action.label}…`, 2400);
  askLauncher({ quickLauncherLaunch: { launcherId: launcher.id, actionId: action.actionId } }, 15_000).then((result) => {
    if (result?.cancelled) {
      toast("Launch cancelled.", 2200);
      return;
    }
    // If the command is still open (e.g., waiting on a confirmation dialog), wait for the async exit event.
    if (result?.pending) return;
    setTimeout(() => {
      if (getLauncher(launcher.id)?.hasMenu) void refreshLauncher(launcher.id, true);
    }, 1500);
  }).catch((failure) => {
    toast(failure.message, 4500);
  });
}

function closePopover() {
  if (!activePopover) return;
  const { panel, button, position } = activePopover;
  activePopover = null;
  panel.remove();
  button.setAttribute("aria-expanded", "false");
  window.removeEventListener("resize", position);
}

function itemSelectionKey(itemId) {
  return `item:${itemId}`;
}

function actionSelectionKey(itemId, actionId) {
  return `action:${itemId}:${actionId}`;
}

function focusElementForKey(panel, key) {
  if (!key) return;
  const el = panel.querySelector(`[data-t3tk-ql-focus="${CSS.escape(key)}"]`);
  if (el) el.focus({ preventScroll: true });
}

function renderPopover() {
  if (!activePopover) return;
  const { launcher, panel, search, list, resumeSlot, status, refreshBtn, expanded, query } = activePopover;
  const snapshot = menus.get(launcher.id);
  const busy = refreshing.has(launcher.id);
  const error = errors.get(launcher.id) ?? "";

  const focusedEl = document.activeElement;
  const focusedKey = focusedEl && focusedEl !== search && panel.contains(focusedEl)
    ? focusedEl.dataset?.t3tkQlFocus ?? null
    : null;

  refreshBtn.disabled = busy;
  refreshBtn.textContent = busy ? "Refreshing…" : "Refresh";

  const trimmed = query.trim();
  const quickResume = !trimmed ? snapshot?.quickResume : null;
  resumeSlot.replaceChildren();
  if (quickResume && launcher.canLaunch) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "t3tk-ql-resume";
    btn.dataset.t3tkQlFocus = "resume";
    btn.dataset.t3tkQlResume = "";
    btn.dataset.t3tkQlLaunch = launcher.id;
    btn.dataset.t3tkQlAction = quickResume.actionId;
    const badge = document.createElement("span");
    badge.className = "t3tk-ql-badge";
    badge.textContent = "Quick Resume";
    const title = document.createElement("strong");
    title.textContent = quickResume.label;
    const sub = document.createElement("small");
    sub.textContent = [quickResume.group, quickResume.meta].filter(Boolean).join(" · ");
    btn.append(badge, title, sub);
    btn.addEventListener("click", () => runAction(launcher, quickResume));
    resumeSlot.append(btn);
  }

  const matches = filterMenuItems(snapshot?.items ?? [], trimmed);
  const selectable = [];
  for (const match of matches) {
    const { item, groupMatches, matchedActions } = match;
    const subActionOnly = Boolean(trimmed) && !groupMatches && matchedActions.length > 0;
    const isExpanded = expanded.has(item.id) || subActionOnly || (Boolean(trimmed) && !item.defaultAction);
    const shownActions = trimmed && matchedActions.length ? matchedActions : item.actions;
    if (!subActionOnly) {
      selectable.push({
        key: itemSelectionKey(item.id),
        kind: "item",
        item,
        action: item.defaultAction,
      });
    }
    if (isExpanded && shownActions.length) {
      for (const action of shownActions) {
        selectable.push({
          key: actionSelectionKey(item.id, action.actionId),
          kind: "action",
          item,
          action,
        });
      }
    }
  }

  if (activePopover.selectedKey && !selectable.some((entry) => entry.key === activePopover.selectedKey)) {
    activePopover.selectedKey = trimmed ? (selectable[0]?.key ?? null) : null;
  } else if (trimmed && !activePopover.selectedKey && selectable.length) {
    activePopover.selectedKey = selectable[0].key;
  }

  list.replaceChildren();
  activePopover.selectable = selectable;
  activePopover.slotTargets = [];

  if (!snapshot) {
    const empty = document.createElement("p");
    empty.className = "t3tk-ql-empty";
    empty.textContent = busy ? "Loading launcher items…" : "No items loaded yet.";
    list.append(empty);
  } else if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "t3tk-ql-empty";
    empty.textContent = trimmed ? "No matching items." : "No items returned by this launcher.";
    list.append(empty);
  } else {
    let slot = 0;
    for (const match of matches) {
      const { item, groupMatches, matchedActions } = match;
      const subActionOnly = Boolean(trimmed) && !groupMatches && matchedActions.length > 0;
      const isExpanded = expanded.has(item.id) || subActionOnly || (Boolean(trimmed) && !item.defaultAction);
      const shownActions = trimmed && matchedActions.length ? matchedActions : item.actions;

      const wrap = document.createElement("div");
      wrap.className = "t3tk-ql-group";

      const row = document.createElement("div");
      row.className = "t3tk-ql-row";
      const rowKey = itemSelectionKey(item.id);
      if (activePopover.selectedKey === rowKey) row.dataset.selected = "true";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "t3tk-ql-main";
      main.dataset.t3tkQlFocus = rowKey;
      main.title = item.defaultAction?.description || item.defaultAction?.label || item.label;
      if (!subActionOnly && item.defaultAction && launcher.canLaunch) {
        main.dataset.t3tkQlLaunch = launcher.id;
        main.dataset.t3tkQlAction = item.defaultAction.actionId;
      }

      if (!trimmed && item.defaultAction && slot < 9) {
        const kbd = document.createElement("kbd");
        kbd.textContent = String(slot + 1);
        main.append(kbd);
        main.dataset.t3tkQlSlot = String(slot + 1);
        activePopover.slotTargets.push(item.defaultAction);
        slot++;
      } else {
        const spacer = document.createElement("span");
        spacer.className = "t3tk-ql-nokey";
        main.append(spacer);
      }

      const text = document.createElement("span");
      text.className = "t3tk-ql-text";
      const title = document.createElement("strong");
      title.textContent = item.label;
      const sub = document.createElement("small");
      sub.textContent = item.subtitle || [item.defaultAction?.label, item.defaultAction?.meta].filter(Boolean).join(" · ");
      text.append(title, sub);
      main.append(text);

      main.addEventListener("click", () => {
        if (!subActionOnly && item.defaultAction && launcher.canLaunch) {
          runAction(launcher, item.defaultAction);
        } else if (item.actions.length) {
          toggleExpand(item.id);
        }
      });
      row.append(main);

      const hasAlternates = item.actions.some((action) => action.actionId !== item.defaultAction?.actionId);
      if (hasAlternates || (!item.defaultAction && item.actions.length > 0)) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "t3tk-ql-expand";
        toggle.dataset.t3tkQlFocus = `expand:${item.id}`;
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.setAttribute("aria-label", `${isExpanded ? "Hide" : "Show"} all commands for ${item.label}`);
        toggle.textContent = isExpanded ? "▾" : "▸";
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleExpand(item.id);
        });
        row.append(toggle);
      }
      wrap.append(row);

      if (isExpanded && shownActions.length) {
        const subList = document.createElement("div");
        subList.className = "t3tk-ql-sublist";
        for (const action of shownActions) {
          const actionBtn = document.createElement("button");
          actionBtn.type = "button";
          actionBtn.className = "t3tk-ql-action";
          const actKey = actionSelectionKey(item.id, action.actionId);
          actionBtn.dataset.t3tkQlFocus = actKey;
          if (launcher.canLaunch) {
            actionBtn.dataset.t3tkQlLaunch = launcher.id;
            actionBtn.dataset.t3tkQlAction = action.actionId;
          }
          if (activePopover.selectedKey === actKey) actionBtn.dataset.selected = "true";
          actionBtn.disabled = !launcher.canLaunch;
          if (action.description) actionBtn.title = action.description;
          const name = document.createElement("span");
          name.className = "t3tk-ql-action-name";
          name.textContent = action.label;
          actionBtn.append(name);
          if (action.category) {
            const tag = document.createElement("span");
            tag.className = "t3tk-ql-tag";
            tag.textContent = action.category;
            actionBtn.append(tag);
          }
          if (action.meta) {
            const meta = document.createElement("small");
            meta.textContent = action.meta;
            actionBtn.append(meta);
          }
          actionBtn.addEventListener("click", () => runAction(launcher, action));
          subList.append(actionBtn);
        }
        wrap.append(subList);
      }

      list.append(wrap);
    }
  }

  const checkedText = snapshot?.checkedAt && Number.isFinite(Date.parse(snapshot.checkedAt))
    ? `Updated ${dateFormat.format(new Date(snapshot.checkedAt))}`
    : "";
  status.textContent = error || checkedText;

  if (focusedKey) {
    const restored = panel.querySelector(`[data-t3tk-ql-focus="${CSS.escape(focusedKey)}"]`);
    if (restored) restored.focus({ preventScroll: true });
    else panel.focus({ preventScroll: true });
  }
}

function toggleExpand(itemId) {
  if (!activePopover) return;
  if (activePopover.expanded.has(itemId)) activePopover.expanded.delete(itemId);
  else activePopover.expanded.add(itemId);
  renderPopover();
}

function openPopover(launcher, button) {
  const wasOpen = activePopover?.button === button && activePopover.panel.matches(":popover-open");
  closePopover();
  if (wasOpen) return;

  const panel = document.createElement("section");
  panel.className = "t3tk-menu t3tk-ql-popover";
  panel.dataset.t3tkQuickLauncherMenu = launcher.id;
  panel.setAttribute("popover", "auto");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `${launcher.label} quick launcher`);
  panel.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "t3tk-ql-header";
  const heading = document.createElement("div");
  heading.className = "t3tk-ql-title";
  const titleText = document.createElement("strong");
  titleText.textContent = launcher.label;
  heading.append(titleText);
  const parsed = parseShortcut(launcher.shortcut);
  if (parsed) {
    const kbd = document.createElement("kbd");
    kbd.textContent = parsed.label;
    heading.append(kbd);
  }
  const controls = document.createElement("div");
  controls.className = "t3tk-ql-controls";
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "t3tk-btn";
  refreshBtn.dataset.t3tkQlFocus = "refresh";
  refreshBtn.textContent = "Refresh";
  refreshBtn.addEventListener("click", () => void refreshLauncher(launcher.id, false));
  controls.append(refreshBtn);
  if (launcher.canOpenApp) {
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "t3tk-btn";
    openBtn.dataset.t3tkQlFocus = "open-app";
    openBtn.dataset.t3tkQlOpen = launcher.id;
    openBtn.textContent = "Open App";
    openBtn.addEventListener("click", () => openExternalApp(launcher));
    controls.append(openBtn);
  }
  header.append(heading, controls);

  const search = document.createElement("input");
  search.type = "search";
  search.className = "t3tk-ql-search";
  search.placeholder = "Filter… (1–9 launch, Enter resume/run, / search)";
  search.setAttribute("aria-label", `Filter ${launcher.label}`);

  const resumeSlot = document.createElement("div");
  resumeSlot.className = "t3tk-ql-resume-slot";

  const list = document.createElement("div");
  list.className = "t3tk-ql-list";

  const footer = document.createElement("div");
  footer.className = "t3tk-ql-footer";
  const status = document.createElement("small");
  status.setAttribute("role", "status");
  footer.append(status);

  panel.append(header, search, resumeSlot, list, footer);
  document.body.append(panel);

  const position = () => {
    const box = button.getBoundingClientRect();
    const maxRight = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    panel.style.top = `${Math.round(box.bottom + 6)}px`;
    panel.style.right = `${Math.min(maxRight, Math.max(8, Math.round(window.innerWidth - box.right)))}px`;
  };

  activePopover = {
    launcher, panel, button, position, search, resumeSlot, list, status, refreshBtn,
    expanded: new Set(), query: "", selectedKey: null, selectable: [], slotTargets: [],
  };

  search.addEventListener("input", () => {
    if (!activePopover) return;
    activePopover.query = search.value;
    activePopover.selectedKey = null;
    renderPopover();
  });

  panel.addEventListener("keydown", (event) => {
    if (!activePopover || activePopover.panel !== panel) return;
    if (event.isComposing) return;
    const inSearch = document.activeElement === search;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (inSearch && search.value) {
        search.value = "";
        activePopover.query = "";
        activePopover.selectedKey = null;
        renderPopover();
        panel.focus();
      } else {
        closePopover();
        button.focus();
      }
      return;
    }
    if (!inSearch) {
      const slot = menuDigitSlot(event);
      if (slot >= 0 && slot < activePopover.slotTargets.length && launcher.canLaunch) {
        event.preventDefault();
        event.stopPropagation();
        runAction(launcher, activePopover.slotTargets[slot]);
        return;
      }
      if (event.key === "/" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        search.focus();
        return;
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1 && /[a-z]/i.test(event.key)) {
        search.focus();
        return;
      }
    }
    const entries = activePopover.selectable;
    const count = entries.length;
    const currentIndex = activePopover.selectedKey
      ? entries.findIndex((entry) => entry.key === activePopover.selectedKey)
      : -1;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count > 0) {
      event.preventDefault();
      const next = event.key === "ArrowDown"
        ? (currentIndex + 1) % count
        : (currentIndex <= 0 ? count - 1 : currentIndex - 1);
      const nextKey = entries[next].key;
      const moveFocus = !inSearch && document.activeElement !== panel && list.contains(document.activeElement);
      activePopover.selectedKey = nextKey;
      renderPopover();
      if (moveFocus) focusElementForKey(panel, nextKey);
      list.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (!inSearch && (event.key === "ArrowRight" || event.key === "ArrowLeft") && currentIndex >= 0) {
      const selected = entries[currentIndex];
      if (selected?.item?.actions.length) {
        event.preventDefault();
        const moveFocus = document.activeElement !== panel && list.contains(document.activeElement);
        if (event.key === "ArrowRight") activePopover.expanded.add(selected.item.id);
        else {
          activePopover.expanded.delete(selected.item.id);
          if (selected.kind === "action") activePopover.selectedKey = itemSelectionKey(selected.item.id);
        }
        renderPopover();
        if (moveFocus && activePopover.selectedKey) focusElementForKey(panel, activePopover.selectedKey);
      }
      return;
    }
    if (event.key === "Enter") {
      // Allow focused buttons inside the popover to handle their own Enter click.
      if (document.activeElement && document.activeElement !== panel && document.activeElement !== search) return;
      event.preventDefault();
      event.stopPropagation();
      const selected = currentIndex >= 0 ? entries[currentIndex] : null;
      if (selected?.action && launcher.canLaunch) {
        runAction(launcher, selected.action);
      } else if (selected?.item?.actions.length) {
        toggleExpand(selected.item.id);
      } else if (!activePopover.query.trim() && menus.get(launcher.id)?.quickResume && launcher.canLaunch) {
        runAction(launcher, menus.get(launcher.id).quickResume);
      } else if (entries[0]?.action && launcher.canLaunch) {
        runAction(launcher, entries[0].action);
      }
    }
  });

  panel.addEventListener("toggle", (event) => {
    if (event.newState === "closed" && activePopover?.panel === panel) closePopover();
  });

  panel.showPopover({ source: button });
  position();
  window.addEventListener("resize", position);
  button.setAttribute("aria-expanded", "true");
  renderPopover();
  panel.focus();

  const cached = menus.get(launcher.id);
  if (!cached) {
    loadCached(launcher.id);
    void refreshLauncher(launcher.id, false);
  } else if (isStale(cached)) {
    void refreshLauncher(launcher.id, true);
  }
}

function triggerLauncher(launcher, button) {
  if (launcher.hasMenu) openPopover(launcher, button);
  else openExternalApp(launcher);
}

function onGlobalKeyDown(event) {
  const launchers = configuredLaunchers();
  if (!launchers.length) return;
  const target = event.target;
  if (target?.closest?.(TERMINAL)) return;
  const mac = isMacPlatform();
  for (const launcher of launchers) {
    const parsed = parseShortcut(launcher.shortcut);
    if (!parsed || !matchesShortcut(event, parsed, mac)) continue;
    const hasModifier = parsed.ctrl || parsed.alt || parsed.meta || parsed.mod;
    if (!hasModifier && isOtherTextField(target)) continue;
    const button = buttons.get(launcher.id);
    if (!button || !button.isConnected) continue;
    event.preventDefault();
    event.stopPropagation();
    triggerLauncher(launcher, button);
    return;
  }
}

function syncButtons() {
  const launchers = configuredLaunchers();
  const toolkit = document.querySelector("[data-workspace-titlebar-controls] > [data-t3tk-loaded]");
  if (!toolkit || !launchers.length) {
    closePopover();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
    return false;
  }

  ensureChannel();
  ensureHostEventHandler();
  const wantedIds = new Set(launchers.map((entry) => entry.id));
  for (const [id, button] of buttons) {
    if (!wantedIds.has(id)) {
      if (activePopover?.launcher.id === id) closePopover();
      button.remove();
      buttons.delete(id);
    }
  }

  for (const launcher of launchers) {
    let button = buttons.get(launcher.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "t3tk-loaded";
      button.dataset.t3tkQuickLauncher = launcher.id;
      const parsed = parseShortcut(launcher.shortcut);
      button.title = parsed ? `${launcher.label} (${parsed.label})` : launcher.label;
      button.setAttribute("aria-label", launcher.label);
      if (parsed) {
        button.setAttribute("aria-keyshortcuts", parsed.label);
        button.dataset.t3tkQlShortcut = parsed.label;
      }
      if (launcher.hasMenu) {
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", "false");
      } else if (launcher.canOpenApp) {
        button.dataset.t3tkQlOpen = launcher.id;
      }
      const label = document.createElement("span");
      label.textContent = launcher.label;
      button.append(launcherIcon(), label);
      button.addEventListener("click", () => triggerLauncher(launcher, button));
      buttons.set(launcher.id, button);
      if (launcher.hasMenu && !menus.has(launcher.id)) loadCached(launcher.id);
    }
    if (button.parentElement !== toolkit.parentElement || button.compareDocumentPosition(toolkit) & Node.DOCUMENT_POSITION_PRECEDING) {
      if (activePopover?.button === button) closePopover();
      toolkit.before(button);
    }
  }
  return true;
}

export function quickLauncherMenuHint() {
  const launchers = configuredLaunchers();
  if (!launchers.length) return { shortcut: null, hint: "Configure quickLaunchers in config.json" };
  const shortcuts = launchers.map((entry) => parseShortcut(entry.shortcut)?.label).filter(Boolean);
  return {
    shortcut: shortcuts[0] ?? null,
    hint: launchers.length === 1
      ? `${launchers[0].label} in the titlebar`
      : `${launchers.length} launchers in the titlebar`,
  };
}

export const quickLauncher = {
  id: "quick-launcher",
  title: "Quick launcher menus",
  surfaces: ["desktop"],
  sync() {
    if (!hasLauncher() || !configuredLaunchers().length) {
      this.stop();
      return "idle";
    }
    if (!keyListener) {
      keyListener = onGlobalKeyDown;
      window.addEventListener("keydown", keyListener, true);
    }
    return syncButtons() ? "ok" : "idle";
  },
  stop() {
    closePopover();
    if (keyListener) {
      window.removeEventListener("keydown", keyListener, true);
      keyListener = null;
    }
    for (const button of buttons.values()) button.remove();
    buttons.clear();
    channel?.close();
    channel = null;
    if (eventRegistered) {
      delete window.__t3tkLauncherEvent;
      eventRegistered = false;
    }
    refreshing.clear();
    errors.clear();
  },
};
