# T3 Code Upgrade Checklist

Use this checklist when validating **T3CodeToolkit** against a new **T3 Code** release. Check compatibility, update changed hooks and version-gated fixes, and verify the release downloads.

---

## 0. Safety & Isolation Rules (Always Follow)

- **Never touch `~/.t3/userdata` or the user's live T3 Code database/profile.**
- **Never kill or restart the user's running T3 Code window.**
- **Always run live checks in an isolated profile** (separate Electron user-data dir, scratch `t3 --base-dir`, or isolated browser profile).
- **Preserve user settings on local install** (existing **T3 Code + Toolkit** shortcut and `telemetryOff` in `config.json`).

---

## 1. Identify the New T3 Code Version & Diff Upstream

- [ ] **Confirm the target T3 Code version** (installed desktop binary / `window.desktopBridge.getUpdateState().currentVersion`, and/or upstream `pingdotgg/t3code` tag).
- [ ] **Compare against current allowlists:**
  - `CHECKED_DESKTOP_VERSIONS` in `src/core/index.js`
  - `hostVersions` on every entry in `VERSION_FIXES` (currently `threadRepositoryOverflow` in `src/core/features/threadRepositoryOverflow.js`)
- [ ] **Check upstream diff / release notes for overlap:**
  - Did T3 Code natively add or change any Toolkit feature? (e.g., native sortable favorites, native Thread Details repository overflow handling, native Compact button, native telemetry toggle, native sidebar ordering/thread limits)
  - For each overlap, decide: **keep**, **adapt**, **gate by `hostVersions`**, or **retire**.

---

## 2. Boot, Desktop Launcher & Compatibility-Gate Checks

Check `desktop/launch.mjs`, `desktop/install.mjs`, `desktop/find-app.mjs`, `desktop/start.ps1`, `desktop/start.sh`, and `src/core/index.js`:

- [ ] **CDP injection works:** `--remote-debugging-pipe` attaches to `t3code(-dev)?://app`, injects via `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate`, and survives page reload.
- [ ] **Single-instance handoff works:** Launching the shortcut while T3 Code is already running exits with code `3` and reports the handoff cleanly (not a generic launch failure / error 130).
- [ ] **Host version detection works:** `window.desktopBridge.getUpdateState()` still returns `{ currentVersion }`.
- [ ] **Unrecognized-version safe flow works:** When `currentVersion` is not in `CHECKED_DESKTOP_VERSIONS`:
  - Compatibility prompt appears with **Continue with features paused** and **Try my features**.
  - **Continue with features paused** leaves T3 Code usable with zero Toolkit features active, shows the **Toolkit disabled** button + toast, and preserves saved switches.
  - **Try my features** enables normal `FEATURES` for the session while keeping `VERSION_FIXES` off.
- [ ] **Telemetry binding works:** `__t3tkLauncher` / `__t3tkLauncherReply` reads and saves `telemetryOff` in `config.json`. A fresh install leaves the opt-out switch unchecked and inherits the environment's telemetry setting. Verify `--keep-telemetry` and `T3CODE_TELEMETRY_ENABLED` handling.
- [ ] **Toolkit titlebar menu works:** `[data-workspace-titlebar-controls]` mounts the **Toolkit** button, all sections render cleanly, toggling any feature off calls `stop()` and restores native UI, and `window.__t3tk.health()` reports no `broken` features.

---

## 3. Per-Feature Hook & Behavior Audit (All 11 Features)

Inspect the new T3 Code renderer bundle / upstream source for every hook below, then verify live in an isolated profile:

### Chat & Images

- [ ] **1. Compact button** (`compact-button` — `src/core/features/compactButton.js`, `src/core/composer.js`)
  - **Hooks:** `.ProseMirror[contenteditable="true"]` → ancestor fiber props `{ onCompactContext, compactDisabled }`; Context section fiber `headingId === "thread-details-context-heading"`.
  - **Check:** Button renders under Context in Thread Details, `Shift+C` triggers it (ignored in text inputs/terminals), respects `compactDisabled`.

- [ ] **2. Image annotation** (`image-annotate` — `src/core/features/imageAnnotate.js`, `src/core/annotate/editor.js`, `src/core/composer.js`)
  - **Hooks:** `ExpandedImageDialog` fiber `{ preview: { images, index }, onClose }`; caption bar parent of `span[aria-live=polite][aria-atomic=true]`; zoomable image fiber `{ src, name, mimeType }`; synthetic `ClipboardEvent("paste")` into `.ProseMirror`.
  - **Check:** **Annotate** button appears in caption bar, `Shift+A` opens editor, auto-open setting works, draw/pins/notes/undo work, **Add to message** attaches `<name>-annotated.png` + notes.

