const controls = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let current;
let busy = false;
const ask = (action, extra = {}) => chrome.runtime.sendMessage({ browserSharing: action, tabId: tab?.id, ...extra });

function render(state) {
  current = state;
  const shared = state.state === "shared";
  controls.status.textContent = state.error ?? ({
    permission: "Allow Toolkit to connect to its local Windows helper.",
    ready: "Ask an agent in T3 Code to request tab sharing.",
    pending: `${state.requester} wants to share this tab.`,
    shared: `Sharing ${state.origin}`,
    busy: "A different browser tab is already being shared.",
  }[state.state] ?? "Enable Browser sharing in the T3 Code Toolkit menu.");
  controls.permission.hidden = state.state !== "permission";
  controls.share.hidden = state.state !== "pending";
  controls.stop.hidden = !shared && state.state !== "busy";
  controls.approve.hidden = controls.deny.hidden = !shared || !state.click;
  controls.target.hidden = !shared || !state.click;
  controls.target.textContent = state.click?.label ?? "";
}

async function refresh() {
  if (busy) return;
  try { render(await ask("status")); }
  catch { render({ error: "Reload the Toolkit extension and reopen this popup." }); }
}

async function perform(operation) {
  if (busy) return;
  busy = true;
  try { render(await operation()); }
  catch { render({ error: "Toolkit could not complete the request. Reopen this popup to try again." }); }
  finally { busy = false; }
}

controls.permission.onclick = () => perform(async () => {
  const allowed = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
  return allowed ? ask("status") : { state: "permission" };
});
controls.share.onclick = () => perform(() => ask("share", { requestId: current.requestId }));
controls.stop.onclick = () => perform(() => ask("stop"));
controls.approve.onclick = () => perform(() => ask("decide", { actionId: current.click.id, decision: "approve" }));
controls.deny.onclick = () => perform(() => ask("decide", { actionId: current.click.id, decision: "deny" }));
controls.copy.onclick = async () => {
  await navigator.clipboard.writeText(chrome.runtime.id);
  controls.copy.textContent = "Extension ID copied";
};
controls.options.onclick = () => chrome.runtime.openOptionsPage();
await refresh();
setInterval(refresh, 900);
