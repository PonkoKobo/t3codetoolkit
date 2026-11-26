import { compactButton } from "./features/compactButton.js";
import { effortShortcuts } from "./features/effortShortcuts.js";
import { imageAnnotate } from "./features/imageAnnotate.js";
import { arrangeFavorites } from "./features/arrangeFavorites.js";
import { modelSwitcher } from "./features/modelSwitcher.js";
import { projectSwitcher } from "./features/projectSwitcher.js";
import { imageGallery } from "./features/imageGallery.js";
import { projectColors } from "./features/projectColors.js";
import { threadRepositoryOverflow } from "./features/threadRepositoryOverflow.js";
import { projectThreadMenu } from "./features/projectThreadMenu.js";
import { sidebarProjectOrder } from "./features/sidebarProjectOrder.js";
import { closeAllAnnotators } from "./annotate/editor.js";
import { CSS, ICONS, toast } from "./styles.js";
import { askLauncher, hasLauncher } from "./launcher.js";

const VERSION = __T3TK_VERSION__;
// null for a clean build of the release tag; otherwise which GitHub release this build follows.
const BUILD = __T3TK_BUILD__;
const LABEL = BUILD ? `${VERSION}+dev` : VERSION;
const FEATURES = [compactButton, imageAnnotate, effortShortcuts, modelSwitcher, projectSwitcher, sidebarProjectOrder, arrangeFavorites, imageGallery, projectColors, projectThreadMenu];
const CHECKED_DESKTOP_VERSIONS = ["0.1.12", "0.1.13"];
const VERSION_FIXES = [threadRepositoryOverflow];
const DISABLED_KEY = "t3tk.disabled-features";
const MENU_COLUMNS = [
  [
    ["Chat & images", [
      [compactButton, "Compact button", "Shift+C", "in Thread Details"],
      [imageAnnotate, "Annotate images", "Shift+A", "in the image viewer"],
      [imageGallery, "Project image gallery"],
    ]],
    ["Models & effort", [
      [effortShortcuts, "Reasoning effort shortcuts", "Alt/Option + 1–6", "Hold or scroll for levels"],
      [modelSwitcher, "Favorite model shortcuts", "Ctrl+Alt + 1–9", "Hold for favorites"],
      [arrangeFavorites, "Arrange Favorites"],
    ]],
  ],
  [
    ["Projects & sidebar", [
      [projectSwitcher, "Open a thread in a pinned project", "Ctrl+Shift + 1–9", "Hold for projects"],
      [sidebarProjectOrder, "Match sidebar order to pinned shortcuts"],
      [projectColors, "Colour project names by icon"],
      [projectThreadMenu, "Project Show more / Show less", null, "Right-click a project"],
    ]],
    ["Thread Details", [[threadRepositoryOverflow, "Repository organizer & expansion"]]],
    ["Privacy"],
  ],
];

function menuSection(title) {
  const section = document.createElement("section");
  section.className = "t3tk-menu-section";
  const heading = document.createElement("h2");
  heading.className = "t3tk-menu-subheading";
  heading.textContent = title;
  section.append(heading);
  return section;
}

/** Features switched off in the toolkit menu, kept per browser or desktop profile. */
function readDisabled() {
  try {
    const value = JSON.parse(localStorage.getItem(DISABLED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeDisabled(ids) {
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...ids]));
    return true;
  } catch {
    return false;
  }
}

/** e.g. "Development build 7c96ed3, 3 commits after v0.1.1 with local changes." */
function buildNote({ tag, ahead, commit, dirty, untagged }) {
  const after = ahead ? `${ahead} commit${ahead === 1 ? "" : "s"} after v${tag}` : `v${tag}`;
  const note = `Development build ${commit}, ${after}${dirty ? " with local changes" : ""}.`;
  return untagged ? `${note} ${VERSION} isn't released on GitHub yet.` : note;
}

