import { findComposer } from "../composer.js";
import { isOtherTextField } from "../effortKeys.js";
import { findPropsUp } from "../react.js";
import { ICONS, toast } from "../styles.js";

// ThreadDetailsContext renders ThreadDetailsSection with this id; it is a code constant, not copy.
const CONTEXT_HEADING_ID = "thread-details-context-heading";
const MARK = "t3tkCompact";
const COMPACT_SHORTCUT = "Shift+C";

function contextSections() {
  return [...document.querySelectorAll("section")].filter(
    (section) => findPropsUp(section, (p) => p.headingId === CONTEXT_HEADING_ID, 3) !== null,
  );
}

function onCompactKeyDown(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) return;
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== "c") return;
  const target = event.target;
  if (isOtherTextField(target) || target?.closest?.(".xterm, [data-terminal], [role='textbox']")) return;
  if (document.querySelector(".t3tk-overlay, .t3tk-menu")) return;

  const scope = target?.closest?.("[role='dialog'], [role='menu']") ?? document;
  const button = [...scope.querySelectorAll("[data-t3tk-compact] button:enabled")].find(
    (candidate) => candidate.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
  );
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  button.click();
}

function render(row) {
  const button = row.querySelector("button");
  const hint = row.querySelector(".t3tk-hint");
  const composer = findComposer();
  const disabled = !composer || composer.props.compactDisabled === true;
  const hintText = !composer ? "Open a thread" : disabled ? "Unavailable right now" : "";
  const title = disabled
    ? "Compaction is unavailable while the agent is working, waiting on you, or the provider can't compact"
    : `Summarize earlier conversation to free context (same as /compact) · ${COMPACT_SHORTCUT}`;
  // Write only on change: every write is a mutation the observer would answer with another sync.
  if (button.disabled !== disabled) button.disabled = disabled;
  if (hint.textContent !== hintText) hint.textContent = hintText;
  if (button.title !== title) button.title = title;
}

function build() {
  const row = document.createElement("div");
  row.className = "t3tk-compact-row";
  row.dataset[MARK] = "";
  row.innerHTML = `<span class="t3tk-hint"></span><button type="button" class="t3tk-btn" aria-keyshortcuts="${COMPACT_SHORTCUT}">${ICONS.compact}<span>Compact</span><kbd aria-hidden="true">${COMPACT_SHORTCUT}</kbd></button>`;
  row.querySelector("button").addEventListener("click", () => {
    const composer = findComposer();
    if (!composer || composer.props.compactDisabled) return;
    // Upstream's own handler: it re-checks every guard and sends "/compact".
    composer.props.onCompactContext();
    toast("Compacting context…");
  });
  return row;
}

export const compactButton = {
  id: "compact-button",
  title: "Compact button in the context popover",
  surfaces: ["web", "desktop"],
  sync() {
    let found = 0;
    for (const section of contextSections()) {
      found++;
      let row = section.querySelector(`[data-t3tk-compact]`);
      if (!row) {
        row = build();
        section.append(row);
      }
      render(row);
    }
    if (found) window.addEventListener("keydown", onCompactKeyDown, true);
    else window.removeEventListener("keydown", onCompactKeyDown, true);
    return found > 0 ? "ok" : "idle";
  },
  stop() {
    window.removeEventListener("keydown", onCompactKeyDown, true);
    document.querySelectorAll("[data-t3tk-compact]").forEach((row) => row.remove());
  },
};
