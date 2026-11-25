# Toolkit design: add-on features for T3 Code (web + desktop)

Status: **v0.1, partly verified.** Researched against upstream `pingdotgg/t3code` at `adb60644`
(2026-11-24, desktop 0.1.11). Targets **stable releases** only.

> Unofficial add-on for T3 Code. Not affiliated with or endorsed by T3 Tools, Inc.

## 1. What upstream already has (so we don't rebuild it)

| Request | Upstream state | What the toolkit adds |
| --- | --- | --- |
| Compact | `/compact` exists: `ChatView.onCompactContext` → `sendStandaloneCommand("/compact")`, guarded by `compactDisabled` / `compactThreadUnavailable`. | A **Compact button** under the Context row of the thread details panel. It calls upstream's own handler, so every upstream guard still applies. |
| Image viewer | `ExpandedImageDialog` shows an attachment with zoom and a caption bar. No markup tools. | An **Annotate** button in the caption bar that opens a pen / arrow / box / numbered-pin editor with a note per mark. The result is attached to the message with the notes as text. |
| Project image gallery | ✅ | ⚠️ unverified | Verified on a local `t3` 0.1.12 server in headless Chromium (web). The desktop connection path follows upstream's own client code but hasn't been run in the app. |
| Disable telemetry | The server reads `T3CODE_TELEMETRY_ENABLED` (`false/no/off/0/n`). Desktop also inherits it from the user environment. No UI toggle. | The desktop launcher sets it for the server it starts; `scripts/telemetry.*` set it persistently. |
| Custom CSS | Settings → Theme editor → Custom CSS. | Nothing. Don't duplicate it. |

## 2. Where each feature can run

Upstream is a **server** (Node: analytics, providers, RPCs) plus a **client** (the React app: hosted
`app.t3.codes`, served by a local `t3`, or Electron under `t3code://`). Injected code only reaches the
client.

| Tier | Runs in | Can do | Can't do |
| --- | --- | --- | --- |
| `dom` | The page (MAIN world) | Add buttons, read React props, drive the composer | Anything the UI doesn't expose |
| `env` | The machine that runs the **server** | Set `T3CODE_TELEMETRY_ENABLED=false` | A server you only connect to |

**Product analytics is server-owned**; clients never load PostHog. A browser extension can't turn it
off, and on the hosted service telemetry is outside the user's control. This is accepted. An earlier
plan to block client-side relay tracing with `declarativeNetRequest` was dropped for v0.1.

## 3. Architecture

```
src/core/         One IIFE bundle (esbuild → dist/t3tk-core.js), no framework
  index.js        boot, feature list, MutationObserver sync, window.__t3tk (health, stop)
  react.js        fiber lookup + props walk
  composer.js     find the composer by its props; add a file + text via a synthetic paste
  effortKeys.js   pure key/row helpers for the effort shortcuts (unit-tested)
  modelKeys.js    pure key/slot helpers for the model switcher (unit-tested)
  projectKeys.js  key, slot-order and route helpers for the project switcher (unit-tested)
  pickerDriver.js composer handle and the shared lock for driving the picker unseen
  favoriteOrder.js   model identity and ordering helpers (unit-tested)
  galleryData.js  find images in thread transcript rows; filter and sort them (unit-tested)
  projectColors.js  icon colour → a readable project-name colour (unit-tested)
  features/       compactButton.js, imageAnnotate.js, effortShortcuts.js, arrangeFavorites.js,
                  imageGallery.js, modelSwitcher.js, projectSwitcher.js, projectColors.js
  annotate/       the annotation editor overlay
extension/        MV3 for Chrome and Firefox (≥128); content script in the MAIN world
desktop/          launch.mjs (starts the installed app, injects over a DevTools pipe),
                  install.mjs, find-app.mjs, start.ps1 / start.sh
install.*         per-OS installers (cmd / sh / macOS .command)
scripts/          build, package, telemetry.cmd / telemetry.sh
test/             node:test unit tests; .github/workflows/ci.yml runs them on all three OSes
```

### 3.1 Web loader (extension)

- `content_scripts` with `world: "MAIN"` on `https://app.t3.codes/*`.
- Other origins (a local `t3`, a Tailscale host…) are added on the options page. That requests an
  optional host permission and registers the same script with `scripting.registerContentScripts`,
  so the extension never asks for `<all_urls>`.
- `background` declares both `service_worker` (Chrome) and `scripts` (Firefox).

### 3.2 Desktop loader

The desktop window loads `t3code://app`, which no extension can see. `desktop/launch.mjs`:

1. Starts the app with `--remote-debugging-pipe` (CDP over fds 3/4, NUL-terminated JSON; no network
   port, so nothing else can attach). Removes `NODE_OPTIONS`/`ELECTRON_RUN_AS_NODE` from its env and
   sets `T3CODE_TELEMETRY_ENABLED=false` (unless `--keep-telemetry`).
2. Attaches only to `t3code://app` page targets and uses `Page.addScriptToEvaluateOnNewDocument` +
   `Runtime.evaluate`, then checks that `window.__t3tk` came up.
3. If the app exits without ever showing a `t3code://app` window, T3 Code was already running (it's
   single-instance and the new copy handed over and quit): exit code 3, and the starter tells the
   user to quit T3 Code first. It never kills the running app.

Nothing in the install is modified, so it survives auto-updates. Measured on Windows (0.1.11):

- Chromium quits when the pipe closes, even with `detached: true`, so the launcher must live as long
  as the app. The starters run it hidden.
- Inferred, not yet run for real: `app.relaunch()` (settings such as WSL / server exposure, update
  install) passes `--remote-debugging-pipe` on without fds. A fresh start with that flag and no fds
  runs normally without the toolkit, so a relaunched copy should behave the same.
- Reloads keep the toolkit (`addScriptToEvaluateOnNewDocument`), verified over two `Page.reload`s.

**Install.** `install.cmd` / `install.sh` / `install.command` run `desktop/install.mjs` with T3 Code's
own binary as Node (`ELECTRON_RUN_AS_NODE=1`), falling back to a system `node`. It copies the launcher
and bundle into a per-user folder, records the app path in `config.json`, and adds a shortcut (Start
Menu `.lnk`, a small `~/Applications/*.app` wrapper, or a `.desktop` entry) that runs
`start.ps1`/`start.sh`. Those run `launch.mjs` the same way and report failures in a dialog. Linux
AppImages are found by name (newest `*t3*code*.AppImage`) and re-found after an update renames them.
`--uninstall` removes only the recorded shortcuts and the install folder.

Rejected: `NODE_OPTIONS=--require` (leaks into the bundled server and every provider CLI) and an
`app.asar` patch (overwritten by every update; kept only as a last-resort fallback).

### 3.3 Stable hooks (the main maintenance risk)

- **Never anchor on visible text**; labels are translated.
- Read React props: find a DOM node's `__reactFiber$*` (walking up to the nearest React-rendered
  ancestor, since editor DOM such as ProseMirror has none) and walk `.return` until the props match
  a shape. Prop names survive minification; component names don't.
  - Composer: props with `onCompactContext` (function) and `compactDisabled`.
  - Context section: `ThreadDetailsSection` props with `headingId === "thread-details-context-heading"`.
  - Image viewer: `ExpandedImageDialog` props `{ preview: { images, index }, onClose }`; the caption
    bar is the parent of its `span[aria-live=polite][aria-atomic=true]`.
  - Composer handle: the imperative handle upstream's keybindings call (`openControl`,
    `isModelPickerOpen`, `toggleModelPicker`, `stepReasoningEffort`). On 0.1.11 it isn't on the
    composer's `ref` but in a `useRef` hook of an ancestor, so the lookup walks up from the editor and
    checks each fiber's `ref`, `props.ref` and hook chain (`memoizedState` → `.next`) for that shape.
  - Effort rows: `[role=radiogroup] [data-effort-row][data-effort-level]` in the open model picker.
    0.1.11 sets `data-effort-level="true"`; newer upstream puts the level name there. The label is the
    row's first span. A disabled row means the prompt sets effort (ultrathink).
  - Favorites order: the selected rail button identifies the Favorites tab. The native combobox supplies
    the full filtered key list, including rows outside the virtual viewport, and its normal selection callback.
    The toolkit renders the ordered list in that tab. Search and **Original list** show the native list.
    Toolkit buttons let native click handling finish before they redraw, and focus moves to the picker input
    before a redraw replaces a focused button.
    Order is a toolkit preference in origin-local storage keyed by environment, with provider instance and
    model in each key. Models outside the current view retain their saved positions. The toolkit defers to a
    native sortable list when it finds the upstream sortable-row marker.
  - Sidebar project row (grouped "Boring sidebar" mode only): `li[data-testid="sidebar-project-folder"]`.
    Its hover action `button[data-sidebar-action-for]` is the new-thread button; the gallery button goes
    just before it and copies its class. The row's props carry `group` with `memberProjectRefs`
    (`{ environmentId, projectId }`), `title` and `environmentId`. The sidebar's drag sensors listen for
    pointer presses, so the button stops `pointerdown` from bubbling. With the flat sidebar there is no
    project row and the gallery has no entry point.
- Sync runs on a 50 ms timer after DOM mutations. Not `requestAnimationFrame`, and image loading uses
  load events, not `img.decode()`: both stall in background windows.