function boot(surface, hostVersion, paused = false) {
  if (window.__t3tk) return;
  // __T3TK_DISABLED__ (set by whoever loads the bundle) can't be switched back on from the menu.
  const forced = new Set(window.__T3TK_DISABLED__ ?? []);
  const available = FEATURES.filter((f) => f.surfaces.includes(surface));
  for (const fix of VERSION_FIXES) {
    if (surface === "desktop" && fix.hostVersions.includes(hostVersion)) available.push(fix);
  }
  if (paused) for (const feature of available) forced.add(feature.id);
  const disabled = new Set(readDisabled());
  const active = new Set(available.filter((f) => !forced.has(f.id) && !disabled.has(f.id)));
  const health = Object.fromEntries(available.map((f) => [f.id, active.has(f) ? "idle" : "off"]));

  const style = document.createElement("style");
  style.dataset.t3tk = LABEL;
  style.textContent = CSS;
  document.head.append(style);

  let timer = 0;
  let stopped = false;
  let menu = null;

  function setEnabled(id, on) {
    const feature = available.find((f) => f.id === id);
    if (!feature || forced.has(id) || active.has(feature) === on) return false;
    if (on) {
      active.add(feature);
      disabled.delete(id);
      health[id] = "idle";
      schedule();
    } else {
      active.delete(feature);
      disabled.add(id);
      health[id] = "off";
      try {
        feature.stop?.();
      } catch (error) {
        console.warn(`[t3tk] ${id} failed to stop`, error);
      }
    }
    if (!writeDisabled(disabled)) toast("Could not save this setting; it lasts until the app reloads.");
    return true;
  }

  function telemetrySection() {
    const section = menuSection("Privacy");
    const row = document.createElement("label");
    row.className = "t3tk-menu-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.disabled = true;
    const text = document.createElement("span");
    text.textContent = "Turn off T3 Code telemetry";
    const state = document.createElement("small");
    text.append(state);
    row.append(input, text);
    section.append(row);

    if (!hasLauncher()) {
      state.textContent = window.desktopBridge
        ? "Start T3 Code from the “T3 Code + Toolkit” entry to change this here."
        : "Set by the server you're connected to (T3CODE_TELEMETRY_ENABLED). See the toolkit README.";
      return section;
    }
    const show = (s) => {
      input.checked = s.offNextStart;
      input.disabled = Boolean(s.lockedBy);
      const now = s.offNow ? "Telemetry is off." : "Using T3 Code’s telemetry setting.";
      const lock = {
        "user-setting": "Turned off by the launch environment.",
        flag: "Set by the --keep-telemetry launch option.",
        "not-installed": "Install the toolkit to change this here.",
      }[s.lockedBy];
      const afterRestart = s.offNextStart
        ? "Telemetry will turn off after restart."
        : "T3 Code’s telemetry setting will apply after restart.";
      state.textContent = lock ? `${now} ${lock}` : s.offNow === s.offNextStart ? now : afterRestart;
    };
    state.textContent = "Checking…";
    askLauncher({ get: true }).then(show, (error) => (state.textContent = error.message));
    input.addEventListener("change", () => {
      const wanted = input.checked;
      input.disabled = true;
      askLauncher({ telemetryOff: wanted }).then(show, (error) => {
        input.checked = !wanted;
        input.disabled = false;
        state.textContent = error.message;
      });
    });
    return section;
  }

  function closeMenu() {
    if (!menu) return;
    menu.panel.remove();
    menu.button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", menu.outside, true);
    document.removeEventListener("keydown", menu.escape, true);
    window.removeEventListener("resize", menu.position);
    menu = null;
  }

  function openMenu(button) {
    const panel = document.createElement("div");
    panel.className = "t3tk-menu";
    panel.dataset.t3tkMenu = "";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Toolkit features");
    const heading = document.createElement("div");
    heading.className = "t3tk-menu-heading";
    heading.textContent = `T3CodeToolkit ${LABEL}`;
    if (BUILD) {
      const build = document.createElement("small");
      build.className = "t3tk-menu-build";
      build.textContent = buildNote(BUILD);
      heading.append(build);
    }
    if (paused) {
      const note = document.createElement("small");
      note.textContent = "Features paused for this desktop version. Your saved switches are preserved.";
      heading.append(note);
    }
    panel.append(heading);
    const grid = document.createElement("div");
    grid.className = "t3tk-menu-grid";
    for (const groups of MENU_COLUMNS) {
      const column = document.createElement("div");
      column.className = "t3tk-menu-column";
      for (const [title, entries] of groups) {
        if (!entries) {
          column.append(telemetrySection());
          continue;
        }
        const visible = entries.filter(([feature]) => available.includes(feature));
        if (!visible.length) continue;
        const section = menuSection(title);
        for (const entry of visible) appendFeature(section, ...entry);
        column.append(section);
      }
      grid.append(column);
    }
    panel.append(grid);

    function appendFeature(section, feature, label, shortcut, hint) {
      const row = document.createElement("label");
      row.className = "t3tk-menu-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.checked = active.has(feature);
      input.disabled = forced.has(feature.id);
      const text = document.createElement("span");
      text.textContent = label;
      if (shortcut || hint) {
        const detail = document.createElement("small");
        if (shortcut) {
          const key = document.createElement("kbd");
          key.textContent = shortcut;
          detail.append(key);
        }
        if (hint) detail.append(shortcut ? ` ${hint}` : hint);
        text.append(detail);
      }
      const state = document.createElement("small");
      const refresh = () => {
        state.textContent = paused ? "" : forced.has(feature.id) ? "Off (set by the loader)" : health[feature.id] === "broken" ? "Paused after an error" : "";
      };
      refresh();
      text.append(state);
      input.addEventListener("change", () => {
        setEnabled(feature.id, input.checked);
        input.checked = active.has(feature);
        refresh();
        if (feature.settings) {
          // Reopen so the feature's settings appear or go with its switch.
          const button = menu.button;
          closeMenu();
          openMenu(button);
          menu?.panel.querySelector(`[data-t3tk-feature="${feature.id}"]`)?.focus();
        }
      });
      input.dataset.t3tkFeature = feature.id;
      row.append(input, text);
      section.append(row);
      if (feature.settings && active.has(feature)) section.append(feature.settings());
    }
    document.body.append(panel);
    const position = () => {
      const box = button.getBoundingClientRect();
      const maxRight = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
      panel.style.top = `${Math.round(box.bottom + 6)}px`;
      panel.style.right = `${Math.min(maxRight, Math.max(8, Math.round(window.innerWidth - box.right)))}px`;
    };
    position();
    button.setAttribute("aria-expanded", "true");
    const outside = (event) => {
      if (!panel.contains(event.target) && !button.contains(event.target)) closeMenu();
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      button.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", position);
    menu = { panel, button, outside, escape, position };
    panel.querySelector("input:not(:disabled)")?.focus();
  }

  function toggleMenu(button) {
    const wasOpen = menu?.button === button;
    closeMenu();
    if (!wasOpen) openMenu(button);
  }

  function syncMenuButton() {
    const slots = [...document.querySelectorAll("[data-workspace-titlebar-controls]")];
    const needsFallback = paused && slots.length === 0;
    if (needsFallback) slots.push(document.body);
    else document.querySelector("[data-t3tk-status-fallback]")?.remove();
    for (const controls of slots) {
      if (controls.querySelector(":scope > [data-t3tk-loaded]")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "t3tk-loaded";
      button.dataset.t3tkLoaded = "";
      if (needsFallback) button.dataset.t3tkStatusFallback = "";
      button.title = paused ? "Toolkit features are disabled for this session" : `T3CodeToolkit ${LABEL}: turn features on or off`;
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.innerHTML = `${ICONS.hammer}<span>${paused ? "Toolkit disabled" : "Toolkit"}</span>`;
      button.addEventListener("click", () => toggleMenu(button));
      controls.prepend(button);
    }
    if (menu && !menu.button.isConnected) closeMenu();
  }

  const sync = () => {
    timer = 0;
    if (stopped) return;
    syncMenuButton();
    for (const feature of active) {
      try {
        health[feature.id] = feature.sync();
      } catch (error) {
        // A changed upstream layout disables just this feature; the app keeps working.
        active.delete(feature);
        try { feature.stop?.(); } catch {}
        health[feature.id] = "broken";
        console.warn(`[t3tk] ${feature.id} failed`, error);
      }
    }
  };
  function schedule() {
    if (timer || stopped) return;
    // A timer rather than requestAnimationFrame: rAF never fires in background tabs/windows.
    timer = setTimeout(sync, 50);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-busy", "aria-pressed", "data-state", "aria-current", "aria-expanded"] });
  for (const feature of paused ? [] : available) {
    try {
      feature.init?.({ resync: schedule });
    } catch (error) {
      active.delete(feature);
      health[feature.id] = "broken";
      console.warn(`[t3tk] ${feature.id} failed to start`, error);
    }
  }
  schedule();

  window.__t3tk = {
    version: VERSION,
    build: BUILD,
    surface,
    get features() { return available.map((f) => ({ id: f.id, title: f.title })); },
    enabled: () => available.filter((f) => active.has(f)).map((f) => f.id),
    health: () => ({ ...health }),
    setEnabled,
    stop() {
      stopped = true;
      observer.disconnect();
      clearTimeout(timer);
      closeMenu();
      closeAllAnnotators();
      for (const feature of active) feature.stop?.();
      document.querySelectorAll("[data-t3tk-loaded],[data-t3tk-compact],[data-t3tk-annotate],[data-t3tk-carousel],style[data-t3tk]").forEach((el) => el.remove());
      document.querySelectorAll("[data-t3tk-thread-hidden]").forEach((el) => el.removeAttribute("data-t3tk-thread-hidden"));
      delete window.__t3tk;
    },
  };

  if (paused) toast("Toolkit is disabled for this session. You can keep using T3 Code.", 7000);
  console.info(`[t3tk] T3CodeToolkit ${LABEL}${BUILD ? ` (${buildNote(BUILD)})` : ""} (unofficial add-on) active on ${surface}`);
}

// Only run inside a T3 Code client; the content script and desktop injector may see other pages.
function looksLikeT3() {
  if (window.top !== window) return false; // never inside frames the app embeds
  return !!document.querySelector("#root") || location.protocol === "t3code:";
}

async function compatibilityChoice(version) {
  let choice;
  const key = `t3tk.compatibility.${VERSION}.${version || "unknown"}`;
  try { choice = sessionStorage.getItem(key); } catch {}
  if (choice !== "paused" && choice !== "try") {
    const prompt = document.createElement("aside");
    prompt.className = "t3tk-compatibility";
    prompt.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:min(360px,90vw);padding:16px;border-radius:8px;background:Canvas;color:CanvasText;box-shadow:0 2px 14px #0005;font:14px system-ui";
    prompt.setAttribute("aria-label", "Toolkit compatibility");
    const message = document.createElement("p");
    message.textContent = `Toolkit has not checked T3 Code ${version || "(version unknown)"}. You can keep working with features paused, or try your usual features for this session.`;
    prompt.append(message);
    choice = await new Promise(resolve => {
      for (const [label, value] of [["Continue with features paused", "paused"], ["Try my features", "try"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText = "margin:4px;padding:4px 8px;border:1px solid currentColor;border-radius:4px";
        button.addEventListener("click", () => resolve(value));
        prompt.append(button);
      }
      document.body.append(prompt);
    });
    prompt.remove();
    try { sessionStorage.setItem(key, choice); } catch {}
  }
  return choice;
}

async function start() {
  if (!looksLikeT3() || window.__t3tk || window.__t3tkStarting) return;
  if (!window.desktopBridge && !/^t3code(-dev)?:$/.test(location.protocol)) return boot("web");
  window.__t3tkStarting = true;
  let timeout;
  try {
    const state = await Promise.race([
      Promise.resolve().then(() => window.desktopBridge?.getUpdateState?.()).catch(() => null),
      new Promise(resolve => { timeout = setTimeout(() => resolve(null), 2500); }),
    ]);
    const version = state?.currentVersion;
    if (CHECKED_DESKTOP_VERSIONS.includes(version)) return boot("desktop", version);
    const choice = await compatibilityChoice(version);
    boot("desktop", version, choice === "paused");
  } finally {
    clearTimeout(timeout);
    delete window.__t3tkStarting;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