- [ ] **3. Project image gallery** (`image-gallery` — `src/core/features/imageGallery.js`, `src/core/galleryData.js`)
  - **Hooks:** `li[data-testid="sidebar-project-folder"]`, `button[data-sidebar-action-for]`, fiber `group.memberProjectRefs`; desktop `window.desktopBridge.getLocalEnvironmentBootstraps()`, `/.well-known/t3/environment`, `/api/auth/websocket-ticket/rpc`; RPCs `orchestration.subscribeShell`, `orchestration.getArchivedShellSnapshot`, `assets.createUrl`; HTTP `/api/orchestration/threads/:id/transcript`, `/bounded`, `/history?cursor=` with `x-t3-orchestration-protocol: 2`; navigation via `window.__TSR_ROUTER__` / `history.pushState`.
  - **Check:** Hover icon sits left of new-thread button without starting a sidebar drag; scans active **and archived** threads without changing `lastVisitedAt`/`updatedAt`; sort/filter/search, lightbox, **Open thread**, **Add to message**, and Esc close all work.

### Models & Effort

- [ ] **4. Reasoning effort shortcuts** (`effort-shortcuts` — `src/core/features/effortShortcuts.js`, `src/core/pickerDriver.js`)
  - **Hooks:** Composer imperative handle in ancestor ref/hook chain (`openControl`, `isModelPickerOpen`, `toggleModelPicker`, `stepReasoningEffort`); `[data-model-picker-content]`; `[role=radiogroup] [data-effort-row][data-effort-level]`.
  - **Check:** `Alt+1–6` (`Option+1–6` on macOS) switches effort silently without flashing the picker, hold/scroll strip works, focus returns to composer, ignored in `.xterm` / `[data-terminal]`.

- [ ] **5. Favorite model shortcuts** (`model-switcher` — `src/core/features/modelSwitcher.js`, `src/core/pickerDriver.js`)
  - **Hooks:** `toggleModelPicker()`, `[data-model-picker-content] [data-model-picker-provider="favorites"] button`, combobox `onValueChange` & `filteredItems`.
  - **Check:** `Ctrl+Alt+1–9` switches models, hold strip + arrows/wheel/digit/Esc work, AltGr is ignored, follows arranged order when `arrange-favorites` is enabled.

- [ ] **6. Arrange Favorites** (`arrange-favorites` — `src/core/features/arrangeFavorites.js`)
  - **Hooks:** `[data-model-picker-content]`, `[data-model-picker-provider="favorites"] button[aria-pressed="true"]`, `input[role="combobox"]`, `[role="listbox"]`, catalog fiber `{ environmentId, instanceEntries, modelOptionsByInstance }`, combobox fiber `{ virtualized: true, filter: null, filteredItems, onValueChange }`, native deferral marker `[data-model-picker-sortable-index]`.
  - **Check:** **Arrange Favorites** toggles editing without closing the picker, cross-provider drag & `↑`/`↓` reorder, `Ctrl/Cmd+1–9` jump, search & **Original list** show native list, persists across reload, defers cleanly if upstream adds native sortable favorites.

### Projects & Sidebar

- [ ] **7. Project switcher** (`project-switcher` — `src/core/features/projectSwitcher.js`)
  - **Hooks:** `[data-draft-project-trigger]`, combobox fiber `{ onValueChange, onOpenChange, items }`, `[data-slot="combobox-popup"] [role="option"]`, `input[aria-label="Search projects"]`, `[data-slot="combobox-list"]`, pin toggle fiber `{ pinned, onToggle }`, desktop hash routing vs web history routing.
  - **Check:** `Ctrl+Shift+1–9` switches projects from draft and non-draft routes, hold strip + arrows/wheel/Esc work, drag-reordering pinned slots inside the project picker persists, ignored in terminals.

- [ ] **8. Sidebar pinned-project order** (`sidebar-project-order` — `src/core/features/sidebarProjectOrder.js`)
  - **Hooks:** `li[data-testid="sidebar-project-folder"]`, `button[data-sidebar-row^="folder:"]`, `[data-sidebar-parent^="folder:"]`, fiber `group.{ projectKey, pinned }`, `span.truncate`.
  - **Check:** Pinned project folders reorder to match `project-switcher` slot order with slot badges, child thread rows move with their folder, toggling off restores native order.