- `window.__t3tk.health()` reports `ok | idle | broken` per feature. A throwing feature is marked
  broken and the app keeps working. `window.__t3tk.stop()` removes everything.

## 4. Feature catalog

| Feature | Web | Desktop | Status |
| --- | --- | --- | --- |
| Compact button under Context | ✅ | ✅ | Hooks verified on 0.1.11; the click path is upstream's handler. Not yet seen on a thread with real context usage. |
| Image annotation | ✅ | ✅ | Verified end to end on a local `t3` server in Chromium. |
| Effort shortcuts (Alt/Option+1–6) | ✅ | ✅ | Verified on desktop 0.1.11 (isolated profile): each level set via upstream's own picker row, picker closes, focus returns, nothing typed. |
| Model switcher (Ctrl+Alt+1–9, hold for strip) | ✅ | ✅ | Verified in headless Chromium on a scratch local `t3` server (Nov 25): direct switch both ways, hold/arrow/release, digit in the strip, Esc, peek-without-change, inside the open picker, off switch. Not yet run in the desktop app or on macOS. |
| Project switcher (Ctrl+Shift+1–9, hold for strip) | ✅ | ⚠️ untested | Verified in headless Chromium on a scratch local `t3` server (Nov 25): digit switch from a draft and from a page with no picker (Pull requests), hold strip there from the cached list, arrows, Ctrl+Shift+scroll with wrap, release, release while the list is still loading (wheel, arrow, digit), peek without change keeps the caret, Esc, other Ctrl+Shift keys pass through, arrows select words when the composer has text, Usage page left alone, off switch. Not tested: terminal exclusion, the no-project-with-text toast, desktop (hash routing is handled and unit-tested, not run in the app), macOS. |
| Arrange Favorites across providers | ✅ | ✅ | Verified on 0.1.11 with Chromium, Firefox 160.0.1, and Windows Electron. Order persists in each client profile. |
| Disable telemetry | ⚠️ self-hosted only | ✅ | Env var; see §2. |

Toolkit menu: the titlebar **Toolkit** button opens per-feature switches. They call each feature's
`stop()` or resume its sync, and are stored under `t3tk.disabled-features` in origin-local storage.
`window.__T3TK_DISABLED__` from a loader still wins and shows as locked. Effort shortcuts hide the picker
popover (`html[data-t3tk-effort-silent]`) while they drive it. Favorites drag uses rows that slide with
CSS transforms and saves once on drop, because moving DOM nodes mid-drag dropped pointer capture.
Verified in headless Chromium on a scratch local `t3` server (Nov 25): no visible picker frame during
Alt+3/1/2, Alt+3 with focus in the picker search, drag of the last favorite to the top, and a menu
switch off/on that persists across reload. Not yet run in the desktop app.

Telemetry switch: the desktop launcher adds a DevTools binding (`__t3tkLauncher`) to the windows it
injects. The menu sends `{get}` or `{telemetryOff}` and the launcher answers through
`window.__t3tkLauncherReply`. It only flips `keepTelemetry` in the install's `config.json`, so it
applies at the next start. It is locked when run from source, with `--keep-telemetry`, or when the user
environment already turns telemetry off. Checked with the launcher against headless Chromium, not
against the T3 Code app.

Model switcher: the picker reopens on the Favorites tab each time (checked live), and Ctrl+Alt+digit
has no upstream binding. Both shortcuts go through `pickerDriver.withPicker`, which opens the picker with
`toggleModelPicker()` under the same invisible flag as the effort shortcuts, and one lock stops the two
features driving it at once. Selection calls the native combobox's `onValueChange`, as Arrange
Favorites does. The strip closes on window blur and when the tab is hidden, since the keyup is lost there.
`event.getModifierState("AltGraph")` excludes AltGr, which Windows reports as Ctrl+Alt.

Project switcher: T3 Code has no "go to project" command, so the toolkit uses the new-thread draft's
project picker (`[data-draft-project-trigger]`, a Base UI combobox found by its `items`/`onValueChange`/
`onOpenChange` props). When no picker is shown it routes to "/", which opens the current draft. It opens the
picker with `onOpenChange(true)` under `html[data-t3tk-project-silent]` (hidden), reads each option's item
and the pin toggle's `{pinned, onToggle}` props, closes it and restores focus, then calls `onValueChange`
with the chosen item so the app moves the draft itself. The app lists the current project first, so slot
numbers come from the toolkit's own order (`t3tk.project-order`): kept pins stay, new pins append. The last
list read (`t3tk.project-list`) fills the strip on pages without a picker. The desktop app uses TanStack hash
history (`#/draft/…`) and the web client browser history; `appRoute`/`homeHref` handle both. Settings
and Usage are modals over the current page, so the picker can still be found behind them.

