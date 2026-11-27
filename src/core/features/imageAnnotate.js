import { closeAllAnnotators, openAnnotator } from "../annotate/editor.js";
import { isOtherTextField } from "../effortKeys.js";
import { findPropsUp } from "../react.js";
import { annotateIcon } from "../icons.js";
import { toast } from "../styles.js";

const SHORTCUT = "Shift+A";
const AUTO_OPEN_KEY = "t3tk.annotate-on-open";
const AUTO_OPEN_LOAD_TIMEOUT = 2000;
const DIALOG = "[role='dialog']";
const HANDOFF = "data-t3tk-annotate-handoff";
const isDialogProps = (p) => p.preview && Array.isArray(p.preview.images) && typeof p.onClose === "function";
const isZoomableProps = (p) => typeof p.src === "string" && typeof p.name === "string" && "mimeType" in p;
const attempted = new WeakSet();
let autoOpen;
let autoOpenObserver;
let latestAttempt = 0;
let resync = () => {};

function autoOpenSettings() {
  const row = document.createElement("label");
  row.className = "t3tk-menu-row t3tk-menu-suboption";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = autoOpen;
  input.addEventListener("change", () => {
    autoOpen = input.checked;
    try {
      localStorage.setItem(AUTO_OPEN_KEY, String(autoOpen));
    } catch {
      toast("Could not save this setting; it lasts until the app reloads.");
    }
    if (autoOpen) imageAnnotate.sync();
    else stopAutoOpen();
    resync();
  });
  row.append(input, "Open images directly in annotation mode");
  return row;
}

/** Caption bars of open expanded-image dialogs: the live region under the image. */
function captionBars() {
  const bars = [];
  for (const live of document.querySelectorAll(`${DIALOG} span[aria-live='polite'][aria-atomic='true']`)) {
    if (findPropsUp(live, isDialogProps)) bars.push(live.parentElement);
  }
  return bars;
}

function currentImage(bar) {
  const dialog = bar.closest(DIALOG);
  const img = dialog?.querySelector("img");
  if (!img) return null;
  const props = findPropsUp(img, isZoomableProps, 12);
  return { src: props?.src ?? img.currentSrc ?? img.src, name: props?.name ?? img.alt ?? "image", dialog };
}

function onKeyDown(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) return;
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== "a") return;
  if (isOtherTextField(event.target) || document.querySelector(".t3tk-overlay")) return;
  const scope = event.target?.closest?.(DIALOG) ?? document;
  const button = scope.querySelector("[data-t3tk-annotate]");
  if (!button || button.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  button.click();
}

function observeAutoOpen() {
  if (!autoOpen || autoOpenObserver) return;
  // The general Toolkit scan is debounced. Handle new previews before the browser can paint them.
  autoOpenObserver = new MutationObserver((records) => {
    if (records.some(({ target, addedNodes }) => addedNodes.length && (
      target.closest(DIALOG) || [...addedNodes].some((node) =>
        node.nodeType === 1 && (node.matches(DIALOG) || node.querySelector(DIALOG)))
    ))) imageAnnotate.sync();
  });
  autoOpenObserver.observe(document.body, { childList: true, subtree: true });
}

function stopAutoOpen() {
  autoOpenObserver?.disconnect();
  autoOpenObserver = undefined;
  document.querySelectorAll(`[${HANDOFF}]`).forEach((dialog) => dialog.removeAttribute(HANDOFF));
}

async function annotate(bar, button, automatic = false) {
  const image = currentImage(bar);
  if (!image?.src || !findPropsUp(bar, isDialogProps)) return;
  const attempt = ++latestAttempt;
  const { dialog } = image;
  if (automatic) dialog.setAttribute(HANDOFF, "");
  button.disabled = true;
  try {
    await openAnnotator(image, async () => {
      // Keep the preview open if loading failed or the user moved to another image.
      if (attempt !== latestAttempt || (automatic && !dialog.hasAttribute(HANDOFF))
        || !bar.isConnected || currentImage(bar)?.src !== image.src) return false;
      const preview = findPropsUp(bar, isDialogProps);
      if (!preview) return false;
      // Wait for the native viewer to release its focus trap before focusing the editor.
      preview.onClose();
      for (let i = 0; dialog.isConnected && i < 40; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return !dialog.isConnected && attempt === latestAttempt && (!automatic || autoOpen);
    }, { loadTimeout: automatic ? AUTO_OPEN_LOAD_TIMEOUT : undefined });
  } finally {
    if (automatic) dialog.removeAttribute(HANDOFF);
    button.disabled = false;
  }
}

export const imageAnnotate = {
  id: "image-annotate",
  title: "Annotate images in the image viewer",
  surfaces: ["web", "desktop"],
  init(context) {
    resync = context.resync;
    try {
      autoOpen = localStorage.getItem(AUTO_OPEN_KEY) === "true";
    } catch {
      autoOpen = false;
    }
  },
  settings: autoOpenSettings,
  sync() {
    observeAutoOpen();
    const bars = captionBars();
    // Registering the same listener on subsequent syncs is idempotent.
    if (bars.length) window.addEventListener("keydown", onKeyDown, true);
    else window.removeEventListener("keydown", onKeyDown, true);
    for (const bar of bars) {
      const image = currentImage(bar);
      let button = bar.querySelector("[data-t3tk-annotate]");
      if (!image?.src) {
        button?.remove();
        continue;
      }
      if (!button) {
        const control = document.createElement("button");
        control.type = "button";
        control.className = "t3tk-btn t3tk-media-btn";
        control.dataset.t3tkAnnotate = "";
        control.title = `Draw and comment on this image, then add it to your message (${SHORTCUT})`;
        control.setAttribute("aria-keyshortcuts", SHORTCUT);
        const label = document.createElement("span");
        label.textContent = "Annotate";
        const key = document.createElement("kbd");
        key.setAttribute("aria-hidden", "true");
        key.textContent = SHORTCUT;
        control.append(annotateIcon(), label, key);
        control.addEventListener("click", () => void annotate(bar, control));
        bar.append(control);
        button = control;
      }
      if (autoOpen && !button.disabled && !attempted.has(image.dialog) && !document.querySelector(".t3tk-overlay")) {
        attempted.add(image.dialog);
        void annotate(bar, button, true);
      }
    }
    return bars.length > 0 ? "ok" : "idle";
  },
  stop() {
    stopAutoOpen();
    window.removeEventListener("keydown", onKeyDown, true);
    closeAllAnnotators();
    document.querySelectorAll("[data-t3tk-annotate]").forEach((button) => button.remove());
  },
};
