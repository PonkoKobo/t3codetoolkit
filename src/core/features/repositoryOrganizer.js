import { findPropsUp } from "../react.js";
import { arrangeRepositories, moveRepository, repositoryPreferences, repositoryScope } from "../repositoryPreferences.js";
import { toast } from "../styles.js";

export const VERSION_CONTROL_LIST = "section:has(> div > #thread-details-version-control-heading) > div:last-child";
export const REPOSITORY_ROW = 'div[role="group"].flex.flex-col:has(> button[aria-expanded])';
const STORAGE = "t3tk.thread-repository-view.";
const VISIBLE = 4;
const views = new Map();
const preferencesByScope = new Map();

function readPreferences(scope) {
  if (!preferencesByScope.has(scope)) {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE + scope));
    } catch {}
    preferencesByScope.set(scope, repositoryPreferences(saved));
  }
  return preferencesByScope.get(scope);
}

function hasPreferences(value) {
  return value.order.length + value.pinned.length + value.hidden.length > 0;
}

function savePreferences(view, value) {
  preferencesByScope.set(view.scope, value);
  try {
    if (hasPreferences(value)) localStorage.setItem(STORAGE + view.scope, JSON.stringify(value));
    else localStorage.removeItem(STORAGE + view.scope);
  } catch {
    toast("Repository preferences could only be saved for this session.");
  }
  syncRepositoryOrganizer();
}

function inspect(list) {
  const nativeChildren = [...list.children].filter((el) => !el.hasAttribute("data-t3tk-repo-control"));
  const rows = nativeChildren.flatMap((element) => {
    if (!element.matches(REPOSITORY_ROW)) return [];
    const row = findPropsUp(element, (p) => typeof p.sectionKey === "string" && typeof p.name === "string", 5);
    return row ? [{ element, key: row.sectionKey, name: row.name }] : [];
  });
  if (!rows.length) return null;

  const owner = findPropsUp(rows[0].element, (p) =>
    typeof p.environmentId === "string" && typeof p.projectId === "string" &&
    typeof p.threadId === "string" && typeof p.onTaskFolderChange === "function");
  if (!owner) return null;
  const tail = nativeChildren.slice(nativeChildren.indexOf(rows.at(-1).element) + 1);
  const disclosure = tail[0]?.matches("button[aria-expanded]:not([aria-haspopup])") ? tail[0] : null;
  return {
    rows, tail, disclosure, expanded: disclosure?.getAttribute("aria-expanded") === "true",
    scope: repositoryScope(owner.environmentId, owner.projectId), threadId: owner.threadId,
  };
}

function repositoryButton(text, onClick, className = "t3tk-btn") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  if (onClick) element.addEventListener("click", onClick);
  return element;
}

function clearDisplay(view) {
  view.list.removeAttribute("data-t3tk-repo-managed");
  for (const element of view.styled) {
    element.removeAttribute("data-t3tk-repo-hidden");
    element.removeAttribute("data-t3tk-repo-extra");
    element.removeAttribute("data-t3tk-repo-tail");
    element.style.removeProperty("--t3tk-repo-order");
  }
  view.styled.clear();
  view.more.remove();
}

function releaseExpansion(view) {
  if (view.expansion?.isConnected && view.expansion.getAttribute("aria-expanded") === "true") view.expansion.click();
  view.expansion = null;
  view.showAll = null;
}

