import { appRoute } from "../projectKeys.js";
import { waitFor } from "../pickerDriver.js";
import { toast } from "../styles.js";
import { askLauncher } from "../launcher.js";
import { stopQuota, syncQuota } from "./antigravityQuota.js";

const USAGE_HEADER = 'header[class~="@container/usage-header"]';
const TOGGLE_TERMINAL = 'button[aria-label="Toggle terminal drawer"], [data-workspace-titlebar-controls] button[aria-pressed]:has(svg.lucide-panel-bottom)';
const TERMINAL_DRAWER = '[data-thread-terminal-drawer][data-terminal-owner="drawer"]';
const NEW_TERMINAL = 'button[aria-label="New Terminal" i], button[aria-label^="New Terminal (" i], button[aria-label]:has(svg.lucide-plus)';
let panel = null;

function terminalToggle() {
  return [...document.querySelectorAll(TOGGLE_TERMINAL)].find((button) =>
    !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getClientRects().length > 0
  );
}

async function openTerminal(button) {
  const modal = button.closest("[data-app-modal]");
  const close = modal?.querySelector('button[aria-label="Close"], button:has(svg.lucide-x)');
  if (!close || !terminalToggle()) {
    toast("Open a project thread to use its T3 Code terminal.");
    return;
  }
  button.disabled = true;
  const copied = (async () => {
    try {
      await navigator.clipboard.writeText("agy");
      return true;
    } catch {
      return false;
    }
  })();
  close.click();
  if (await waitFor(() => !modal.isConnected, 2000)) {
    const toggle = terminalToggle();
    if (toggle) {
      if (toggle.getAttribute("aria-pressed") !== "true") toggle.click();
      if (await waitFor(() => document.querySelector(TERMINAL_DRAWER), 2000)) {
        const newTerminal = document.querySelector(TERMINAL_DRAWER)?.querySelector(NEW_TERMINAL);
        if (newTerminal?.getAttribute("aria-disabled") !== "true") newTerminal?.click();
        const instruction = await copied ? "Paste agy and press Enter" : "Type agy and press Enter";
        toast(`${instruction}. Then enter /usage in Antigravity.`, 6500);
        return;
      }
    }
  }
  button.disabled = false;
  toast("Open the terminal drawer in your project thread, then run agy.");
}

function commandStep(label, command) {
  const step = document.createElement("span");
  step.className = "t3tk-quota-step";
  step.append(label);

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = command;
  button.setAttribute("aria-label", `Copy ${command}`);
  button.title = `Copy ${command}`;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast(`Copied ${command}`);
    } catch {
      toast(`Could not copy. Enter ${command} manually.`);
    }
  });
  step.append(button);
  return step;
}

function usagePanel() {
  const section = document.createElement("section");
  section.className = "t3tk-antigravity-usage";
  section.setAttribute("aria-label", "Antigravity subscription quota");

  const heading = document.createElement("h2");
  heading.textContent = "Gemini quota in Antigravity";

  const commands = document.createElement("div");
  commands.className = "t3tk-quota-commands";
  const terminal = document.createElement("button");
  terminal.type = "button";
  terminal.className = "t3tk-quota-open-terminal";
  terminal.textContent = "Open T3 Code terminal & copy agy";
  terminal.addEventListener("click", () => void openTerminal(terminal));
  commands.append(terminal, commandStep("Run in the terminal", "agy"), commandStep("Then enter in Antigravity", "/usage"));

  const note = document.createElement("p");
  note.textContent = "The CLI shows remaining quota and reset times for its signed-in Google account.";
  section.append(heading, commands, note);
  return section;
}

export const antigravityUsage = {
  id: "gemini-quota",
  title: "Gemini quota",
  sync() {
    const hasQuota = syncQuota();
    const route = appRoute(location, window.desktopBridge !== undefined);
    const header = /^\/usage\/?$/.test(route) ? document.querySelector(USAGE_HEADER) : null;
    if (!header) {
      panel?.remove();
      panel = null;
      return hasQuota ? "ready" : "idle";
    }
    panel ??= usagePanel();
    if (header.nextElementSibling !== panel) header.after(panel);
    return "ready";
  },
  stop() {
    stopQuota();
    panel?.remove();
    panel = null;
  },
};

export function appendQuotaSetting(section, paused) {
  const row = document.createElement("label");
  row.className = "t3tk-menu-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.disabled = true;
  const text = document.createElement("span");
  text.textContent = "Show Gemini quota";
  const status = document.createElement("small");
  text.append(status);
  row.append(input, text);
  section.append(row);

  const show = ({ enabledNow, enabledNextStart }) => {
    input.checked = enabledNextStart;
    input.disabled = paused;
    if (enabledNow !== enabledNextStart) {
      status.textContent = enabledNextStart ? "Gemini quota will appear after restart." : "Gemini quota will turn off after restart.";
    } else {
      status.textContent = "Uses your signed-in Antigravity CLI when you click Refresh.";
    }
  };
  const failure = (error) => { status.textContent = error.message; };
  status.textContent = "Checking…";
  askLauncher({ getGeminiQuota: true }, 7500).then(show, failure);
  input.addEventListener("change", () => {
    if (paused) return;
    const wanted = input.checked;
    input.disabled = true;
    askLauncher({ geminiQuotaEnabled: wanted }, 7500).then(show, (error) => {
      input.checked = !wanted;
      input.disabled = false;
      failure(error);
    });
  });
}
