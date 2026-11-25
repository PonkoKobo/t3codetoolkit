import { findPropsUp } from "../react.js";
import { dominantColor, parseRgb, readableColor } from "../projectColors.js";

// Colours each project's name with its icon's colour: the sidebar's project folders and the new-thread
// heading ("What should we build in <project>?"). A grey icon keeps the default colour; "No project"
// and other heading names without a coloured icon use the theme's foreground colour (white when dark).
//
// Upstream markup used: a folder header is `button[data-sidebar-row="folder:<projectKey>"]` holding
// the ProjectFavicon (an <img>, or a span/svg coloured by its class), then the name span. The draft
// heading's picker is `[data-draft-project-trigger]`, whose combobox value is { value: projectKey, label }.

const FOLDER = 'li[data-testid="sidebar-project-folder"] button[data-sidebar-row^="folder:"]';
const TRIGGER = "[data-draft-project-trigger]";
const MARK = "t3tkProjectColor";

/** Image src → readable colour (string), null (grey/unreadable) or "pending". */
const imageColors = new Map();
/** Project key / name → colour, kept across syncs so the heading stays coloured when the sidebar is hidden. */
const byKey = new Map();
const byName = new Map();
let probe = null;

/** Any CSS colour (upstream's palette is oklch) → [r, g, b], through a 1×1 canvas. */
function toRgb(cssColor) {
  const direct = parseRgb(cssColor);
  if (direct || !cssColor) return direct;
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = cssColor;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return a ? [r, g, b] : null;
}
let stopped = false;
let rerun = 0;

function scheduleRerun() {
  if (stopped || rerun) return;
  rerun = requestAnimationFrame(() => {
    rerun = 0;
    if (!stopped) projectColors.sync();
  });
}

function pixelsOf(img) {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data; // throws if the image is cross-origin
}

/** Reads the colour of a favicon <img>; the result lands in imageColors and triggers a resync. */
function measureImage(img) {
  const src = img.currentSrc || img.src;
  if (!src || imageColors.has(src)) return;
  imageColors.set(src, "pending");
  const finish = (color) => {
    imageColors.set(src, color);
    scheduleRerun();
  };
  const fromLoaded = (image) => readableColor(dominantColor(pixelsOf(image)));
  const ready = img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode();
  ready
    .then(() => finish(fromLoaded(img)))
    .catch(() => {
      // A favicon served from another origin taints the canvas; retry with a CORS request.
      const copy = new Image();
      copy.crossOrigin = "anonymous";
      copy.onload = () => {
        try {
          finish(fromLoaded(copy));
        } catch {
          finish(null);
        }
      };
      copy.onerror = () => finish(null);
      copy.src = src;
    });
}

/** The readable colour of a ProjectFavicon element, null for grey/emoji icons, "pending" while an image loads. */
function iconColor(icon) {
  if (!icon) return null;
  const img = icon.matches("img") ? icon : icon.querySelector("img:not(.hidden)");
  if (img) {
    measureImage(img);
    return imageColors.get(img.currentSrc || img.src) ?? "pending";
  }
  const svg = icon.matches("svg") ? icon : icon.querySelector("svg");
  return svg ? readableColor(toRgb(getComputedStyle(svg).color)) : null;
}

function paint(el, color) {
  if (!color) {
    if (el.dataset[MARK] !== undefined) {
      el.style.removeProperty("color");
      delete el.dataset[MARK];
    }
    return;
  }
  if (el.dataset[MARK] !== color) {
    el.style.color = color;
    el.dataset[MARK] = color;
  }
}

function syncFolders() {
  const rows = document.querySelectorAll(FOLDER);
  for (const row of rows) {
    const label = row.querySelector(":scope > span.truncate");
    if (!label) continue;
    // The favicon is the row child just before the name.
    const icon = label.previousElementSibling;
    const color = iconColor(icon);
    if (color === "pending") continue;
    paint(label, color);
    const key = row.dataset.sidebarRow.slice("folder:".length);
    const name = label.textContent.trim();
    if (color) {
      byKey.set(key, color);
      byName.set(name, color);
    } else {
      byKey.delete(key);
      byName.delete(name);
    }
  }
  return rows.length;
}

function syncHeading() {
  const trigger = document.querySelector(TRIGGER);
  if (!trigger) return 0;
  const combobox = findPropsUp(trigger, (p) => typeof p.onValueChange === "function" && Array.isArray(p.items), 40);
  const value = combobox?.value;
  const name = trigger.textContent.trim();
  const color = (value?.value && byKey.get(value.value)) || byName.get(name) || null;
  // No project, or a grey icon: the theme's foreground (white on the dark theme), not the picker's muted tone.
  paint(trigger, color ?? "var(--foreground)");
  return 1;
}

export const projectColors = {
  id: "project-colors",
  title: "Colour project names with their icon colour",
  surfaces: ["web", "desktop"],
  sync() {
    stopped = false;
    const found = syncFolders() + syncHeading();
    return found ? "ok" : "idle";
  },
  stop() {
    stopped = true;
    cancelAnimationFrame(rerun);
    rerun = 0;
    for (const el of document.querySelectorAll("[data-t3tk-project-color]")) {
      el.style.removeProperty("color");
      delete el.dataset[MARK];
    }
  },
};