function applyDisplay(view, state, value) {
  const ordered = arrangeRepositories(state.rows, value);
  const hidden = new Set(value.hidden);
  const visible = ordered.filter(({ key }) => !hidden.has(key));
  const overflow = new Set(visible.slice(VISIBLE).map(({ key }) => key));
  const elements = new Set([...ordered.map(({ element }) => element), ...state.tail]);
  if ([...view.styled].some((element) => !elements.has(element))) clearDisplay(view);
  view.styled = elements;
  view.list.setAttribute("data-t3tk-repo-managed", "");
  ordered.forEach(({ key, element }, index) => {
    const excluded = hidden.has(key);
    const beyondFirstRows = overflow.has(key);
    element.style.setProperty("--t3tk-repo-order", String(index + 2));
    element.toggleAttribute("data-t3tk-repo-extra", beyondFirstRows);
    element.toggleAttribute("data-t3tk-repo-hidden", excluded || (!view.showAll && beyondFirstRows));
  });
  for (const element of state.tail) {
    element.toggleAttribute("data-t3tk-repo-tail", true);
    element.toggleAttribute("data-t3tk-repo-hidden", element === state.disclosure);
  }

  if (visible.length > VISIBLE) {
    const label = view.showAll ? "Show fewer" : `Show ${visible.length - VISIBLE} more`;
    if (view.more.textContent !== label) view.more.textContent = label;
    const expanded = String(view.showAll);
    if (view.more.getAttribute("aria-expanded") !== expanded) view.more.setAttribute("aria-expanded", expanded);
    if (!view.more.isConnected) view.list.append(view.more);
  } else {
    view.more.remove();
  }
}

function toggle(keys, key) {
  return keys.includes(key) ? keys.filter((value) => value !== key) : [...keys, key];
}

function refreshDialog(view, rows, loading) {
  const { search, results, bulk, reset } = view.dialog;
  const value = readPreferences(view.scope);
  const term = search.value.trim().toLowerCase();
  const signature = JSON.stringify([rows.map(({ key, name }) => [key, name]), value, term, loading]);
  if (view.dialog.signature === signature) return;
  view.dialog.signature = signature;
  const focused = results.contains(document.activeElement) ? document.activeElement.dataset : null;
  const ordered = arrangeRepositories(rows, value);
  const pinned = new Set(value.pinned);
  const hidden = new Set(value.hidden);
  const matches = ordered.filter((row) => row.name.toLowerCase().includes(term));
  const shownMatches = matches.filter((row) => !hidden.has(row.key));
  bulk.disabled = loading || !term || shownMatches.length === 0;
  bulk.onclick = () => savePreferences(view, { ...value, hidden: [...value.hidden, ...shownMatches.map((row) => row.key)] });
  reset.disabled = !hasPreferences(value);
  if (loading || matches.length === 0) {
    const message = document.createElement("li");
    message.textContent = loading ? "Loading repositories…" : "No matching repositories.";
    results.replaceChildren(message);
    return;
  }

  const nameCounts = new Map();
  for (const { name } of rows) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  const tiers = [ordered.filter(({ key }) => !pinned.has(key)), ordered.filter(({ key }) => pinned.has(key))];
  let focusTarget;
  const items = matches.map((row) => {
    const isPinned = pinned.has(row.key);
    const isHidden = hidden.has(row.key);
    const tier = tiers[Number(isPinned)];
    const index = tier.indexOf(row);
    const label = document.createElement("div");
    label.className = "t3tk-repo-name";
    const name = document.createElement("span");
    name.textContent = row.name;
    label.append(name);
    if (nameCounts.get(row.name) > 1) {
      const path = document.createElement("small");
      path.textContent = row.key;
      label.append(path);
    }
    label.title = row.key;
    const item = document.createElement("li");
    item.toggleAttribute("data-hidden", isHidden);
    const action = (id, text, description, change, disabled = false) => {
      const control = repositoryButton(text, () => savePreferences(view, change()));
      const target = nameCounts.get(row.name) > 1 ? `${row.name} (${row.key})` : row.name;
      control.setAttribute("aria-label", `${description} ${target}`);
      control.title = description;
      control.dataset.action = id;
      control.dataset.key = row.key;
      control.disabled = disabled;
      if (focused?.key === row.key && focused.action === id) focusTarget = disabled ? item : control;
      return control;
    };
    const pin = action("pin", isPinned ? "Unpin" : "Pin", isPinned ? "Unpin" : "Pin to top", () => ({ ...value, pinned: toggle(value.pinned, row.key) }));
    pin.toggleAttribute("data-active", isPinned);
    item.tabIndex = -1;
    item.append(
      label, pin,
      action("up", "↑", "Move up", () => moveRepository(rows, value, row.key, -1), index === 0),
      action("down", "↓", "Move down", () => moveRepository(rows, value, row.key, 1), index === tier.length - 1),
      action("hide", isHidden ? "Show" : "Hide", isHidden ? "Show" : "Hide", () => ({ ...value, hidden: toggle(value.hidden, row.key) })),
    );
    return item;
  });
  results.replaceChildren(...items);
  focusTarget?.focus();
}

