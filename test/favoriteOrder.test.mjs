import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeModelKey, effectiveOrder, moveFavorite, placeFavorite } from "../src/core/favoriteOrder.js";

const first = "model:5:alphaexample/model";
const second = "model:4:betaexample/model";
const hidden = "model:5:alphaother:model";
const added = "model:4:betaextra";

test("model keys identify the exact provider instance, including punctuation", () => {
  assert.deepEqual(decodeModelKey(first), { instanceId: "alpha", slug: "example/model" });
  assert.deepEqual(decodeModelKey(second), { instanceId: "beta", slug: "example/model" });
  assert.deepEqual(decodeModelKey("model:7:alpha:2some:model"), { instanceId: "alpha:2", slug: "some:model" });
  for (const invalid of [null, "legacy-models:alpha", "model:9:alpha", "model:0:slug", "model:3:abc"]) {
    assert.equal(decodeModelKey(invalid), null);
  }
});

test("saved order keeps absent slots while new favorites append in native order", () => {
  assert.deepEqual(effectiveOrder([second, hidden, second, false, first], [first, second, added]), [second, hidden, first, added]);
  assert.deepEqual(effectiveOrder([], [second, first]), [second, first]);
});

test("moving a favorite interleaves providers and leaves ineligible slots in place", () => {
  const order = [first, hidden, second, added];
  const movable = new Set([first, second, added]);
  assert.deepEqual(moveFavorite(order, movable, first, 1), [second, hidden, first, added]);
  assert.deepEqual(moveFavorite(order, movable, second, -1), [second, hidden, first, added]);
  assert.equal(moveFavorite(order, movable, hidden, 1), order);
  assert.equal(moveFavorite(order, movable, added, 1), order);
});

test("dropping a favorite moves it across several rows and keeps ineligible slots", () => {
  const order = [first, hidden, second, added];
  const movable = new Set([first, second, added]);
  assert.deepEqual(placeFavorite(order, movable, added, 0), [added, hidden, first, second]);
  assert.deepEqual(placeFavorite(order, movable, first, 2), [second, hidden, added, first]);
  assert.deepEqual(placeFavorite(order, movable, first, 99), [second, hidden, added, first]);
  assert.equal(placeFavorite(order, movable, second, 1), order);
  assert.equal(placeFavorite(order, movable, hidden, 0), order);
  assert.equal(placeFavorite(order, movable, first, Number.NaN), order);
});
