import { closeAllAnnotators, openAnnotator } from "../annotate/editor.js";
import { isOtherTextField } from "../effortKeys.js";
import { findPropsUp } from "../react.js";
import { ICONS, toast } from "../styles.js";

const SHORTCUT = "Shift+A";
const isDialogProps = (p) => p.preview && Array.isArray(p.preview.images) && typeof p.onClose === "function";
const isZoomableProps = (p) => typeof p.src === "string" && typeof p.name === "string" && "mimeType" in p;

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
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  button.click();
}

export const imageAnnotate = {
  id: "image-annotate",
  title: "Annotate images in the image viewer",
  surfaces: ["web", "desktop"],
  sync() {
    const bars = captionBars();
    // Registering the same listener on subsequent syncs is idempotent.
    if (bars.length) window.addEventListener("keydown", onKeyDown, true);
    else window.removeEventListener("keydown", onKeyDown, true);
    for (const bar of bars) {
      const hasImage = !!bar.closest("[role='dialog']")?.querySelector("img");
      let button = bar.querySelector("[data-t3tk-annotate]");
      if (!hasImage) {
        button?.remove();
        continue;
      }
      if (button) continue;
      button = document.createElement("button");
      button.type = "button";
      button.className = "t3tk-btn t3tk-media-btn";
      button.dataset.t3tkAnnotate = "";
      button.title = `Draw and comment on this image, then add it to your message (${SHORTCUT})`;
      button.setAttribute("aria-keyshortcuts", SHORTCUT);
      button.innerHTML = `${ICONS.annotate}<span>Annotate</span><kbd aria-hidden="true">${SHORTCUT}</kbd>`;
      button.addEventListener("click", () => {
        const image = currentImage(bar);
        if (!image?.src) return toast("Couldn't find the image to annotate.");
        // Close the viewer first: its focus trap would otherwise keep focus from the note fields.
        findPropsUp(bar, isDialogProps)?.onClose();
        void openAnnotator(image);
      });
      bar.append(button);
    }
    return bars.length > 0 ? "ok" : "idle";
  },
  stop() {
    window.removeEventListener("keydown", onKeyDown, true);
    closeAllAnnotators();
    document.querySelectorAll("[data-t3tk-annotate]").forEach((button) => button.remove());
  },
};
