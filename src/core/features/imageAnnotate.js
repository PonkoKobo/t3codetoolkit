import { closeAllAnnotators, openAnnotator } from "../annotate/editor.js";
import { captureVideoFrame } from "../annotate/videoFrame.js";
import { isOtherTextField } from "../effortKeys.js";
import { findPropsUp } from "../react.js";
import { annotateIcon, svgIcon } from "../icons.js";
import { toast } from "../styles.js";

const SHORTCUT = "Shift+A";
const AUTO_OPEN_KEY = "t3tk.annotate-on-open";
const AUTO_OPEN_LOAD_TIMEOUT = 2000;
const DIALOG = "[role='dialog']";
const VIDEO = "video[controls]:not([aria-hidden='true'])";
const VIDEO_EVENTS = ["loadeddata", "canplay", "seeking", "seeked", "emptied", "error"];
const HANDOFF = "data-t3tk-annotate-handoff";
const isDialogProps = (p) => p.preview && Array.isArray(p.preview.images) && typeof p.onClose === "function";
const isZoomableProps = (p) => typeof p.src === "string" && typeof p.name === "string" && "mimeType" in p;
const isFilePreviewProps = (p) => typeof p.name === "string" && "mimeType" in p && ("file" in p || "asset" in p);
const attempted = new WeakSet();
const videoControls = new Map();
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
  if (dialog?.querySelector(VIDEO)) return null;
  const img = dialog?.querySelector("img");
  if (!img) return null;
  const props = findPropsUp(img, isZoomableProps, 12);
  return { src: props?.src ?? img.currentSrc ?? img.src, name: props?.name ?? img.alt ?? "image", dialog };
}

async function closeMediaDialog(dialog, preview) {
  // Wait for the native viewer to release its focus trap before focusing the editor.
  preview.onClose();
  for (let i = 0; dialog.isConnected && i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !dialog.isConnected;
}

function mountVideoControls(video) {
  const player = video.parentElement;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const toolbar = document.createElement("span");
  toolbar.className = "t3tk-video-actions";

  const capture = document.createElement("button");
  capture.type = "button";
  capture.className = "t3tk-btn t3tk-media-btn";
  capture.append(svgIcon(["M3 7h4l2-3h6l2 3h4v13H3z", "M16 13a4 4 0 1 1-8 0 4 4 0 1 1 8 0"]), "Screenshot & annotate");
  toolbar.append(capture);

  let busy = false;
  const canCapture = () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && !video.seeking && !video.error && video.videoWidth > 0 && video.videoHeight > 0;
  function updateCapture() {
    capture.disabled = busy || !canCapture();
    capture.title = busy ? "Capturing frame…" : capture.disabled
      ? "Play the video or wait for the current frame to load"
      : "Pause and annotate the current video frame";
  }
  for (const event of VIDEO_EVENTS) video.addEventListener(event, updateCapture, { signal });
  updateCapture();
  capture.addEventListener("click", async () => {
    if (signal.aborted || busy || !canCapture() || document.querySelector(".t3tk-overlay")) return;
    video.pause();
    const time = video.currentTime;
    const source = video.currentSrc;
    const dialog = video.closest(DIALOG);
    const attempt = ++latestAttempt;
    const stillCurrent = () => !signal.aborted && attempt === latestAttempt && video.isConnected
      && video.currentSrc === source && video.currentTime === time && video.paused && !video.seeking;
    busy = true;
    updateCapture();
    let url;
    try {
      const frame = await captureVideoFrame(video, time, signal);
      if (!stillCurrent()) return;
      const stem = (video.getAttribute("aria-label") || "Video").replace(/\.[^./\\]+$/, "");
      const seconds = time.toFixed(3);
      url = URL.createObjectURL(frame);
      await openAnnotator({ src: url, name: `${stem} at ${seconds}s.png` }, async () => {
        if (!stillCurrent() || document.querySelector(".t3tk-overlay")) return false;
        if (document.fullscreenElement?.contains(video)) await document.exitFullscreen();
        if (!stillCurrent()) return false;
        const preview = dialog && findPropsUp(video, isDialogProps);
        return !preview || (await closeMediaDialog(dialog, preview) && attempt === latestAttempt);
      }, { loadTimeout: AUTO_OPEN_LOAD_TIMEOUT });
    } catch {
      if (stillCurrent()) toast("Couldn't capture this video frame.");
    } finally {
      if (url) URL.revokeObjectURL(url);
      busy = false;
      updateCapture();
    }
  }, { signal });

  // A fullscreen video hides sibling controls. Fullscreen its container so the capture button stays visible.
  const full = document.createElement("button");
  const canFullscreen = document.fullscreenEnabled && typeof player.requestFullscreen === "function";
  const replaceNativeFullscreen = canFullscreen && video.controlsList?.supports("nofullscreen")
    && !video.controlsList.contains("nofullscreen");
  if (canFullscreen) {
    if (replaceNativeFullscreen) video.controlsList.add("nofullscreen");
    full.type = "button";
    full.className = "t3tk-btn t3tk-media-btn";
    function updateFullscreen() {
      const active = document.fullscreenElement === player;
      full.title = active ? "Exit fullscreen" : "Fullscreen";
      full.setAttribute("aria-label", full.title);
      full.replaceChildren(svgIcon([active
        ? "M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6"
        : "M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"]));
    }
    updateFullscreen();
    document.addEventListener("fullscreenchange", updateFullscreen, { signal });
    full.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement === player) await document.exitFullscreen();
        else await player.requestFullscreen();
      } catch {
        if (replaceNativeFullscreen) video.controlsList.remove("nofullscreen");
        toast("Couldn't switch video fullscreen.");
      }
    }, { signal });
    toolbar.append(full);
  }
  player.dataset.t3tkVideoPlayer = "";
  player.append(toolbar);
  return {
    toolbar,
    dispose() {
      lifetime.abort();
      if (document.fullscreenElement === player) void document.exitFullscreen().catch(() => {});
      toolbar.remove();
      delete player.dataset.t3tkVideoPlayer;
      if (replaceNativeFullscreen) video.controlsList.remove("nofullscreen");
    },
  };
}

function syncVideoControls() {
  const players = new Set([...document.querySelectorAll(VIDEO)].filter((video) =>
    (video.closest(DIALOG) && findPropsUp(video, isDialogProps)) || findPropsUp(video, isFilePreviewProps)));
  for (const [video, controls] of videoControls) {
    if (players.has(video) && controls.toolbar.parentElement === video.parentElement) continue;
    controls.dispose();
    videoControls.delete(video);
  }
  for (const video of players) {
    if (!videoControls.has(video)) videoControls.set(video, mountVideoControls(video));
  }
  return players.size > 0;
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
      return await closeMediaDialog(dialog, preview) && attempt === latestAttempt && (!automatic || autoOpen);
    }, { loadTimeout: automatic ? AUTO_OPEN_LOAD_TIMEOUT : undefined });
  } finally {
    if (automatic) dialog.removeAttribute(HANDOFF);
    button.disabled = false;
  }
}

export const imageAnnotate = {
  id: "image-annotate",
  title: "Annotate images and video frames",
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
    const hasVideo = syncVideoControls();
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
    return bars.length > 0 || hasVideo ? "ok" : "idle";
  },
  stop() {
    stopAutoOpen();
    window.removeEventListener("keydown", onKeyDown, true);
    closeAllAnnotators();
    for (const controls of videoControls.values()) controls.dispose();
    videoControls.clear();
    document.querySelectorAll("[data-t3tk-annotate]").forEach((button) => button.remove());
  },
};
