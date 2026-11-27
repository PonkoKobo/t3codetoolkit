import { addToComposer, findComposer } from "../composer.js";
import { toast } from "../styles.js";

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff"];
const DISMISS_WINDOW_MS = 2000;
const CLICK_SLOP_PX = 6;
const TOOLS = [
  { id: "arrow", label: "Arrow", key: "a", path: "M5 19 19 5m-8 0h8v8" },
  { id: "pen", label: "Markup", key: "p", path: "M3 16c5-7 8-11 10-11 4 0-5 11-5 14 0 2 7-7 10-7 2 0 0 3 1 4 1 1 2 0 3-1" },
  { id: "box", label: "Box", key: "b", path: "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" },
  { id: "pin", label: "Comment", key: "n", path: "M20 14a3 3 0 0 1-3 3h-5l-5 4v-4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" },
];

async function loadImage(src) {
  // Drawing a cross-origin image taints the canvas and blocks export, so load it as a local blob.
  // The server's CORS policy admits the app's own origins.
  let url = src;
  let revoke = null;
  if (!src.startsWith("blob:") && !src.startsWith("data:")) {
    try {
      const response = await fetch(src, { credentials: "include" });
      if (!response.ok) throw new Error(String(response.status));
      url = URL.createObjectURL(await response.blob());
      revoke = url;
    } catch {
      url = src;
    }
  }
  const img = new Image();
  if (url === src) img.crossOrigin = "anonymous";
  try {
    // Load events, not img.decode(): decode() can stay pending forever in a background window.
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("image failed to load"));
      img.src = url;
    });
  } finally {
    if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 0);
  }
  return img;
}

function arrowHead(a, b, width) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = width * 4.5;
  const offset = (turn, length) => ({
    x: b.x - length * Math.cos(angle + turn),
    y: b.y - length * Math.sin(angle + turn),
  });
  return { stem: offset(0, head * 0.6), left: offset(-0.45, head), right: offset(0.45, head) };
}

