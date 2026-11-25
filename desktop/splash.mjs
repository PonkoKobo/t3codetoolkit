export function splashSource(logo) {
  return `(${brandSplash})(${JSON.stringify(logo)})`;
}

// Runs in the renderer at document start. T3 Code still owns the splash, its progress and removal.
function brandSplash(logo) {
  if (window !== window.top) return;
  const isApp = /^t3code(-dev)?:\/\/app(\/|$)/.test(location.href);
  const isDataPage = location.href.startsWith("data:text/html;charset=utf-8,");
  if (!isApp && !isDataPage) return;

  const background = "radial-gradient(ellipse at center, #39236d 0%, #241844 55%, #171129 100%)";
  const foreground = "#f4edff";

  function brandApp() {
    const shell = document.getElementById("boot-shell");
    const card = document.getElementById("boot-shell-card");
    const image = document.getElementById("boot-shell-logo");
    if (!shell || !card || !image) return;
    shell.style.background = background;
    shell.style.color = foreground;
    card.style.width = card.style.height = "clamp(96px, 20vmin, 168px)";
    image.style.width = image.style.height = "100%";
    image.src = `data:image/png;base64,${logo}`;
    return true;
  }

  function brandConnectionWindow() {
    const spinner = document.querySelector("body > .spinner");
    const status = document.querySelector("body > .label");
    if (!spinner || !/^(Connecting to WSL…|Upgrading database \(\d+ of \d+\))$/.test(status?.textContent)) return;
    Object.assign(document.body.style, { background, color: foreground, gap: "12px" });
    // This window's CSP blocks <img> URLs. Decode the local artwork directly into a canvas.
    const bytes = Uint8Array.from(atob(logo), (byte) => byte.charCodeAt(0));
    createImageBitmap(new Blob([bytes], { type: "image/png" })).then((bitmap) => {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.style.width = canvas.style.height = "100px";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "T3 Code Toolkit");
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      spinner.replaceWith(canvas);
    }).catch(() => {});
    return true;
  }

  const brand = isApp ? brandApp : brandConnectionWindow;
  if (brand()) return;
  const observer = new MutationObserver(() => {
    if (brand()) observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
  // Older versions may have no splash. Don't observe their workspace after startup.
  window.addEventListener("load", () => observer.disconnect(), { once: true });
}
