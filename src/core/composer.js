import { findPropsUp } from "./react.js";

const isComposerProps = (p) => typeof p.onCompactContext === "function" && "compactDisabled" in p;

/** The main chat composer's editor element and its current ChatComposer props. */
export function findComposer() {
  for (const editor of document.querySelectorAll(".ProseMirror[contenteditable='true']")) {
    const props = findPropsUp(editor, isComposerProps);
    if (props) return { editor, props };
  }
  return null;
}

function placeCaretAtEnd(editor) {
  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function pasteInto(editor, fill) {
  const data = new DataTransfer();
  fill(data);
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  // Firefox can expose an empty DataTransfer instead of the one supplied to the constructor.
  if (event.clipboardData !== data && !Reflect.defineProperty(event, "clipboardData", { value: data })) return false;
  editor.dispatchEvent(event);
  return true;
}

/** Resolves true once `check()` holds, or false after `ms`. */
async function waitFor(check, ms = 1500) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

/** The composer area (editor plus its attachment chips), used to confirm a paste landed. */
const composerArea = (editor) => editor.closest("form") ?? editor.parentElement?.parentElement?.parentElement ?? editor;

/**
 * Hands a file and a note to `editor` the same way a user paste would, so the app's own attachment
 * rules apply. Each step is confirmed in the DOM. Returns { file, text } telling which parts landed.
 */
export async function addToComposer(editor, { file, text }) {
  const result = { file: !file, text: !text };
  if (!editor?.isConnected) return result;
  const area = composerArea(editor);
  if (file) {
    const before = area.textContent.split(file.name).length;
    placeCaretAtEnd(editor);
    if (!pasteInto(editor, (d) => d.items.add(file))) return result;
    result.file = await waitFor(
      () => area.textContent.split(file.name).length > before || !!area.querySelector(`img[alt="${CSS.escape(file.name)}"]`),
    );
    if (!result.file || !editor.isConnected) return result;
  }
  if (text) {
    // Markdown lines render without their list marker, so probe with the last line minus it.
    const probe = text.split("\n").at(-1).replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").slice(-40);
    placeCaretAtEnd(editor);
    pasteInto(editor, (d) => d.setData("text/plain", text));
    result.text = await waitFor(() => editor.isConnected && editor.textContent.includes(probe), 800);
  }
  return result;
}