function closeDialog(view) {
  const dialog = view.dialog;
  if (!dialog) return;
  view.dialog = null;
  dialog.element.close();
  dialog.element.remove();
}

function openDialog(view) {
  if (view.dialog) return;
  const element = document.createElement("dialog");
  element.className = "t3tk-repo-dialog";
  element.setAttribute("data-t3tk-repo-control", "");
  element.setAttribute("aria-label", "Organize repositories for this project folder");
  const header = document.createElement("header");
  const heading = document.createElement("h2");
  heading.textContent = "Organize repositories";
  const done = repositoryButton("Done", () => {
    closeDialog(view);
    syncRepositoryOrganizer();
    view.organize.focus();
  });
  header.append(heading, done);

  const tools = document.createElement("div");
  tools.className = "t3tk-repo-tools";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Filter repositories";
  search.setAttribute("aria-label", "Filter repositories");
  search.addEventListener("input", () => syncRepositoryOrganizer());
  const bulk = repositoryButton("Hide matches");
  const reset = repositoryButton("Reset layout", () => savePreferences(view, repositoryPreferences()));
  tools.append(search, bulk, reset);
  const results = document.createElement("ul");
  element.append(header, tools, results);
  element.addEventListener("cancel", (event) => { event.preventDefault(); done.click(); });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); done.click(); }
  });
  view.dialog = { element, search, results, bulk, reset, signature: "" };
  // Keep the modal inside the native popover's DOM so it does not dismiss on focus-out.
  view.list.append(element);
  syncRepositoryOrganizer();
  if (view.dialog) { element.showModal(); search.focus(); }
}

function createView(list, state) {
  const view = { list, scope: state.scope, threadId: state.threadId, styled: new Set(), showAll: null, dialog: null, expansion: null };
  view.organize = repositoryButton("Organize repositories", () => openDialog(view), "t3tk-repo-organize");
  view.organize.setAttribute("aria-haspopup", "dialog");
  view.more = repositoryButton("", () => {
    view.showAll = !view.showAll;
    syncRepositoryOrganizer();
    if (!view.showAll && view.more.isConnected) view.more.scrollIntoView({ block: "nearest" });
  }, "t3tk-repo-more");
  for (const control of [view.organize, view.more]) control.setAttribute("data-t3tk-repo-control", "");
  views.set(list, view);
  return view;
}

function removeView(view, restoreNative) {
  closeDialog(view);
  clearDisplay(view);
  if (restoreNative) releaseExpansion(view);
  view.organize.remove();
  views.delete(view.list);
}

export function syncRepositoryOrganizer() {
  const found = new Set();
  for (const list of document.querySelectorAll(`[data-thread-details-card] ${VERSION_CONTROL_LIST}`)) {
    const state = inspect(list);
    if (!state) continue;
    found.add(list);
    let view = views.get(list);
    if (view && (view.threadId !== state.threadId || view.scope !== state.scope)) {
      removeView(view, false);
      view = null;
    }
    view ??= createView(list, state);
    const first = state.rows[0].element;
    if (first.previousElementSibling !== view.organize) first.before(view.organize);

    const value = readPreferences(view.scope);
    const managed = hasPreferences(value);
    if (!managed) clearDisplay(view);
    if (!managed && !view.dialog) {
      releaseExpansion(view);
      continue;
    }
    if (view.showAll === null) view.showAll = state.expanded;
    const loading = Boolean(state.disclosure && !state.expanded);
    if (loading && state.disclosure !== view.expansion) {
      view.expansion = state.disclosure;
      state.disclosure.click();
    }
    if (managed && !loading) applyDisplay(view, state, value);
    if (view.dialog) refreshDialog(view, state.rows, loading);
  }
  for (const [list, view] of views) {
    if (!found.has(list)) removeView(view, false);
  }
}

export function stopRepositoryOrganizer() {
  for (const view of views.values()) removeView(view, true);
}