Arranged favorites: the app's Ctrl/Cmd+1-9 jump is a window capture listener mounted with the picker
and it ignores `defaultPrevented` events. The toolkit's listener is added at boot (earlier), so it
answers first with the arranged order.

Gallery: grid rows are `max-content`. With `auto` rows in a fixed-height scroll container, tiles that
clip (`overflow: hidden`, minimum height 0) were squeezed to fit the panel. Tiles are reordered in
place instead of `replaceChildren`, so scroll anchoring survives scan updates.

Candidates: usage-limit alerts, thread export to Markdown,
prompt snippets, annotation of any region of the T3 UI (screen capture) rather than only attachments.
Every feature needs an off switch that fully restores upstream behaviour.

## 5. Non-goals and rules

- Don't touch `~/.t3/userdata` or the T3 database. Talk to the app only through its UI.
- Don't call internal RPCs from injected code. One approved exception: the image gallery reads (never
  writes) through the app's own server API: `orchestration.subscribeShell` for the thread list,
  `GET /api/orchestration/threads/:id/transcript` (falling back to `/bounded` plus `/history` pages for
  threads the server says are too large) with `x-t3-orchestration-protocol: 2`, and `assets.createUrl`
  to get short-lived image URLs. Web uses the page's session cookie; desktop uses the bridge's local
  bearer token and a `/api/auth/websocket-ticket/rpc` ticket, the same way upstream's client connects.
  Only projects in the local environment are read; remote (T3 Connect) members are skipped and counted.
- No telemetry of our own, and no network calls except fetching an image the page already shows and the gallery's
  read-only server reads above.
- Mobile (React Native) is out of scope.

## 6. Verification

Done (Chromium, local `t3` 0.1.11 on a scratch `--base-dir`): bundle boots; composer props found;
section `headingId` lookup works; Annotate button appears in the caption bar; draw/undo/notes work;
"Add to message" attaches `<name>-annotated.png` and pastes the notes.

Arrange Favorites was exercised with two providers on the same release in a scratch Chromium extension
profile and a separate Windows desktop profile. Both checks moved a model across providers, selected
models by click and number, switched to the original list, and restored native behavior on toolkit stop.
The Chromium check also verified search and persistence after a page reload. The desktop check
reopened the launcher with the same isolated profile and confirmed the saved order after restart.
Firefox 160.0.1 loaded the packaged extension in an isolated profile. The check covered local-origin
registration, cross-provider reorder, pointer and digit selection, search, the original list, reload
persistence, and toolkit cleanup.

Image gallery (local `t3` 0.1.12, scratch `--base-dir`, headless Chromium, grouped sidebar on): the button
appears left of the new-thread icon on hover; a long project name is cut short before the icons. A real
mouse click opens it without starting a sidebar drag. Two threads, one of them settled, gave five images:
four user attachments and one agent reply with an absolute local image path. Newest/oldest sort, the source
filter and search work. **Open thread** navigates, **Add to message** attaches the image to the composer, and
Esc closes the lightbox, then the gallery. With no thread open, a full scan
left every thread's `lastVisitedAt`, `opens` and `updatedAt` unchanged. `/bounded` rows have the same shape as
transcript rows. Not run live: tool-output images (covered by unit fixtures), `/history` paging for threads
above the transcript size limit, archived and subagent threads, relative image paths, and the desktop app.
Rows inherited from another thread (forks) are left to that thread, so a fork whose parent was deleted
doesn't show the parent's images.

Still to do:

1. Compact button on a thread that has context usage (needs a provider turn).
2. Firefox: load via `about:debugging` and repeat the annotation test.
3. macOS and Linux launcher with a real app. CI runs the installers on
   all three systems against a stand-in app, which checks the files and menu entries but not a launch.
4. Effort shortcuts in a browser and on macOS (Option+digit), and on a model with fewer levels.
5. Image gallery in the desktop app, on a very long thread, and with tool screenshots.

Desktop, done on Windows with a separate user-data dir (never the live profile): the release zip
installs via `install.cmd` without Node and writes the shortcut (into a scratch folder; the `.lnk`
itself wasn't opened, its `start.ps1` was run directly); the starter launches the app and the toolkit
is active within about a second; a second launch exits with code 3; reloads keep the toolkit;
`--uninstall` removes the shortcut and folder.

## Naming

The README states up front that the project isn't affiliated with the official T3 Code. The icon is
original and the T3 logo isn't used. Re-check T3 Code's trademark guidelines before publishing to a
store, and rename if T3 Tools asks.
