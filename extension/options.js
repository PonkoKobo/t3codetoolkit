const api = globalThis.browser ?? globalThis.chrome;
const list = document.getElementById("list");
const status = document.getElementById("status");

function toPattern(input) {
  const url = new URL(input.includes("://") ? input : `http://${input}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an http or https address.");
  // Match patterns ignore ports, so one entry covers every port on that host.
  return `${url.protocol}//${url.hostname}/*`;
}

async function render() {
  const { origins = [] } = await api.storage.local.get("origins");
  list.replaceChildren(
    ...origins.map((pattern) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = pattern;
      const remove = document.createElement("button");
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        const next = origins.filter((o) => o !== pattern);
        await api.storage.local.set({ origins: next });
        await api.permissions.remove({ origins: [pattern] }).catch(() => {});
        void render();
      });
      li.append(code, remove);
      return li;
    }),
  );
}

document.getElementById("add").addEventListener("submit", async (event) => {
  event.preventDefault();
  let pattern;
  try {
    pattern = toPattern(document.getElementById("origin").value.trim());
  } catch (error) {
    status.textContent = error.message || "That isn't a valid address.";
    return;
  }
  // Must be called directly from the user's click.
  const granted = await api.permissions.request({ origins: [pattern] });
  if (!granted) {
    status.textContent = "Permission was not granted, so the toolkit can't run there.";
    return;
  }
  const { origins = [] } = await api.storage.local.get("origins");
  if (!origins.includes(pattern)) await api.storage.local.set({ origins: [...origins, pattern] });
  status.textContent = `Added ${pattern}. Reload that T3 Code tab.`;
  document.getElementById("origin").value = "";
  void render();
});

void render();
