/* Loaded only by the Chrome sharing service worker. */
(() => {
  const host = "com.t3codetoolkit.browser";
  let port;
  let sequence = 0;
  const waiting = new Map();
  let shared;
  let stopping;

  function clearShare() {
    const previous = shared;
    shared = undefined;
    if (!previous) return;
    clearTimeout(previous.timer);
    void chrome.action.setBadgeText({ tabId: previous.tabId, text: "" }).catch(() => {});
  }

  function connect() {
    if (port) return port;
    const opened = chrome.runtime.connectNative(host);
    port = opened;
    opened.onMessage.addListener(({ id, result }) => waiting.get(id)?.finish(result));
    opened.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port !== opened) return;
      port = undefined;
      clearShare();
      for (const request of waiting.values())
        request.finish({ error: "Connect the Chrome extension in the T3 Code Toolkit menu." });
    });
    return opened;
  }

  function send(op, fields = {}) {
    return new Promise((resolve) => {
      const id = ++sequence;
      const finish = (value) => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ error: "Toolkit did not respond." }), 2400);
      waiting.set(id, { finish });
      try { connect().postMessage({ op: "browser_" + op, id, ...fields }); }
      catch { finish({ error: "Connect the Chrome extension in the T3 Code Toolkit menu." }); }
    });
  }

  function stop() {
    if (stopping) return stopping;
    clearShare();
    stopping = (async () => {
      if (port) await send("stop");
      const previous = port;
      port = undefined;
      // Disconnecting the native host invalidates its grant. Ignore already outstanding replies.
      previous?.disconnect();
      for (const request of waiting.values()) request.finish({ state: "ready" });
      return { state: "ready" };
    })().finally(() => { stopping = undefined; });
    return stopping;
  }

  async function popup(request) {
    if (stopping) return stopping;
    if (!await chrome.permissions.contains({ permissions: ["nativeMessaging"] })) return { state: "permission" };
    const tab = await chrome.tabs.get(request.tabId).catch(() => null);
    if (request.browserSharing === "stop") return stop();
    if (request.browserSharing === "share") {
      if (!tab?.active || tab.incognito || !tab.url || !Number.isInteger(tab.id))
        return { error: "Open a regular Chrome tab and try again." };
      const origin = new URL(tab.url).origin;
      // Establish that Chrome has granted access to this tab before claiming the agent request.
      try {
        const [proof] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, func: () => location.origin,
        });
        if (proof.result !== origin) return { error: "The tab changed. Reopen the Toolkit popup." };
      } catch { return { error: "Chrome did not grant access to this tab." }; }
      const result = await send("share", { origin, requestId: request.requestId });
      if (result.state !== "shared") return result;
      shared = { tabId: tab.id, origin, click: null };
      void chrome.action.setBadgeText({ tabId: tab.id, text: "LIVE" }).catch(() => {});
      void tick(shared);
      return { ...result, origin };
    }
    if (request.browserSharing === "decide") {
      if (shared?.tabId !== tab?.id || !tab?.active || shared.click?.id !== request.actionId)
        return { error: "This click request has expired or belongs to another tab." };
      const current = shared;
      current.click = null;
      const reply = await send("decide", { actionId: request.actionId, decision: request.decision });
      return { ...reply, origin: current.origin };
    }
    const state = await send("status");
    if (state.state === "shared" && shared && shared.tabId === tab?.id)
      return { ...state, origin: shared.origin, click: shared.click };
    if (state.state === "shared") return { state: "busy" };
    return state;
  }

  async function tick(session) {
    if (shared !== session) return;
    const activeTab = await chrome.tabs.get(session.tabId).catch(() => null);
    if (shared !== session) return;
    if (!activeTab?.url || new URL(activeTab.url).origin !== session.origin) {
      await stop();
      return;
    }
    const result = await send("next");
    if (shared !== session) return;
    if (result.state !== "shared") { clearShare(); return; }
    const action = result.action;
    session.click = action?.approvalRequired ? action : null;
    if (action && !action.approvalRequired) {
      const tab = await chrome.tabs.get(session.tabId).catch(() => null);
      if (shared !== session) return;
      if (!tab?.url || new URL(tab.url).origin !== session.origin || !tab.active) {
        await send("complete", { actionId: action.id, result: { error: "Bring the shared tab to the front." } });
      } else {
        let reply;
        try {
          const [response] = await chrome.scripting.executeScript({
            target: { tabId: session.tabId },
            func: pageAction,
            args: [session.origin, action.name, action.arg],
          });
          reply = response.result;
        } catch { reply = { error: "Chrome could not access that page. Share the tab again." }; }
        if (shared === session) await send("complete", { actionId: action.id, result: reply });
      }
    }
    if (shared === session) session.timer = setTimeout(() => void tick(session), 400);
  }

  function pageAction(origin, name, argument) {
    if (window.location.origin !== origin) return { error: "The tab changed sites." };
    const previous = globalThis.__t3tkBrowserTargets;
    globalThis.__t3tkBrowserTargets = null;
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const inView = (rect) => rect.right > viewport.left && rect.bottom > viewport.top &&
      rect.left < viewport.right && rect.top < viewport.bottom && rect.width > 0 && rect.height > 0;
    const privateElement = "input, textarea, select, pre, code, [role=textbox], [contenteditable]:not([contenteditable=false]), [data-private], [data-sensitive]";
    const credentialLabel = /\b(?:api[ -]?keys?|access tokens?|passwords?|secret keys?|private keys?|credentials?|recovery codes?)\b/i;

    function visible(element) {
      if (!element || element.closest(privateElement) || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      return Array.from(element.getClientRects()).some(inView);
    }

    function describe(element) {
      if (!visible(element) || element.matches(":disabled, [aria-disabled=true], [download], [target]:not([target=_self])") || element.closest("form") || element.form) return null;
      const rect = element.getBoundingClientRect();
      const x = (Math.max(rect.left, 0) + Math.min(rect.right, innerWidth)) / 2;
      const y = (Math.max(rect.top, 0) + Math.min(rect.bottom, innerHeight)) / 2;
      if (!element.contains(document.elementFromPoint(x, y))) return null;
      const label = (element.getAttribute("aria-label") || element.innerText || element.getAttribute("title") || "").trim().replace(/\s+/g, " ");
      if (!label || label.length > 160 || credentialLabel.test(label)) return null;
      let destination = "";
      if (element instanceof HTMLAnchorElement) {
        destination = element.href;
        const url = new URL(destination);
        if (url.origin !== origin || credentialLabel.test(url.pathname)) return null;
      }
      return { label, destination };
    }

    if (name === "request_click") {
      const target = previous?.targets.get(argument);
      if (!target || previous.url !== location.href || Date.now() - previous.time > 75000)
        return { error: "The target expired. Take a new snapshot." };
      const actual = describe(target.element);
      if (actual?.label !== target.label || actual?.destination !== target.destination)
        return { error: "The target changed. Take a new snapshot." };
      target.element.click();
      return { state: "clicked" };
    }

    if (name === "scroll") {
      window.scrollBy(0, (argument === "up" ? -1 : 1) * innerHeight * 0.85);
      return { state: "scrolled" };
    }
    if (name !== "snapshot") return { error: "Unsupported action." };

    const refs = new Map();
    const targets = [];
    for (const element of document.querySelectorAll("a[href], button, [role=button]:not(button)")) {
      if (targets.length >= 30) break;
      const details = describe(element);
      if (!details) continue;
      const ref = crypto.randomUUID();
      refs.set(ref, { element, ...details });
      targets.push({ ref, label: details.label });
    }
    globalThis.__t3tkBrowserTargets = { url: location.href, time: Date.now(), targets: refs };
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const lines = [];
    let length = 0;
    let inspected = 0;
    while (length < 4000 && inspected++ < 10000 && walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!visible(parent) || parent.closest("script, style, noscript, template")) continue;
      range.selectNodeContents(node);
      if (!Array.from(range.getClientRects()).some((rect) => inView(rect) && parent.contains(document.elementFromPoint(
        (Math.max(rect.left, 0) + Math.min(rect.right, innerWidth)) / 2,
        (Math.max(rect.top, 0) + Math.min(rect.bottom, innerHeight)) / 2,
      )))) continue;
      const text = node.textContent.trim().replace(/\s+/g, " ");
      if (!text || credentialLabel.test(text)) continue;
      const line = text.slice(0, 4000 - length);
      lines.push(line);
      length += line.length + 1;
    }
    return { state: "snapshot", origin, text: lines.join("\n"), targets };
  }

  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (!request?.browserSharing || sender.url !== chrome.runtime.getURL("browser-popup.html")) return false;
    void popup(request).then(respond, () => respond({ error: "Could not connect to Toolkit." }));
    return true;
  });
  chrome.tabs.onRemoved.addListener((id) => { if (id === shared?.tabId) void stop(); });
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (id === shared?.tabId && change.url && new URL(change.url).origin !== shared.origin) void stop();
  });
  chrome.permissions.onRemoved.addListener((change) => {
    if (change.permissions?.includes("nativeMessaging")) void stop();
  });
})();