function drawArrow(ctx, a, b, width) {
  const { stem, left, right } = arrowHead(a, b, width);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(stem.x, stem.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fill();
}

function drawBadge(ctx, p, n, color, size) {
  const r = size;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r / 7);
  ctx.strokeStyle = "rgba(0,0,0,.65)";
  ctx.stroke();
  ctx.fillStyle = color === "#ffffff" || color === "#ffcc00" ? "#111" : "#fff";
  ctx.font = `600 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), p.x, p.y + r * 0.05);
}

/** Where a shape's number badge sits: its start, nudged so it doesn't cover the mark. */
function badgePoint(shape, size) {
  if (shape.tool === "pin") return shape.points[0];
  const p = shape.points[0];
  return { x: p.x - size * 0.9, y: p.y - size * 0.9 };
}

/** Disposers of open or loading annotators, so the toolkit's stop() can close them. */
const live = new Set();
export function closeAllAnnotators() {
  for (const dispose of [...live]) dispose();
}

export async function openAnnotator({ src, name }, beforeOpen) {
  // Bind to the draft that was open when annotation started, not whichever is open at send time.
  const target = findComposer()?.editor ?? null;
  const returnFocus = document.activeElement;
  let cancelled = false;
  const cancelLoad = () => (cancelled = true);
  live.add(cancelLoad);
  let img;
  try {
    img = await loadImage(src);
    if (cancelled || (beforeOpen && !(await beforeOpen()))) return;
  } catch {
    if (!cancelled) toast("Couldn't open this image for annotation.");
    return;
  } finally {
    live.delete(cancelLoad);
  }
  if (cancelled) return;
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const base = Math.max(W, H);
  const lineWidth = Math.max(3, Math.round(base / 320));
  const badge = Math.max(11, Math.round(base / 70));
  const margin = Math.max(Math.ceil(badge * 2.5), Math.round(base * 0.045));
  const boardWidth = W + margin * 2;
  const boardHeight = H + margin * 2;

  let shapes = [];
  let selected = null;
  const undoStack = [];
  const redoStack = [];
  let tool = "arrow";
  // 1 fits the whole image in the window; larger values zoom in and the board scrolls.
  let zoom = 1;
  let color = COLORS[0];
  let drawing = null;

  const root = document.createElement("div");
  root.className = "t3tk-overlay t3tk-annotate";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", `Annotate ${name}`);
  root.innerHTML = `
    <div class="t3tk-annotate-bar">
      <span class="t3tk-annotate-title"></span>
      <span class="t3tk-hint">Point an arrow, then say what should change. Click a number to edit its note. Ctrl+scroll zooms; Ctrl+Alt+←/→ switches tools.</span>
      <button type="button" class="t3tk-btn" data-act="copy" title="Copy the annotated image">Copy image</button>
      <button type="button" class="t3tk-btn" data-act="cancel" title="Close (Esc)">Cancel</button>
    </div>
    <div class="t3tk-stage">
      <div class="t3tk-board"><canvas tabindex="-1" aria-label="Drawing area"></canvas></div>
      <div class="t3tk-annotate-dock">
        <div class="t3tk-annotate-tools">
          <div role="group" aria-label="Annotation tools">
            ${TOOLS.map(({ id, label, key, path }) => `<button type="button" class="t3tk-btn" data-tool="${id}" title="${label} (${key.toUpperCase()})"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>${label}</button>`).join("")}
          </div>
          <div role="group" aria-label="Ink colors">
            ${COLORS.map((c) => `<button type="button" class="t3tk-swatch" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}
          </div>
          <div role="group" aria-label="Edit marks">
            <button type="button" class="t3tk-btn" data-act="undo" title="Undo (Ctrl/⌘+Z)" aria-keyshortcuts="Control+Z Meta+Z" disabled>Undo</button>
            <button type="button" class="t3tk-btn" data-act="redo" title="Redo (Ctrl+Y or Ctrl/⌘+Shift+Z)" aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z" disabled>Redo</button>
            <button type="button" class="t3tk-btn" data-act="clear" disabled>Clear</button>
          </div>
          <div role="group" aria-label="Zoom">
            <button type="button" class="t3tk-btn" data-act="zoom-out" title="Zoom out (Ctrl+scroll or Ctrl+−)" aria-label="Zoom out">−</button>
            <button type="button" class="t3tk-btn" data-act="zoom-fit" title="Fit to window (Ctrl+0)">Fit</button>
            <button type="button" class="t3tk-btn" data-act="zoom-in" title="Zoom in (Ctrl+scroll or Ctrl+=)" aria-label="Zoom in">+</button>
          </div>
        </div>
        <div class="t3tk-annotate-composer">
          <textarea data-overall rows="1" aria-label="Overall note" placeholder="Describe edits (optional)"></textarea>
          <button type="button" class="t3tk-send" data-act="send" title="Add to message (Ctrl/⌘+Enter)" aria-label="Add to message" aria-keyshortcuts="Control+Enter Meta+Enter"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button>
        </div>
      </div>
    </div>
    <div class="t3tk-pop" role="group" hidden>
      <span class="t3tk-pop-num" aria-hidden="true"></span>
      <textarea rows="2" placeholder="What should change here?"></textarea>
      <button type="button" data-pop-remove title="Delete this mark">×</button>
    </div>
    <div class="t3tk-annotate-dismiss" role="status"></div>`;
  root.querySelector(".t3tk-annotate-title").textContent = name;

  const canvas = root.querySelector("canvas");
  canvas.width = boardWidth;
  canvas.height = boardHeight;
  canvas.style.setProperty("--board-width", `${boardWidth}px`);
  canvas.style.setProperty("--board-ratio", boardWidth / boardHeight);
  const ctx = canvas.getContext("2d");
  const board = root.querySelector(".t3tk-board");
  const stage = root.querySelector(".t3tk-stage");
  const dismissHint = root.querySelector(".t3tk-annotate-dismiss");
  const overall = root.querySelector("[data-overall]");
  const pop = root.querySelector(".t3tk-pop");
  const popNum = pop.querySelector(".t3tk-pop-num");
  const popText = pop.querySelector("textarea");
  let noteOpen = false;

  function render(target, left, top, marks, preview) {
    target.save();
    target.translate(-left, -top);
    target.drawImage(img, 0, 0, W, H);
    target.lineCap = "round";
    target.lineJoin = "round";
    const all = preview ? [...marks, preview] : marks;
    all.forEach((s) => {
      target.strokeStyle = s.color;
      target.fillStyle = s.color;
      target.lineWidth = lineWidth;
      const a = s.points[0];
      const b = s.points.at(-1);
      if (s.tool === "pen") {
        target.beginPath();
        s.points.forEach((p, i) => (i ? target.lineTo(p.x, p.y) : target.moveTo(p.x, p.y)));
        target.stroke();
      } else if (s.tool === "arrow") {
        drawArrow(target, a, b, lineWidth);
      } else if (s.tool === "box") {
        target.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
    });
    marks.forEach((s, i) => drawBadge(target, badgePoint(s, badge), i + 1, s.color, badge));
    target.restore();
  }

  function paint() {
    ctx.clearRect(0, 0, boardWidth, boardHeight);
    render(ctx, -margin, -margin, shapes, drawing);
    if (selected) {
      const { x, y } = badgePoint(selected, badge);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + margin, y + margin, badge * 1.22, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, badge / 5);
      ctx.strokeStyle = "#15161a";
      ctx.stroke();
      ctx.lineWidth /= 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.restore();
    }
  }

  function selectMark(mark) {
    selected = mark;
    paint();
  }

  /** Put the note bubble beside the selected mark's number, kept inside the window. */
  function placeNote() {
    if (pop.hidden || !selected) return;
    const r = canvas.getBoundingClientRect();
    const scale = r.width / boardWidth;
    const p = badgePoint(selected, badge);
    const cx = r.left + (p.x + margin) * scale;
    const cy = r.top + (p.y + margin) * scale;
    const gap = badge * scale + 10;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let x = cx + gap;
    if (x + w > window.innerWidth - 8) x = cx - gap - w;
    x = Math.min(window.innerWidth - w - 8, Math.max(8, x));
    const y = Math.min(window.innerHeight - h - 8, Math.max(8, cy - 18));
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
  }

  /** Show the note bubble for the selected mark, or hide it when there is none. */
  function syncNote({ focus = false } = {}) {
    const index = shapes.indexOf(selected);
    if (!noteOpen || index < 0) {
      noteOpen = false;
      pop.hidden = true;
      return;
    }
    popNum.textContent = String(index + 1);
    popNum.style.background = selected.color;
    popNum.style.color = selected.color === "#ffffff" || selected.color === "#ffcc00" ? "#111" : "#fff";
    if (popText.value !== selected.note) popText.value = selected.note;
    popText.setAttribute("aria-label", `Note for mark ${index + 1}`);
    pop.querySelector("[data-pop-remove]").setAttribute("aria-label", `Delete mark ${index + 1}`);
    pop.hidden = false;
    placeNote();
    if (focus) popText.focus({ preventScroll: true });
  }

  function openNote(mark) {
    selectMark(mark);
    noteOpen = true;
    popText.value = mark.note;
    syncNote({ focus: true });
  }

  function closeNote() {
    noteOpen = false;
    syncNote();
    canvas.focus({ preventScroll: true });
  }

  popText.addEventListener("input", () => {
    if (selected) selected.note = popText.value;
  });
  pop.querySelector("[data-pop-remove]").addEventListener("click", () => removeMark(selected));

  function renderList() {
    root.querySelector("[data-act='undo']").disabled = undoStack.length === 0;
    root.querySelector("[data-act='redo']").disabled = redoStack.length === 0;
    root.querySelector("[data-act='clear']").disabled = shapes.length === 0;
    syncNote();
  }

  function editMarks(next, selection) {
    undoStack.push({ shapes, selected });
    redoStack.length = 0;
    shapes = next;
    selected = selection;
    paint();
    renderList();
  }

  function removeMark(mark) {
    if (!mark) return;
    const remaining = shapes.filter((shape) => shape !== mark);
    editMarks(remaining, selected === mark ? null : selected);
    canvas.focus({ preventScroll: true });
  }

  function restoreMarks(from, to) {
    const state = from.pop();
    if (!state) return;
    to.push({ shapes, selected });
    ({ shapes, selected } = state);
    paint();
    renderList();
    canvas.focus({ preventScroll: true });
  }

  const fitButton = root.querySelector("[data-act='zoom-fit']");
  /** Zoom to `next`, keeping the image point under (clientX, clientY) where it is. */
  function setZoom(next, clientX, clientY) {
    next = Math.min(8, Math.max(1, Math.round(next * 100) / 100));
    if (next === zoom) return;
    const before = canvas.getBoundingClientRect();
    const b = board.getBoundingClientRect();
    const x = clientX ?? b.left + b.width / 2;
    const y = clientY ?? b.top + b.height / 2;
    const fx = (x - before.left) / before.width;
    const fy = (y - before.top) / before.height;
    zoom = next;
    canvas.style.setProperty("--zoom", zoom);
    const after = canvas.getBoundingClientRect();
    board.scrollLeft += after.left + fx * after.width - x;
    board.scrollTop += after.top + fy * after.height - y;
    fitButton.textContent = zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;
    placeNote();
  }
  // Non-passive so Ctrl+wheel zooms the image instead of the whole app window.
  board.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
        return;
      }
      // When only the width overflows, a plain wheel scrolls left and right.
      const wide = board.scrollWidth > board.clientWidth;
      const tall = board.scrollHeight > board.clientHeight;
      if (wide && !tall && !e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        board.scrollLeft += e.deltaY;
      }
    },
    { passive: false },
  );
  board.addEventListener("scroll", placeNote, { passive: true });

  function selectTool(id) {
    tool = id;
    root.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === id));
  }
  function selectColor(c) {
    color = c;
    root.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.color === c));
  }

  const toImage = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.min(W + margin, Math.max(-margin, (e.clientX - r.left) * boardWidth / r.width - margin)),
      y: Math.min(H + margin, Math.max(-margin, (e.clientY - r.top) * boardHeight / r.height - margin)),
    };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary || drawing) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    const p = toImage(e);
    const mark = markAt(p);
    if (mark) {
      openNote(mark);
      return;
    }
    if (noteOpen) {
      noteOpen = false;
      syncNote();
    }
    canvas.setPointerCapture(e.pointerId);
    drawing = { tool, color, points: [p], note: "", pointerId: e.pointerId };
    if (tool === "pin") {
      const pin = drawing;
      drawing = null;
      editMarks([...shapes, pin], pin);
      openNote(pin);
    }
  });
  function markAt(p) {
    // A little extra reach, since the number can be small on screen.
    return shapes.findLast((shape) => {
      const point = badgePoint(shape, badge);
      return Math.hypot(p.x - point.x, p.y - point.y) <= badge * 1.3;
    });
  }
  function updateDrawing(e) {
    const p = toImage(e);
    if (drawing.tool === "pen") {
      const last = drawing.points.at(-1);
      if (last.x !== p.x || last.y !== p.y) drawing.points.push(p);
    } else {
      drawing.points[1] = p;
    }
  }
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) {
      canvas.style.cursor = markAt(toImage(e)) ? "pointer" : "";
      return;
    }
    if (drawing.pointerId !== e.pointerId) return;
    updateDrawing(e);
    paint();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (drawing?.pointerId !== e.pointerId) return;
    updateDrawing(e);
    const a = drawing.points[0];
    const b = drawing.points.at(-1);
    const tiny = Math.hypot(b.x - a.x, b.y - a.y) < lineWidth * 2 && drawing.points.length < 3;
    const mark = drawing;
    drawing = null;
    if (tiny) {
      paint();
      return;
    }
    editMarks([...shapes, mark], mark);
    openNote(mark);
  });
  function cancelStroke(e) {
    if (drawing?.pointerId !== e.pointerId) return;
    drawing = null;
    paint();
  }
  canvas.addEventListener("pointercancel", cancelStroke);
  canvas.addEventListener("lostpointercapture", cancelStroke);

  async function exportBlob() {
    // Keep the source dimensions unless a mark or number needs part of the drawing margin.
    let left = 0;
    let top = 0;
    let right = W;
    let bottom = H;
    function include({ x, y }, radius) {
      left = Math.min(left, x - radius);
      top = Math.min(top, y - radius);
      right = Math.max(right, x + radius);
      bottom = Math.max(bottom, y + radius);
    }
    for (const shape of shapes) {
      if (shape.tool === "arrow") {
        const [a, b] = shape.points;
        const head = arrowHead(a, b, lineWidth);
        include(a, lineWidth / 2);
        include(head.stem, lineWidth / 2);
        include(b, 0);
        include(head.left, 0);
        include(head.right, 0);
      } else if (shape.tool !== "pin") {
        for (const point of shape.points) include(point, lineWidth / 2);
      }
      include(badgePoint(shape, badge), badge + Math.max(1, badge / 7) / 2);
    }
    left = Math.max(-margin, Math.floor(left));
    top = Math.max(-margin, Math.floor(top));
    right = Math.min(W + margin, Math.ceil(right));
    bottom = Math.min(H + margin, Math.ceil(bottom));
    const output = document.createElement("canvas");
    output.width = right - left;
    output.height = bottom - top;
    render(output.getContext("2d"), left, top, shapes);
    return new Promise((resolve) => output.toBlob(resolve, "image/png"));
  }

  function noteText(fileName) {
    const lines = [];
    const intro = overall.value.trim();
    const marked = shapes.map((s, i) => ({ n: i + 1, note: s.note.trim() })).filter((s) => s.note);
    if (!intro && marked.length === 0) return "";
    lines.push(`Annotated ${fileName} (numbers match the marks on the image):`);
    if (intro) lines.push(intro);
    // "Mark N:" rather than "N." so the composer's Markdown list handling can't renumber skipped marks.
    marked.forEach((s) => lines.push(`- Mark ${s.n}: ${s.note}`));
    return lines.join("\n");
  }

  let closed = false;
  let sending = false;
  let backdropPress;
  let dismissTimer;
  const isBackdrop = (element) => element === root || element === stage || element === board;

  function resetDismiss() {
    if (dismissTimer === undefined) return;
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
    dismissHint.textContent = "";
  }

  const close = ({ restoreFocus = true } = {}) => {
    if (closed) return;
    closed = true;
    resetDismiss();
    live.delete(close);
    root.remove();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", placeNote);
    if (restoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  };
  live.add(close);

  async function act(action) {
    if (action === "undo") {
      restoreMarks(undoStack, redoStack);
    } else if (action === "redo") {
      restoreMarks(redoStack, undoStack);
    } else if (action === "clear") {
      if (shapes.length === 0) return;
      editMarks([], null);
      canvas.focus({ preventScroll: true });
    } else if (action === "zoom-in") {
      setZoom(zoom * 1.25);
    } else if (action === "zoom-out") {
      setZoom(zoom / 1.25);
    } else if (action === "zoom-fit") {
      setZoom(1);
    } else if (action === "cancel") {
      close();
    } else if (action === "copy") {
      try {
        const blob = await exportBlob();
        if (!blob) throw new Error("Image export failed");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("Annotated image copied.");
      } catch {
        toast("Clipboard write was blocked; use “Add to message” instead.");
      }
    } else if (action === "send") {
      if (sending) return;
      if (!target?.isConnected) {
        return toast("The message you started from is no longer open. Use “Copy image” instead.");
      }
      sending = true;
      const sendButton = root.querySelector("[data-act='send']");
      sendButton.disabled = true;
      try {
        const stem = name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "-").slice(0, 60) || "image";
        const fileName = `${stem}-annotated.png`;
        const text = noteText(fileName);
        let blob;
        try {
          blob = await exportBlob();
        } catch {
          blob = null;
        }
        if (closed) return;
        if (!blob) return toast("This image can't be exported (blocked cross-origin image).");
        const file = new File([blob], fileName, { type: "image/png" });
        const landed = await addToComposer(target, { file, text });
        if (closed) return;
        if (!landed.file) {
          // Keep the overlay and the user's marks; nothing was added.
          return toast("The message box didn't accept the image. Try “Copy image” and paste it.");
        }
        close({ restoreFocus: false });
        if (landed.text) return toast("Added to your message.");
        const copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
        toast(copied ? "Image added. Your notes didn't paste, so they're on the clipboard." : "Image added, but your notes couldn't be inserted.");
      } finally {
        sending = false;
        if (!closed) sendButton.disabled = false;
      }
    }
  }

  root.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    backdropPress = isBackdrop(e.target) ? { x: e.clientX, y: e.clientY } : undefined;
    if (!backdropPress) resetDismiss();
  }, true);
  root.addEventListener("pointercancel", () => {
    backdropPress = undefined;
    resetDismiss();
  });
  root.addEventListener("wheel", resetDismiss, { passive: true });
  root.addEventListener("click", (e) => {
    const press = backdropPress;
    backdropPress = undefined;
    if (isBackdrop(e.target)) {
      e.stopPropagation();
      if (!sending && !drawing && press && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= CLICK_SLOP_PX) {
        if (dismissTimer !== undefined) close();
        else {
          dismissHint.textContent = "Click outside again to close";
          dismissTimer = setTimeout(resetDismiss, DISMISS_WINDOW_MS);
        }
      } else resetDismiss();
      return;
    }
    resetDismiss();
    const target = e.target.closest("button");
    if (!target) return;
    if (target.dataset.tool) selectTool(target.dataset.tool);
    else if (target.dataset.color) selectColor(target.dataset.color);
    else if (target.dataset.act) void act(target.dataset.act);
  });

  function onKey(e) {
    // Only keys aimed at the overlay (or at nothing in particular) belong to it.
    if (!(e.target === window || e.target === document.body || e.target === document.documentElement || root.contains(e.target))) return;
    const typing = e.target instanceof HTMLTextAreaElement;
    resetDismiss();
    e.stopPropagation();
    if (e.isComposing) return;
    const key = e.key.toLowerCase();
    const command = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      e.preventDefault();
      if (e.target === popText) closeNote();
      else if (typing) canvas.focus({ preventScroll: true });
      else close();
      return;
    }
    if (command && e.altKey && !e.shiftKey && (key === "arrowleft" || key === "arrowright")) {
      e.preventDefault();
      const i = TOOLS.findIndex((t) => t.id === tool);
      selectTool(TOOLS[(i + (key === "arrowright" ? 1 : TOOLS.length - 1)) % TOOLS.length].id);
      return;
    }
    // Zoom the image, not the app window.
    if (command && !e.altKey && ["=", "+", "-", "_", "0"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "0") setZoom(1);
      else setZoom(e.key === "-" || e.key === "_" ? zoom / 1.25 : zoom * 1.25);
      return;
    }
    if (key === "enter" && command && !e.altKey) {
      e.preventDefault();
      void act("send");
      return;
    }
    // Enter finishes a mark's note; Shift+Enter adds a line.
    if (key === "enter" && e.target === popText && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      closeNote();
      return;
    }
    if (typing) return;
    if (command && !e.altKey && (key === "z" || (key === "y" && !e.shiftKey))) {
      e.preventDefault();
      void act(key === "y" || e.shiftKey ? "redo" : "undo");
      return;
    }
    if (command || e.altKey || e.shiftKey) return;
    if (key === "delete" || key === "backspace") {
      e.preventDefault();
      if (!e.repeat) removeMark(selected);
      return;
    }
    const t = TOOLS.find((x) => x.key === key);
    if (t) selectTool(t.id);
  }
  // Window capture runs before the app's own shortcut listeners, so they stay quiet meanwhile.
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", placeNote);

  selectTool("arrow");
  selectColor(color);
  paint();
  document.body.append(root);
  root.querySelector("[data-tool='arrow']").focus();
}
