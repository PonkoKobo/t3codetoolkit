import assert from "node:assert/strict";
import { test } from "node:test";
import { cycle, favoriteSlots, isModifierKey, modelSlotFromKey, switcherChordHeld } from "../src/core/modelKeys.js";

const key = (code, mods = {}) => ({ code, ctrlKey: true, altKey: true, metaKey: false, shiftKey: false, ...mods });

test("Ctrl+Alt + 1..9 map to slots 1..9, on the number row and the numpad, with or without Shift", () => {
  for (let n = 1; n <= 9; n++) {
    assert.equal(modelSlotFromKey(key(`Digit${n}`)), n);
    assert.equal(modelSlotFromKey(key(`Numpad${n}`)), n);
    assert.equal(modelSlotFromKey(key(`Digit${n}`, { shiftKey: true })), n);
  }
  assert.equal(modelSlotFromKey(key("Digit0")), null);
  assert.equal(modelSlotFromKey(key("KeyM")), null);
});

test("Alt alone, Ctrl alone and Cmd combinations are left to the effort shortcuts and T3 Code", () => {
  assert.equal(modelSlotFromKey(key("Digit1", { ctrlKey: false })), null);
  assert.equal(modelSlotFromKey(key("Digit1", { altKey: false })), null);
  assert.equal(modelSlotFromKey(key("Digit1", { metaKey: true })), null);
});

test("AltGr (reported as Ctrl+Alt on Windows) never counts", () => {
  const altGr = { getModifierState: (m) => m === "AltGraph" };
  assert.equal(modelSlotFromKey(key("Digit2", altGr)), null);
  assert.equal(switcherChordHeld(key("", altGr)), false);
  assert.equal(switcherChordHeld(key("", { getModifierState: () => false })), true);
});

test("held keys and IME composition are ignored", () => {
  assert.equal(modelSlotFromKey(key("Digit2", { repeat: true })), null);
  assert.equal(modelSlotFromKey(key("Digit2", { isComposing: true })), null);
});

test("only Ctrl, Alt and Shift start a hold", () => {
  for (const k of ["Control", "Alt", "Shift"]) assert.equal(isModifierKey({ key: k }), true);
  for (const k of ["Meta", "1", "a", "AltGraph"]) assert.equal(isModifierKey({ key: k }), false);
});

test("slots keep the arranged numbering and skip keys that aren't favorites now", () => {
  const models = new Map([["a", { name: "A" }], ["c", { name: "C" }]]);
  assert.deepEqual(favoriteSlots(["a", "b", "c"], models), [
    { slot: 1, key: "a", name: "A" },
    { slot: 3, key: "c", name: "C" },
  ]);
  assert.deepEqual(favoriteSlots([], models), []);
});

test("cycling wraps both ways", () => {
  assert.equal(cycle(0, -1, 3), 2);
  assert.equal(cycle(2, 1, 3), 0);
  assert.equal(cycle(1, 1, 3), 2);
  assert.equal(cycle(0, 1, 0), -1);
});
