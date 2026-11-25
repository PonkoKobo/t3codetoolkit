import assert from "node:assert/strict";
import { test } from "node:test";
import { appRoute, cycle, homeHref, isChordKey, projectChordHeld, projectSlotFromKey, projectSlots, sidebarFolderOrders } from "../src/core/projectKeys.js";

const key = (code, mods = {}) => ({ code, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, ...mods });

test("Ctrl+Shift + 1..9 map to slots 1..9 on the number row and the numpad", () => {
  for (let n = 1; n <= 9; n++) {
    assert.equal(projectSlotFromKey(key(`Digit${n}`)), n);
    assert.equal(projectSlotFromKey(key(`Numpad${n}`)), n);
  }
  assert.equal(projectSlotFromKey(key("Digit0")), null);
  assert.equal(projectSlotFromKey(key("KeyP")), null);
});

test("other modifier combinations belong to the model switcher, the thread shortcuts or the OS", () => {
  assert.equal(projectSlotFromKey(key("Digit1", { altKey: true })), null); // Ctrl+Alt(+Shift): model switcher
  assert.equal(projectSlotFromKey(key("Digit1", { shiftKey: false })), null); // Ctrl+1: threads
  assert.equal(projectSlotFromKey(key("Digit1", { ctrlKey: false })), null);
  assert.equal(projectSlotFromKey(key("Digit1", { metaKey: true })), null);
});

test("auto-repeat and IME composition are ignored", () => {
  assert.equal(projectSlotFromKey(key("Digit1", { repeat: true })), null);
  assert.equal(projectSlotFromKey(key("Digit1", { isComposing: true })), null);
});

test("the chord is Ctrl+Shift without Alt or Meta, started by Ctrl or Shift alone", () => {
  assert.equal(projectChordHeld(key("ShiftLeft")), true);
  assert.equal(projectChordHeld(key("ShiftLeft", { altKey: true })), false);
  assert.equal(projectChordHeld(key("ShiftLeft", { ctrlKey: false })), false);
  assert.equal(isChordKey({ key: "Control" }), true);
  assert.equal(isChordKey({ key: "Shift" }), true);
  assert.equal(isChordKey({ key: "Alt" }), false);
  assert.equal(isChordKey({ key: "P" }), false);
});

const p = (key, pinned, extra = {}) => ({ key, name: key.toUpperCase(), pinned, ...extra });

test("pinned projects are numbered in list order the first time", () => {
  const { order, slots, others } = projectSlots([], [p("b", false, { current: true }), p("a", true), p("c", true), p("d", false)]);
  assert.deepEqual(order, ["a", "c"]);
  assert.deepEqual(slots.map((s) => [s.key, s.slot]), [["a", 1], ["c", 2]]);
  assert.deepEqual(others.map((s) => [s.key, s.slot, s.current ?? false]), [["b", null, true], ["d", null, false]]);
});

test("the saved order wins over the app's current-project-first order", () => {
  const { slots } = projectSlots(["a", "c"], [p("c", true, { current: true }), p("a", true), p("b", false)]);
  assert.deepEqual(slots.map((s) => [s.key, s.slot]), [["a", 1], ["c", 2]]);
});

test("new pins are appended and unpinned projects leave the order", () => {
  const { order, slots } = projectSlots(["a", "c"], [p("a", false), p("c", true), p("e", true)]);
  assert.deepEqual(order, ["c", "e"]);
  assert.deepEqual(slots.map((s) => [s.key, s.slot]), [["c", 1], ["e", 2]]);
});

test("pinned projects missing from the list keep their place but get no slot", () => {
  const { order, slots } = projectSlots(["x", "a", "a", 7], [p("a", true)]);
  assert.deepEqual(order, ["x", "a"]);
  assert.deepEqual(slots.map((s) => [s.key, s.slot]), [["a", 1]]);
});

test("cycle wraps both ways and is -1 for an empty list", () => {
  assert.equal(cycle(0, 1, 3), 1);
  assert.equal(cycle(2, 1, 3), 0);
  assert.equal(cycle(0, -1, 3), 2);
  assert.equal(cycle(0, 1, 0), -1);
});

test("the route is read from the path on the web and from the hash on desktop", () => {
  assert.equal(appRoute({ pathname: "/draft/abc", hash: "" }, false), "/draft/abc");
  assert.equal(appRoute({ pathname: "/index.html", hash: "#/draft/abc" }, true), "/draft/abc");
  assert.equal(appRoute({ pathname: "/index.html", hash: "#/usage?x=1" }, true), "/usage");
  assert.equal(appRoute({ pathname: "/index.html", hash: "" }, true), "/");
  assert.equal(homeHref({ pathname: "/draft/abc", search: "" }, false), "/");
  assert.equal(homeHref({ pathname: "/index.html", search: "?a=1" }, true), "/index.html?a=1#/");
});

test("sidebar pinned folders follow the toolkit order, each with its thread rows", () => {
  const rows = [
    { parent: null }, // draft row above the folders
    { folder: "b" }, { parent: "b" }, { parent: "b" },
    { folder: "a" }, { parent: "a" },
    { folder: "c" }, { parent: "c" }, // unpinned
    { parent: null }, // a shelf below
  ];
  const orders = sidebarFolderOrders(rows, ["a", "b"]);
  assert.deepEqual(orders, [-3, -1, -1, -1, -2, -2, null, null, null]);
  // Already in order, or only one pinned folder: nothing to move.
  assert.equal(sidebarFolderOrders(rows, ["b", "a"]), null);
  assert.equal(sidebarFolderOrders(rows, ["a"]), null);
  // A row of another folder between pinned folders stops the run; then the block isn't contiguous.
  const split = [{ folder: "b" }, { parent: "x" }, { folder: "a" }];
  assert.equal(sidebarFolderOrders(split, ["a", "b"]), null);
});
