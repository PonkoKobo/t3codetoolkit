import { REPOSITORY_ROW, VERSION_CONTROL_LIST, stopRepositoryOrganizer, syncRepositoryOrganizer } from "./repositoryOrganizer.js";
import { REPOSITORY_ORGANIZER_CSS } from "./repositoryOrganizerStyles.js";

// T3 Code 0.1.12 measures expanded repository rows as part of the minimum
// fitting height. That can switch the card to essential density and hide the list.
const CARD = "[data-thread-details-card]";
const VIEWPORT = ':scope > div > [data-slot="scroll-area-viewport"]';
const SCROLLING_LISTS = "[data-thread-relationships-panel], [data-thread-side-chats-panel], [data-thread-details-pr-list], [data-thread-automations-panel], [data-thread-details-server-overflow]";
const UPDATED_LISTS = SCROLLING_LISTS.replace("[data-thread-automations-panel]", "[data-thread-details-issue-list], [data-thread-automations-panel]") + ", [data-thread-details-repository-overflow]";
const NATIVE_OVERFLOW = `${VERSION_CONTROL_LIST}:not([data-t3tk-repo-managed]) > ${REPOSITORY_ROW}:nth-child(n+5 of ${REPOSITORY_ROW})`;
const EXTRA_REPOSITORY_ROWS = `${NATIVE_OVERFLOW}, [data-t3tk-repo-extra], .t3tk-repo-organize`;

const patched = new Map();
let organizerStyle = null;

function patchCard(card) {
  const content = card?.querySelector(VIEWPORT)?.firstElementChild;
  if (!content || Object.hasOwn(content, "querySelectorAll")) return;

  // Change only this card's exact measurement query. The native scroll area,
  // total canvas height, React rows and all other selector calls stay intact.
  const querySelectorAll = content.querySelectorAll;
  const measure = function (selector) {
    if (selector === UPDATED_LISTS) {
      // Managed rows can move across the host's original overflow boundary.
      return querySelectorAll.call(this, UPDATED_LISTS.replace("[data-thread-details-repository-overflow]",
        "[data-thread-details-repository-overflow]:not([data-t3tk-repo-managed] > *)") + ", [data-t3tk-repo-extra], .t3tk-repo-organize");
    }
    return querySelectorAll.call(this, selector === SCROLLING_LISTS
      ? `${SCROLLING_LISTS}, ${EXTRA_REPOSITORY_ROWS}`
      : selector);
  };
  Object.defineProperty(content, "querySelectorAll", {
    configurable: true,
    writable: true,
    value: measure,
  });
  patched.set(content, measure);
}

function restore(content, measure) {
  if (content.querySelectorAll === measure) delete content.querySelectorAll;
  patched.delete(content);
}

function beforeClick(event) {
  // Handle a click right after the card appeared, before the toolkit's next sync.
  patchCard(event.target?.closest?.(CARD));
}

export const threadRepositoryOverflow = {
  id: "fix-thread-repository-overflow",
  title: "Thread Details repositories",
  surfaces: ["desktop"],
  hostVersions: ["0.1.12", "0.1.13"],
  sync() {
    if (!organizerStyle) {
      organizerStyle = document.createElement("style");
      organizerStyle.textContent = REPOSITORY_ORGANIZER_CSS;
      document.head.append(organizerStyle);
      document.addEventListener("click", beforeClick, true);
    }
    for (const [content, measure] of patched) {
      if (!content.isConnected) restore(content, measure);
    }
    document.querySelectorAll(CARD).forEach(patchCard);
    syncRepositoryOrganizer();
    return patched.size > 0 ? "ok" : "idle";
  },
  stop() {
    stopRepositoryOrganizer();
    document.removeEventListener("click", beforeClick, true);
    organizerStyle?.remove();
    organizerStyle = null;
    for (const [content, measure] of patched) restore(content, measure);
  },
};
