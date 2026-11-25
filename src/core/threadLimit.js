// Pure helpers for "compact" sidebar projects, which list only their first few threads.

export const LIMIT_KEY = "t3tk.project-thread-limit";
export const COMPACT_KEY = "t3tk.project-thread-compact";
export const DEFAULT_LIMIT = 5;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 50;

/** A whole number of threads within range; anything unusable becomes the default. */
export function clampLimit(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(n)));
}

/** Project keys stored as compact; drops anything that isn't a non-empty string. */
export function parseCompact(json) {
  try {
    const value = JSON.parse(json ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((key) => typeof key === "string" && key) : []);
  } catch {
    return new Set();
  }
}

/**
 * The one Show more / Show less entry for a project's context menu:
 * expand (collapsed project), full (list every thread), compact (list the first `limit`) or
 * collapse (nothing to trim, so do what the header does).
 */
export function menuChoice({ expanded, compact, threads, hiddenThreads, limit }) {
  if (!expanded) return { label: "Show more", action: "expand" };
  if (compact && threads > limit) {
    return { label: hiddenThreads > 0 ? `Show more (${hiddenThreads} hidden)` : "Show more", action: "full" };
  }
  if (!compact && threads > limit) return { label: `Show less (first ${limit})`, action: "compact" };
  return { label: "Show less", action: "collapse" };
}

/**
 * Which rows of one project folder to hide. `rows` are in sidebar order; each is
 * `{ top, current }`: `top` for a thread directly under the project, otherwise a row nested under
 * the closest `top` row before it (a delegated thread). The first `limit` threads stay, and so does
 * the open thread with the thread it is nested under. Nested rows follow their parent.
 * Returns one boolean per row and the number of hidden top-level threads.
 */
export function hiddenRows(rows, limit) {
  const hidden = new Array(rows.length).fill(false);
  let groupStart = -1;
  let count = 0;
  let hiddenThreads = 0;
  const finish = (end) => {
    if (groupStart < 0) return;
    const keep = count <= limit || rows.slice(groupStart, end).some((row) => row.current);
    if (!keep) {
      hiddenThreads++;
      for (let i = groupStart; i < end; i++) hidden[i] = true;
    }
  };
  rows.forEach((row, i) => {
    if (!row.top) return;
    finish(i);
    groupStart = i;
    count++;
  });
  finish(rows.length);
  // Rows before the first thread have no parent here; never hide them.
  return { hidden, hiddenThreads, threads: count };
}
