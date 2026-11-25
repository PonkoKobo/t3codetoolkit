export const REPOSITORY_ORGANIZER_CSS = `
[data-t3tk-repo-managed] { reading-flow: flex-visual; }
[data-t3tk-repo-managed] > * { order: var(--t3tk-repo-order, 0); }
[data-t3tk-repo-managed] > [data-t3tk-repo-tail] { order: 1000001; }
[data-t3tk-repo-managed] > .t3tk-repo-organize { order: 1; }
[data-t3tk-repo-managed] > .t3tk-repo-more { order: 1000000; }
[data-t3tk-repo-hidden] { display: none !important; }
.t3tk-repo-organize, .t3tk-repo-more {
  border: 0; border-radius: 6px; min-height: 32px; padding-inline: 12px;
  background: transparent; color: var(--muted-foreground, #999); cursor: pointer;
  text-align: start; font: inherit; font-size: 12px;
}
.t3tk-repo-more { padding-inline-start: 26px; }
.t3tk-repo-organize:hover, .t3tk-repo-more:hover {
  background: color-mix(in oklab, var(--foreground, #888) 8%, transparent);
  color: var(--foreground, inherit);
}
.t3tk-repo-organize:focus-visible, .t3tk-repo-more:focus-visible, .t3tk-repo-tools input:focus-visible {
  outline: 2px solid var(--ring, #6b8cff); outline-offset: -2px;
}
.t3tk-repo-dialog {
  position: fixed; inset: 0; margin: auto; width: min(520px, calc(100vw - 24px));
  max-height: min(640px, calc(100dvh - 24px)); box-sizing: border-box;
  padding: 12px; overflow: hidden;
  border: 1px solid var(--border, rgb(128 128 128 / 25%)); border-radius: var(--radius, 10px);
  background: var(--popover, var(--background, #111)); color: var(--popover-foreground, var(--foreground, #eee));
  box-shadow: 0 10px 30px rgb(0 0 0 / 35%); font: 13px/1.4 var(--font-sans, system-ui, sans-serif);
  -webkit-app-region: no-drag;
}
.t3tk-repo-dialog[open] { display: flex; flex-direction: column; gap: 8px; }
.t3tk-repo-dialog::backdrop { background: rgb(0 0 0 / 45%); }
.t3tk-repo-dialog header, .t3tk-repo-tools, .t3tk-repo-dialog li { display: flex; align-items: center; gap: 6px; }
.t3tk-repo-dialog h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
.t3tk-repo-tools { flex-wrap: wrap; }
.t3tk-repo-tools input {
  flex: 1; min-width: 120px; padding: 5px 8px; border-radius: 6px;
  background: transparent; color: inherit; border: 1px solid var(--border, rgb(128 128 128 / 25%));
}
.t3tk-repo-dialog ul { min-height: 0; margin: 0; padding: 0; overflow: auto; overscroll-behavior: contain; }
.t3tk-repo-dialog li { min-height: 38px; padding: 4px; border-top: 1px solid var(--border, rgb(128 128 128 / 25%)); }
.t3tk-repo-name { flex: 1; min-width: 0; }
.t3tk-repo-name > * { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.t3tk-repo-name small, .t3tk-repo-dialog li[data-hidden] .t3tk-repo-name { color: var(--muted-foreground, #999); }
.t3tk-repo-dialog li button { min-width: 28px; justify-content: center; }
`;