- [ ] **9. Project colours** (`project-colors` — `src/core/features/projectColors.js`)
  - **Hooks:** `li[data-testid="sidebar-project-folder"] button[data-sidebar-row^="folder:"] > span.truncate`, `[data-draft-project-trigger]`.
  - **Check:** Sidebar project names and draft project heading pick up readable colours from SVG/image icons and revert cleanly when disabled.

- [ ] **10. Project Show more / Show less (thread limit)** (`project-thread-menu` — `src/core/features/projectThreadMenu.js`)
  - **Hooks:** `li[data-testid="sidebar-project-folder"] button[data-sidebar-row^="folder:"]`, `[data-sidebar-parent^="folder:"]`, `[aria-current]`, UI API `contextMenu.show` (discovered via toast module URL).
  - **Check:** Right-clicking a project folder shows **Show more** / **Show less**, hides rows past the configured limit while keeping the active thread visible, nested rows hide with their parent, Toolkit menu limit input persists.

### Thread Details (Version-Gated)

- [ ] **11. Thread Details repository organizer & overflow fix** (`fix-thread-repository-overflow` — `src/core/features/threadRepositoryOverflow.js`, `src/core/features/repositoryOrganizer.js`)
  - **Hooks:** `[data-thread-details-card]`, `:scope > div > [data-slot="scroll-area-viewport"]`, exact measurement selector strings (`SCROLLING_LISTS` / `UPDATED_LISTS`), `section:has(> div > #thread-details-version-control-heading) > div:last-child`, `div[role="group"].flex.flex-col:has(> button[aria-expanded])`.
  - **High-risk check:** Inspect the new T3 Code renderer bundle for the exact `querySelectorAll(...)` measurement selector string used by Thread Details (this changed between `0.1.12` and `0.1.13`). Update the selector match and `hostVersions`, or retire the measurement patch if upstream no longer needs it.
  - **Check:** In a multi-repository thread, pin/reorder/hide/filter repositories and verify expanding rows does not collapse Thread Details into essential density.

---

## 4. Update Allowlists, Tests & Documentation

- [ ] Add the verified T3 Code version to `CHECKED_DESKTOP_VERSIONS` in `src/core/index.js`.
- [ ] Update `hostVersions` in `VERSION_FIXES` (`src/core/features/threadRepositoryOverflow.js`) if still needed for the new version.
- [ ] Add or update unit tests in `test/` for any changed hooks, selectors, or version gates.
- [ ] Update `DESIGN.md` and `README.md` if supported versions, hooks, or user-visible behavior changed.

---

## 5. Build, Automated Tests & Isolated Verification

- [ ] Run packaging and full test suite:
  ```bash
  npm run package && npm test
  ```
- [ ] **Desktop smoke test (isolated profile):** Launch the new T3 Code build with the freshly built bundle, verify `window.__t3tk.version` and `window.__t3tk.health()`, confirm zero console errors, and test any features touched by upstream changes.
- [ ] **Browser extension check (if web hooks changed):** Verify unpacked extension in Chromium/Edge and temporary add-on in Firefox on an isolated profile.

---

## 6. Release & Local Install (When Publishing)

CI (`.github/workflows/ci.yml`) enforces that any version bump pushed to `main` has a **matching annotated tag** on the exact same commit.

- [ ] Bump version in `package.json`, `package-lock.json`, and `extension/manifest.json` together:
  ```bash
  npm run release:version -- patch   # or minor / major
  ```
- [ ] Rebuild packages and run all tests:
  ```bash
  npm run package && npm test
  ```
- [ ] Review and commit the intended release changes on `main`. Create an **annotated tag** `vX.Y.Z` on that commit with a short user-facing summary on the first line:
  ```bash
  git tag -a vX.Y.Z -m "Support T3 Code <host-version> and <short summary>"
  ```
- [ ] Push `main` and the tag together (`git push --atomic origin main vX.Y.Z`).
- [ ] Confirm all CI jobs pass (`ubuntu-latest`, `windows-latest`, `macos-latest`) and `Publish GitHub release` uploads all 4 ZIPs (Desktop, Chrome, Edge, Firefox) + `SHA256SUMS.txt`.
- [ ] **If installing locally for the user:** Install from the verified release ZIP (keeping the user's shortcut and `telemetryOff` setting) and remind the user to quit T3 Code and reopen **T3 Code + Toolkit**.
