import { closeAllAnnotators, openAnnotator } from "../annotate/editor.js";
import { isOtherTextField } from "../effortKeys.js";
import { findPropsUp } from "../react.js";
import { ICONS, toast } from "../styles.js";

const SHORTCUT = "Shift+A";
const AUTO_OPEN_KEY = "t3tk.annotate-on-open";
const isDialogProps = (p) => p.preview && Array.isArray(p.preview.images) && typeof p.onClose === "function";
const isZoomableProps = (p) => typeof p.src === "string" && typeof p.name === "string" && "mimeType" in p;
const attempted = new WeakSet();
let autoOpen;
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
    resync();
  });
  row.append(input, "Open images directly in annotation mode");
  return row;
}

/** Caption bars of open expanded-image dialogs: the live region under the image. */
function captionBars() {
  const bars = [];
  for (const live of document.querySelectorAll("[role='dialog'] span[aria-live='polite'][aria-atomic='true']")) {
    if (findPropsUp(live, isDialogProps)) bars.push(live.parentElement);
  }
  return bars;
}

function currentImage(bar) {
  const dialog = bar.closest("[role='dialog']");
  const img = dialog?.querySelector("img");
  if (!img) return null;
  const props = findPropsUp(img, isZoomableProps, 12);
  return { src: props?.src ?? img.currentSrc ?? img.src, name: props?.name ?? img.alt ?? "image", dialog };
}

function onKeyDown(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) return;
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== "a") return;
  if (isOtherTextField(event.target) || document.querySelector(".t3tk-overlay")) return;
  const scope = event.target?.closest?.("[role='dialog']") ?? document;
  const button = scope.querySelector("[data-t3tk-annotate]");
  if (!button || button.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  button.click();
}

async function annotate(bar, button) {
  const image = currentImage(bar);
  if (!image?.src || !findPropsUp(bar, isDialogProps)) return;
  button.disabled = true;
  try {
    await openAnnotator(image, async () => {
      // Keep the preview open if loading failed or the user moved to another image.
      if (!bar.isConnected || currentImage(bar)?.src !== image.src) return false;
      const preview = findPropsUp(bar, isDialogProps);
      if (!preview) return false;
      // Wait for the native viewer to release its focus trap before focusing the editor.
      preview.onClose();
      for (let i = 0; image.dialog.isConnected && i < 40; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return !image.dialog.isConnected;
    });
  } finally {
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
        control.innerHTML = `${ICONS.annotate}<span>Annotate</span><kbd aria-hidden="true">${SHORTCUT}</kbd>`;
        control.addEventListener("click", () => void annotate(bar, control));
        bar.append(control);
        button = control;
      }
      if (autoOpen && !button.disabled && !attempted.has(image.dialog) && !document.querySelector(".t3tk-overlay")) {
        attempted.add(image.dialog);
        button.click();
      }
    }
    return bars.length > 0 ? "ok" : "idle";
  },
  stop() {
    window.removeEventListener("keydown", onKeyDown, true);
    closeAllAnnotators();
    document.querySelectorAll("[data-t3tk-annotate]").forEach((button) => button.remove());
  },
};
