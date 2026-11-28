import { askLauncher } from "../launcher.js";

export function browserSharingSettings() {
  if (!window.__T3TK_BROWSER_SHARING__) return null;
  const section = document.createElement("section");
  section.className = "t3tk-menu-section";
  const heading = document.createElement("h2");
  heading.className = "t3tk-menu-subheading";
  heading.textContent = "Browser sharing";
  const field = document.createElement("input");
  field.type = "text";
  field.placeholder = "Chrome extension ID";
  field.setAttribute("aria-label", "Chrome extension ID");
  field.maxLength = 32;
  field.spellcheck = false;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Enable";
  toggle.disabled = true;
  const status = document.createElement("small");
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  const buttons = document.createElement("div");
  buttons.style.display = "flex";
  buttons.style.flexWrap = "wrap";
  buttons.style.gap = "4px";
  actions.append(buttons);
  section.append(heading, field, toggle, status, actions);

  let state;
  const copy = (label, key, message) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(state[key]);
        status.textContent = message;
      } catch { status.textContent = "Clipboard access failed."; }
    };
    buttons.append(button);
  };
  copy("Codex setup", "codex", "Append these arguments in the Codex provider’s Launch arguments, then start a new agent session.");
  copy("Claude setup", "claude", "Append these arguments in the Claude provider’s Launch arguments, then start a new agent session.");
  copy("Local command", "command", "Paste the command into the agent’s chat and ask it to request tab sharing.");
  function render(next) {
    state = next;
    field.hidden = state.enabled;
    field.value = state.extensionId ?? "";
    actions.hidden = !state.enabled;
    toggle.textContent = state.enabled ? "Disable" : "Enable";
    status.textContent = state.enabled
      ? "Ask the agent to request access, then share a tab from the Chrome extension."
      : "Open Toolkit in Chrome and copy its extension ID.";
    toggle.disabled = false;
  }
  toggle.onclick = async () => {
    toggle.disabled = true;
    try {
      render(await askLauncher({
        browserSharing: state.enabled ? "disable" : "enable",
        extensionId: field.value.trim(),
      }, 8500));
    } catch (error) {
      status.textContent = error.message;
      toggle.disabled = false;
    }
  };
  actions.hidden = true;
  void askLauncher({ browserSharing: "status" }).then(render, (error) => { status.textContent = error.message; });
  return section;
}
