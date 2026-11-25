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
const VERSION_FIXES = [threadRepositoryOverflow];
const DISABLED_KEY = "t3tk.disabled-features";

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

function boot() {
  if (window.__t3tk) return;
  const surface = window.desktopBridge ? "desktop" : "web";
  // __T3TK_DISABLED__ (set by whoever loads the bundle) can't be switched back on from the menu.
  const forced = new Set(window.__T3TK_DISABLED__ ?? []);
  const available = FEATURES.filter((f) => f.surfaces.includes(surface));
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
    const section = document.createElement("div");
    section.className = "t3tk-menu-section";
    const heading = document.createElement("div");
    heading.className = "t3tk-menu-subheading";
    heading.textContent = "Privacy";
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
    section.append(heading, row);

    if (!hasLauncher()) {
      state.textContent = window.desktopBridge
        ? "Start T3 Code from the “T3 Code + Toolkit” entry to change this here."
        : "Set by the server you're connected to (T3CODE_TELEMETRY_ENABLED). See the toolkit README.";
      return section;
    }
    const show = (s) => {
      input.checked = s.offNextStart;
      input.disabled = Boolean(s.lockedBy);
      const now = s.offNow ? "Off now" : "On now";
      const lock = {
        "user-setting": "Turned off for your user account by scripts/telemetry.",
        flag: "Set by the --keep-telemetry launch option.",
        "not-installed": "Install the toolkit to change this here.",
      }[s.lockedBy];
      state.textContent = lock ? `${now}. ${lock}` : s.offNow === s.offNextStart ? now : `${now}; ${s.offNextStart ? "off" : "on"} after T3 Code restarts.`;
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
    const note = document.createElement("small");
    note.textContent = "Unofficial add-on. Switches apply now and are saved in this client.";
    heading.append(note);
    panel.append(heading);
    for (const feature of available) {
      const row = document.createElement("label");
      row.className = "t3tk-menu-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.checked = active.has(feature);
      input.disabled = forced.has(feature.id);
      const text = document.createElement("span");
      text.textContent = feature.title;
      const state = document.createElement("small");
      const refresh = () => {
        state.textContent = forced.has(feature.id) ? "Off (set by the loader)" : active.has(feature) ? "On" : "Off";
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
      panel.append(row);
      if (feature.settings && active.has(feature)) panel.append(feature.settings());
    }
    panel.append(telemetrySection());
    document.body.append(panel);
    const box = button.getBoundingClientRect();
    panel.style.top = `${Math.round(box.bottom + 6)}px`;
    panel.style.right = `${Math.max(8, Math.round(window.innerWidth - box.right))}px`;
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
    menu = { panel, button, outside, escape };
    panel.querySelector("input:not(:disabled)")?.focus();
  }

  function toggleMenu(button) {
    const wasOpen = menu?.button === button;
    closeMenu();
    if (!wasOpen) openMenu(button);
  }

  function syncMenuButton() {
    for (const controls of document.querySelectorAll("[data-workspace-titlebar-controls]")) {
      if (controls.querySelector(":scope > [data-t3tk-loaded]")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "t3tk-loaded";
      button.dataset.t3tkLoaded = "";
      button.title = `T3CodeToolkit ${LABEL}: turn features on or off`;
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.innerHTML = `${ICONS.hammer}<span>Toolkit</span>`;
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
  for (const feature of available) {
    try {
      feature.init?.({ resync: schedule });
    } catch (error) {
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

  // The desktop bridge reports the installed app version, even if the window
  // is connected to a server on a different release. Unknown versions get no fixes.
  if (surface === "desktop") {
    Promise.resolve().then(() => window.desktopBridge.getUpdateState?.()).then((state) => {
      if (stopped) return;
      for (const fix of VERSION_FIXES) {
        if (fix.hostVersion !== state?.currentVersion || !fix.surfaces.includes(surface)) continue;
        available.push(fix);
        const enabled = !forced.has(fix.id) && !disabled.has(fix.id);
        health[fix.id] = enabled ? "idle" : "off";
        if (enabled) active.add(fix);
      }
      schedule();
    }).catch(() => {});
  }
  console.info(`[t3tk] T3CodeToolkit ${LABEL}${BUILD ? ` (${buildNote(BUILD)})` : ""} (unofficial add-on) active on ${surface}`);
}

// Only run inside a T3 Code client; the content script and desktop injector may see other pages.
function looksLikeT3() {
  if (window.top !== window) return false; // never inside frames the app embeds
  return !!document.querySelector("#root") || location.protocol === "t3code:";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => looksLikeT3() && boot(), { once: true });
} else if (looksLikeT3()) {
  boot();
}
