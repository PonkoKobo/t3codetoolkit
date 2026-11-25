import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMIT, MAX_LIMIT, clampLimit, hiddenRows, menuChoice, parseCompact } from "../src/core/threadLimit.js";

const top = (current = false) => ({ top: true, current });
const nested = (current = false) => ({ top: false, current });

test("the stored thread count is a whole number in range", () => {
  assert.equal(clampLimit("7"), 7);
  assert.equal(clampLimit(3.6), 4);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(500), MAX_LIMIT);
  for (const bad of [undefined, null, "", "  ", "abc", NaN, Infinity, {}, []]) assert.equal(clampLimit(bad), DEFAULT_LIMIT);
});

test("compact projects come back as a set of keys, ignoring bad storage", () => {
  assert.deepEqual([...parseCompact('["a","",3,"b"]')], ["a", "b"]);
  assert.equal(parseCompact("{").size, 0);
  assert.equal(parseCompact('{"a":1}').size, 0);
  assert.equal(parseCompact(null).size, 0);
});

test("only threads past the limit are hidden, nested rows with their parent", () => {
  const rows = [top(), nested(), top(), top(), nested(), nested(), top()];
  const { hidden, hiddenThreads, threads } = hiddenRows(rows, 2);
  assert.deepEqual(hidden, [false, false, false, true, true, true, true]);
  assert.equal(hiddenThreads, 2);
  assert.equal(threads, 4);
});

test("the open thread stays visible, as does the thread it is nested under", () => {
  assert.deepEqual(hiddenRows([top(), top(), top(true)], 1).hidden, [false, true, false]);
  assert.deepEqual(hiddenRows([top(), top(), nested(true), top()], 1).hidden, [false, false, false, true]);
  assert.equal(hiddenRows([top(), top(), nested(true), top()], 1).hiddenThreads, 1);
});

test("nothing is hidden when the project fits, or when the limit is unbounded", () => {
  assert.deepEqual(hiddenRows([top(), nested(), top()], 2).hidden, [false, false, false]);
  assert.deepEqual(hiddenRows([top(), top(), top()], Infinity).hidden, [false, false, false]);
  assert.deepEqual(hiddenRows([nested(), top()], 1).hidden, [false, false]);
  assert.deepEqual(hiddenRows([], 3), { hidden: [], hiddenThreads: 0, threads: 0 });
});

test("the context menu offers one Show more / Show less entry that changes something", () => {
  const at = (state) => menuChoice({ expanded: true, compact: false, threads: 8, hiddenThreads: 0, limit: 5, ...state });
  assert.deepEqual(at({ expanded: false }), { label: "Show more", action: "expand" });
  assert.deepEqual(at({}), { label: "Show less (first 5)", action: "compact" });
  assert.deepEqual(at({ compact: true, hiddenThreads: 3 }), { label: "Show more (3 hidden)", action: "full" });
  // Compact, but the only thread past the limit is the open one, so none are hidden.
  assert.deepEqual(at({ compact: true, threads: 6, hiddenThreads: 0 }), { label: "Show more", action: "full" });
  // Fits either way: Show less collapses like the header.
  assert.deepEqual(at({ threads: 5 }), { label: "Show less", action: "collapse" });
  assert.deepEqual(at({ compact: true, threads: 2 }), { label: "Show less", action: "collapse" });
});
