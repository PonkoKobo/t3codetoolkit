// Colors come from upstream theme variables so light, dark, and custom themes all apply.
export const CSS = `
.t3tk-loaded {
  display: inline-flex; flex: none; align-items: center; gap: 5px; margin-inline-end: 4px;
  padding: 2px 7px; border: 1px solid var(--border, rgb(128 128 128 / 25%)); border-radius: 999px;
  color: var(--muted-foreground, #999); font: 11px/16px var(--font-sans, system-ui, sans-serif);
  white-space: nowrap; pointer-events: auto; -webkit-app-region: no-drag;
}
button.t3tk-loaded { background: transparent; cursor: pointer; }
button[data-t3tk-status-fallback] { position: fixed; top: 8px; right: 8px; z-index: 2147483001; background: var(--background, Canvas); }
button.t3tk-loaded:hover, button.t3tk-loaded[aria-expanded="true"] {
  color: var(--foreground, inherit); background: color-mix(in oklab, var(--foreground, #888) 8%, transparent);
}
button.t3tk-loaded:focus-visible { outline: 2px solid var(--ring, #6b8cff); outline-offset: 1px; }
.t3tk-loaded svg { width: 12px; height: 12px; flex: none; color: light-dark(#16834b, #4ade80); }
.t3tk-menu {
  position: fixed; z-index: 2147483002; box-sizing: border-box; width: min(620px, calc(100vw - 16px));
  max-height: calc(100vh - 80px); overflow: auto;
  padding: 16px; border: 1px solid var(--border, rgb(128 128 128 / 25%)); border-radius: var(--radius, 10px);
  background: var(--popover, var(--background, #111)); color: var(--popover-foreground, var(--foreground, #eee));
  box-shadow: 0 10px 30px rgb(0 0 0 / 35%); font: 13px/1.35 var(--font-sans, system-ui, sans-serif);
  -webkit-app-region: no-drag;
}
.t3tk-menu small { display: block; color: var(--muted-foreground, #999); font-size: 11px; }
.t3tk-menu-heading { padding: 0 0 12px; font-size: 15px; font-weight: 600; border-bottom: 1px solid var(--border, rgb(128 128 128 / 25%)); }
.t3tk-menu-heading small { font-weight: 400; margin-top: 2px; }
.t3tk-menu-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px 20px; padding-top: 12px; }
.t3tk-menu-column { display: grid; gap: 13px; align-content: start; }
.t3tk-menu-row { display: flex; align-items: flex-start; gap: 8px; padding: 5px; border-radius: 6px; cursor: pointer; }
.t3tk-menu-row:hover { background: color-mix(in oklab, var(--foreground, #888) 8%, transparent); }
.t3tk-menu-row input { flex: none; margin: 2px 0 0; accent-color: var(--primary, #4f6bff); }
.t3tk-menu-row small { margin-top: 3px; }
.t3tk-menu-row small:empty { display: none; }
.t3tk-menu-row kbd { padding: 1px 4px; border: 1px solid var(--border); border-radius: 4px; font: 10px var(--font-mono, monospace); white-space: nowrap; }
.t3tk-menu-row:has(input:disabled) { cursor: default; opacity: 0.6; }
.t3tk-menu-setting { cursor: default; align-items: center; }
.t3tk-menu-setting, .t3tk-menu-suboption { margin-inline-start: 21px; font-size: 12px; }
.t3tk-menu-setting input[type="number"] {
  width: 56px; margin: 0 0 0 auto; padding: 2px 6px; border: 1px solid var(--border, rgb(128 128 128 / 25%));
  border-radius: 6px; background: transparent; color: inherit; font: inherit;
}
.t3tk-menu-build { display: block; margin-top: 2px; font-weight: 400; }
[data-t3tk-thread-hidden] { display: none !important; }
.t3tk-menu-section + .t3tk-menu-section { padding-top: 11px; border-top: 1px solid var(--border, rgb(128 128 128 / 25%)); }
.t3tk-menu-subheading { margin: 0 0 4px 5px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.065em; color: var(--muted-foreground, #999); }
.t3tk-antigravity-usage {
  display: grid; gap: 5px; flex: none; padding: 10px 20px;
  border-bottom: 1px solid var(--border, rgb(128 128 128 / 25%));
  color: var(--muted-foreground, inherit); font-size: 12px;
}
.t3tk-antigravity-usage h2 { margin: 0; color: var(--foreground, inherit); font: inherit; font-weight: 600; }
.t3tk-antigravity-usage p { margin: 0; }
.t3tk-quota-commands, .t3tk-quota-step { display: flex; flex-wrap: wrap; align-items: center; }
.t3tk-quota-commands { gap: 5px 16px; }
.t3tk-quota-step { gap: 6px; }
.t3tk-quota-step button, .t3tk-quota-open-terminal {
  padding: 1px 7px; border: 1px solid var(--border, rgb(128 128 128 / 25%)); border-radius: 5px;
  background: var(--muted, transparent); color: var(--foreground, inherit);
  font: 12px/18px var(--font-mono, monospace); cursor: pointer;
}
.t3tk-quota-open-terminal { font-family: inherit; }
.t3tk-quota-step button:hover, .t3tk-quota-open-terminal:hover { border-color: var(--muted-foreground, #888); }
.t3tk-quota-step button:focus-visible, .t3tk-quota-open-terminal:focus-visible { outline: 2px solid var(--ring, #6b8cff); outline-offset: 2px; }
.t3tk-quota-popover { inset: auto; margin: 0; width: min(320px, calc(100vw - 16px)); }
.t3tk-quota-popover header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.t3tk-quota-popover h2 { margin: 0; font-size: 14px; font-weight: 650; }
.t3tk-quota-popover h3 { margin: 12px 0 4px; font-size: 12px; font-weight: 650; }
.t3tk-quota-popover dl {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; margin: 0;
  border-top: 1px solid var(--border, rgb(128 128 128 / 25%)); padding-top: 6px;
}
.t3tk-quota-popover dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.t3tk-quota-popover p { margin: 10px 0 0; color: var(--muted-foreground, #999); font-size: 11px; }
.t3tk-quota-popover p:empty { display: none; }
@media (max-width: 520px) {
  .t3tk-menu-grid { grid-template-columns: minmax(0, 1fr); }
  .t3tk-menu-column + .t3tk-menu-column { padding-top: 11px; border-top: 1px solid var(--border, rgb(128 128 128 / 25%)); }
}
.t3tk-compact-row kbd,
.t3tk-effort-key {
  flex: none; margin-inline-start: auto; padding: 0 4px; border: 1px solid var(--border, rgb(128 128 128 / 25%));
  border-radius: 4px; color: var(--muted-foreground, #999); font: 10px/15px var(--font-mono, monospace);
  white-space: nowrap;
}
/* While an effort shortcut drives the model picker, keep the picker invisible and unanimated. */
html[data-t3tk-effort-silent] [data-slot="popover-positioner"]:has([data-model-picker-content]),
html[data-t3tk-effort-silent] [data-slot="popover-positioner"]:has([data-model-picker-content]) *,
html[data-t3tk-effort-silent] [data-slot="popover-backdrop"] {
  opacity: 0 !important; transition: none !important; animation: none !important; pointer-events: none !important;
}
/* While the project switcher reads the draft's project picker, keep that picker invisible. */
html[data-t3tk-project-silent] [data-slot="combobox-positioner"]:has([data-slot="combobox-popup"]),
html[data-t3tk-project-silent] [data-slot="combobox-positioner"]:has([data-slot="combobox-popup"]) * {
  opacity: 0 !important; transition: none !important; animation: none !important; pointer-events: none !important;
}
/* Effort, favorite models and favorite projects, shown while their shortcuts are held. */
.t3tk-carousel {
  position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 2147483001;
  max-width: min(920px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 6px; padding: 10px;
  border: 1px solid var(--border, rgb(128 128 128 / 25%)); border-radius: var(--radius, 10px);
  background: var(--popover, var(--background, #111)); color: var(--popover-foreground, var(--foreground, #eee));
  box-shadow: 0 10px 30px rgb(0 0 0 / 35%); font: 13px/1.35 var(--font-sans, system-ui, sans-serif);
}
.t3tk-carousel > .t3tk-hint { text-align: center; }
.t3tk-carousel-list { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: thin; }
.t3tk-carousel-item {
  flex: none; width: 150px; display: grid; grid-template-columns: auto 1fr; column-gap: 6px; align-items: center;
  padding: 6px 8px; border: 1px solid var(--border, rgb(128 128 128 / 25%)); border-radius: calc(var(--radius, 10px) - 2px);
  cursor: pointer;
}
.t3tk-carousel-item span, .t3tk-carousel-item small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t3tk-carousel-item small { grid-column: 2; color: var(--muted-foreground, #999); font-size: 11px; }
.t3tk-carousel-item kbd {
  grid-row: span 2; min-width: 18px; padding: 0 4px; text-align: center; border: 1px solid var(--border, rgb(128 128 128 / 25%));
  border-radius: 4px; color: var(--muted-foreground, #999); font: 11px/18px var(--font-mono, monospace);
}
.t3tk-carousel-item[data-current] { background: color-mix(in oklab, var(--foreground, #888) 8%, transparent); }
.t3tk-carousel-item[aria-selected="true"] { border-color: var(--primary, #4f6bff); background: color-mix(in oklab, var(--primary, #4f6bff) 22%, transparent); }
.t3tk-carousel-item[data-disabled] { opacity: .45; }
[data-t3tk-effort-carousel] .t3tk-carousel-item { width: auto; min-width: 96px; }
.t3tk-compact-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin: 6px 0 0; padding: 0 2px;
}
.t3tk-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px;
  border-radius: calc(var(--radius, 10px) - 2px); border: 1px solid var(--border, rgb(128 128 128 / 25%));
  background: transparent; color: var(--foreground, inherit); font: inherit; font-size: 12px;
  cursor: pointer; white-space: nowrap; -webkit-app-region: no-drag;
}
.t3tk-btn:hover:not(:disabled) { background: color-mix(in oklab, var(--foreground, #888) 8%, transparent); }
.t3tk-btn:focus-visible { outline: 2px solid var(--ring, #6b8cff); outline-offset: 1px; }
.t3tk-btn:disabled { opacity: .45; cursor: default; }
.t3tk-btn[data-primary] { background: var(--primary, #4f6bff); color: var(--primary-foreground, #fff); border-color: transparent; }
.t3tk-btn[data-active] { background: color-mix(in oklab, var(--primary, #4f6bff) 22%, transparent); border-color: var(--primary, #4f6bff); }
.t3tk-btn svg { width: 14px; height: 14px; flex: none; }
.t3tk-hint { color: var(--muted-foreground, #999); font-size: 11px; }
.t3tk-media-btn { color: rgb(255 255 255 / 85%); border-color: rgb(255 255 255 / 25%); height: 24px; }
.t3tk-media-btn kbd {
  padding: 0 4px; border: 1px solid rgb(255 255 255 / 25%); border-radius: 4px;
  color: rgb(255 255 255 / 75%); font: 10px/14px var(--font-mono, monospace);
}

[data-t3tk-favorites-native] { display: none !important; }
.t3tk-favorites { display: flex; flex-direction: column; min-height: 0; }
.t3tk-favorites[data-arranged] { flex: 1; }
.t3tk-favorites-toolbar { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 8px; }
.t3tk-favorites-list { list-style: none; margin: 0; padding: 3px 8px 6px; overflow: auto; }
.t3tk-favorites-list[hidden] { display: none; }
.t3tk-favorites-list li { display: flex; align-items: center; gap: 4px; margin: 3px 0; }
.t3tk-favorites-number { min-width: 14px; text-align: center; font-size: 11px; color: var(--muted-foreground, #999); }
.t3tk-favorite-model {
  flex: 1; min-width: 0; display: block; overflow: hidden; text-overflow: ellipsis;
  text-align: left; height: auto; padding: 3px 6px; line-height: 1.2;
}
.t3tk-favorite-model small { display: block; overflow: hidden; text-overflow: ellipsis; color: var(--muted-foreground, #999); }
.t3tk-favorites-grip {
  flex: none; width: 14px; text-align: center; color: var(--muted-foreground, #999); cursor: grab;
  touch-action: none; user-select: none;
}
.t3tk-favorites-list li { transition: transform 120ms ease; }
.t3tk-favorites-list li[data-dragging] { position: relative; z-index: 1; opacity: 0.8; transition: none; }
.t3tk-favorites-list li[data-dragging] .t3tk-favorites-grip { cursor: grabbing; }
[data-t3tk-project-list] { display: flex; flex-direction: column; }
[data-t3tk-project-list] > [data-t3tk-slot] { transition: transform 120ms ease; }
[data-t3tk-project-list] > [data-t3tk-dragging] { position: relative; z-index: 1; opacity: 0.85; transition: none; }
.t3tk-project-slot {
  flex: none; display: inline-flex; align-items: center; gap: 2px; margin-inline-end: 6px;
  color: var(--muted-foreground, #999); cursor: grab; touch-action: none; user-select: none;
}
[data-t3tk-project-list] > [data-t3tk-dragging] .t3tk-project-slot { cursor: grabbing; }
.t3tk-project-slot kbd {
  min-width: 16px; padding: 0 3px; text-align: center; border: 1px solid var(--border, rgb(128 128 128 / 25%));
  border-radius: 4px; font: 10px/15px var(--font-mono, monospace);
}
.t3tk-project-grip { width: 9px; font-size: 11px; opacity: 0.45; }
[data-t3tk-slot]:hover .t3tk-project-grip { opacity: 0.9; }
:not([data-t3tk-project-list]) > [data-t3tk-slot] .t3tk-project-slot { cursor: default; }
:not([data-t3tk-project-list]) > [data-t3tk-slot] .t3tk-project-grip { visibility: hidden; }
[data-t3tk-folder-slot]::after {
  content: attr(data-t3tk-folder-slot); margin-inline-start: 6px; padding: 0 3px; border-radius: 4px;
  border: 1px solid var(--border, rgb(128 128 128 / 25%)); font: 10px/14px var(--font-mono, monospace);
  color: var(--muted-foreground, #999);
}
.t3tk-favorites-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

/* Electron draws the native window buttons above all web content. Keep both toolbars below them. */
.t3tk-overlay {
  position: fixed; inset: 0; z-index: 2147483000; box-sizing: border-box;
  padding-top: calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, 0px));
  -webkit-app-region: no-drag;
}
.t3tk-annotate {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr); grid-template-columns: minmax(0, 1fr);
  background: #131416; color: #eee; font: 13px/1.4 var(--font-sans, system-ui, sans-serif);
}
.t3tk-annotate * { box-sizing: border-box; }
.t3tk-annotate .t3tk-btn { color: #eee; border-color: rgb(255 255 255 / 22%); }
.t3tk-annotate-bar {
  display: flex; align-items: center; gap: 6px; padding: 8px 14px; min-width: 0;
}
.t3tk-annotate-title { font-weight: 600; max-width: 32ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t3tk-annotate-bar .t3tk-hint { flex: 1; min-width: 0; color: #9a9ca3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0 8px; }
.t3tk-stage { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; min-width: 0; padding: 4px 14px 14px; gap: 10px; }
/* Scrolls when zoomed in. Auto margins center the canvas only while it fits, so no part of a
   zoomed image ends up beyond the scrollable area. */
.t3tk-board { display: grid; overflow: auto; container-type: size; margin: 1px; overscroll-behavior: contain; }
/* Fill the space, enlarging small images up to 2x. */
.t3tk-board canvas {
  display: block; margin: auto; height: auto;
  width: calc(min(calc(var(--board-width) * 2), 100cqw, calc(100cqh * var(--board-ratio))) * var(--zoom, 1));
  background: #191a1d; border-radius: 8px; outline: 1px dashed rgb(255 255 255 / 10%);
  touch-action: none; cursor: crosshair;
}
.t3tk-annotate-dock { display: grid; justify-items: center; gap: 8px; width: min(100%, 680px); margin-inline: auto; }
.t3tk-annotate-composer {
  display: flex; align-items: flex-end; gap: 6px; width: 100%; padding: 6px 6px 6px 14px;
  border: 1px solid rgb(255 255 255 / 16%); border-radius: 22px; background: #202125;
}
.t3tk-annotate-composer:focus-within { border-color: var(--ring, #6b8cff); }
.t3tk-annotate .t3tk-annotate-composer textarea {
  flex: 1; min-width: 0; max-height: 30vh; padding: 6px 0; border: 0; border-radius: 0; background: none;
  color: inherit; font: inherit; resize: none; outline: none; field-sizing: content;
}
.t3tk-send {
  flex: none; width: 32px; height: 32px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  display: grid; place-items: center; background: #eee; color: #111;
}
.t3tk-send svg { width: 18px; height: 18px; }
.t3tk-send:disabled { opacity: 0.5; cursor: default; }
.t3tk-send:focus-visible { outline: 2px solid var(--ring, #6b8cff); outline-offset: 2px; }
.t3tk-pop {
  position: fixed; z-index: 2; width: 280px; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: start;
  padding: 8px; border-radius: 12px; background: #202125; border: 1px solid rgb(255 255 255 / 16%);
  box-shadow: 0 12px 32px rgb(0 0 0 / 50%);
}
.t3tk-pop[hidden] { display: none; }
.t3tk-pop-num { width: 22px; height: 22px; margin-top: 3px; border-radius: 50%; display: grid; place-items: center; font-weight: 600; font-size: 12px; line-height: 1; }
.t3tk-pop textarea {
  width: 100%; min-height: 28px; max-height: 40vh; padding: 4px 2px; border: 0; background: none; color: #eee;
  font: inherit; resize: none; outline: none; field-sizing: content;
}
.t3tk-pop [data-pop-remove] { background: none; border: 0; color: #aaa; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 4px; border-radius: 6px; }
.t3tk-pop [data-pop-remove]:hover { color: #fff; background: rgb(255 255 255 / 8%); }
.t3tk-annotate-tools {
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px 8px;
  padding: 4px 6px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 12px; background: #242529;
}
.t3tk-annotate-tools > div { display: flex; align-items: center; gap: 3px; }
.t3tk-annotate-tools .t3tk-btn { padding-inline: 6px; border-color: transparent; }
.t3tk-annotate-tools .t3tk-btn[aria-pressed="true"] { background: #373b46; border-color: #777d87; }
.t3tk-swatch { width: 16px; height: 16px; margin: 0 2px; border-radius: 50%; border: 0; cursor: pointer; padding: 0; }
.t3tk-swatch:is([aria-pressed="true"], :focus-visible) { outline: 1px solid #fff; outline-offset: 2px; }
.t3tk-toast, .t3tk-annotate-dismiss {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483001;
  background: #222; color: #eee; padding: 8px 14px; border-radius: 8px; font: 13px system-ui, sans-serif;
  box-shadow: 0 6px 24px rgb(0 0 0 / 40%);
}
.t3tk-annotate-dismiss {
  top: calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, 0px) + 46px);
  bottom: auto; pointer-events: none;
}
.t3tk-annotate-dismiss:empty { opacity: 0; }
/* While the row's hover icons show, end the project name before them instead of under them. */
li[data-testid="sidebar-project-folder"]:has([data-t3tk-gallery-open]):is(:hover, :focus-within) [data-sidebar-row] .truncate { margin-right: 46px; }
.t3tk-gallery {
  display: flex; flex-direction: column;
  background: var(--background, #111); color: var(--foreground, #eee); font: 13px/1.4 var(--font-sans, system-ui, sans-serif);
}
.t3tk-gallery * { box-sizing: border-box; }
.t3tk-gallery-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px;
  border-bottom: 1px solid var(--border, rgb(128 128 128 / 25%));
}
.t3tk-gallery-bar .t3tk-spacer { flex: 1; }
.t3tk-gallery-title { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; margin-right: 6px; max-width: 40ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t3tk-gallery-icon svg { width: 16px; height: 16px; display: block; }
.t3tk-gallery-input {
  height: 28px; border-radius: calc(var(--radius, 10px) - 2px); border: 1px solid var(--border, rgb(128 128 128 / 25%));
  background: var(--background, transparent); color: inherit; font: inherit; font-size: 12px; padding: 0 8px;
}
input.t3tk-gallery-input { width: 200px; }
.t3tk-gallery-input:focus-visible { outline: 2px solid var(--ring, #6b8cff); outline-offset: 1px; }
.t3tk-gallery-body { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
.t3tk-gallery-grid {
  flex: 1; min-height: 0; overflow: auto; padding: 14px; display: grid; gap: 12px; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  /* max-content rows: auto rows were squeezed to fit the panel height (the tiles clip, so their
     minimum height is 0), which collapsed every tile to its caption. */
  grid-auto-rows: max-content; overscroll-behavior: contain;
}
.t3tk-gallery-empty { position: absolute; inset: 40% 0 auto; text-align: center; margin: 0; }
.t3tk-gallery-tile {
  display: flex; flex-direction: column; padding: 0; border: 1px solid var(--border, rgb(128 128 128 / 25%));
  border-radius: var(--radius, 10px); overflow: hidden; background: color-mix(in oklab, var(--foreground, #888) 4%, transparent);
  color: inherit; font: inherit; text-align: left; cursor: pointer;
  /* Skip layout and paint for tiles far off screen; the size hint keeps the scrollbar steady. */
  content-visibility: auto; contain-intrinsic-size: auto 180px;
}
.t3tk-gallery-tile:hover { border-color: var(--primary, #4f6bff); }
.t3tk-gallery-tile:focus-visible { outline: 2px solid var(--ring, #6b8cff); outline-offset: 2px; }
.t3tk-gallery-thumb {
  aspect-ratio: 4 / 3; display: grid; place-items: center; overflow: hidden;
  background: repeating-conic-gradient(rgb(128 128 128 / 12%) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
}
.t3tk-gallery-thumb img { width: 100%; height: 100%; object-fit: contain; }
.t3tk-gallery-caption { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; min-width: 0; }
.t3tk-gallery-caption span, .t3tk-gallery-caption small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t3tk-gallery-caption small { color: var(--muted-foreground, #999); font-size: 11px; }
.t3tk-gallery-lightbox {
  position: absolute; inset: 0; z-index: 1; display: grid; grid-template-columns: 1fr 300px; grid-template-rows: auto 1fr;
  background: rgb(0 0 0 / 92%); color: #eee;
}
.t3tk-gallery-lightbox .t3tk-btn { color: #eee; border-color: rgb(255 255 255 / 22%); }
.t3tk-gallery-back { grid-column: 1 / -1; justify-self: start; margin: 10px 14px; }
.t3tk-gallery-full { display: grid; place-items: center; min-height: 0; padding: 8px 16px 16px; }
.t3tk-gallery-full img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 10px 40px rgb(0 0 0 / 50%); }
.t3tk-gallery-details { display: flex; flex-direction: column; gap: 6px; padding: 8px 14px; border-left: 1px solid rgb(255 255 255 / 12%); overflow: auto; min-height: 0; word-break: break-word; }
.t3tk-gallery-details span { color: #bbb; }
.t3tk-gallery-path { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; }
.t3tk-gallery-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
@media (max-width: 720px) {
  .t3tk-gallery-lightbox { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto; }
  .t3tk-gallery-details { border-left: 0; border-top: 1px solid rgb(255 255 255 / 12%); max-height: 40vh; }
  input.t3tk-gallery-input { width: 100%; }
}
@media (max-width: 720px) {
  .t3tk-annotate-bar .t3tk-hint { display: none; }
  .t3tk-annotate-bar .t3tk-annotate-title { flex: 1; }
}
`;

export function toast(message, ms = 3200) {
  // One at a time: a newer message replaces the one still showing.
  // Reuse the one showing, so quick repeats (effort shortcuts) update it in place without a blink.
  let el = document.querySelector(".t3tk-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "t3tk-toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}
let toastTimer = 0;

export const ICONS = {
  hammer:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/></svg>',
  compact:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/></svg>',
  annotate:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  gallery:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
};
