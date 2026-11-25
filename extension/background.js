// Registers the core script on T3 Code addresses the user added (local `t3`, Tailscale, etc.).
// app.t3.codes is covered statically by the manifest.
const api = globalThis.browser ?? globalThis.chrome;
const SCRIPT_ID = "t3tk-custom-origins";

// Storage and permission events can arrive together; run reconciliations one at a time.
let queue = Promise.resolve();
function syncRegistration() {
  queue = queue.then(reconcile, reconcile).catch((error) => console.error("[t3tk] registration failed", error));
  return queue;
}

async function reconcile() {
  const { origins = [] } = await api.storage.local.get("origins");
  const granted = [];
  for (const pattern of origins) {
    if (await api.permissions.contains({ origins: [pattern] })) granted.push(pattern);
  }
  const existing = await api.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await api.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (granted.length === 0) return;
  await api.scripting.registerContentScripts([
    { id: SCRIPT_ID, matches: granted, js: ["core.js"], runAt: "document_idle", world: "MAIN", persistAcrossSessions: true },
  ]);
}

api.runtime.onInstalled.addListener(() => void syncRegistration());
api.runtime.onStartup.addListener(() => void syncRegistration());
api.storage.onChanged.addListener((changes) => {
  if (changes.origins) void syncRegistration();
});
api.permissions.onRemoved?.addListener(() => void syncRegistration());
api.action.onClicked.addListener(() => api.runtime.openOptionsPage());
