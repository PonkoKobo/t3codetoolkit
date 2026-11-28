// Talks to the desktop launcher (desktop/launch.mjs), which exposes a private DevTools binding to
// the app windows it started. On the web there's no launcher.

const waiting = new Map();
let nextId = 1;

export const hasLauncher = () => typeof window.__t3tkLauncher === "function";

export function askLauncher(request, timeout = 3000) {
  if (!hasLauncher()) return Promise.reject(new Error("No desktop launcher."));
  window.__t3tkLauncherReply ??= (reply) => {
    const entry = waiting.get(reply?.id);
    if (!entry) return;
    waiting.delete(reply.id);
    clearTimeout(entry.timer);
    if (reply.error) entry.reject(new Error(reply.error));
    else entry.resolve(reply.state);
  };
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("The launcher didn't answer."));
    }, timeout);
    waiting.set(id, { resolve, reject, timer });
    window.__t3tkLauncher(JSON.stringify({ id, ...request }));
  });
}
