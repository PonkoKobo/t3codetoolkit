import assert from "node:assert/strict";
import { test } from "node:test";
import { effortLevelFromKey, effortRowLabel, isOtherTextField, pickEffortRow, stepEffortIndex } from "../src/core/effortKeys.js";

const key = (code, mods = {}) => ({ code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

test("Alt + 1..6 map to levels 1..6, on the number row and the numpad", () => {
  for (let n = 1; n <= 6; n++) {
    assert.equal(effortLevelFromKey(key(`Digit${n}`)), n);
    assert.equal(effortLevelFromKey(key(`Numpad${n}`)), n);
  }
});

test("other digits and keys are ignored", () => {
  for (const code of ["Digit0", "Digit7", "Digit9", "Numpad0", "KeyE", "F1", "", undefined]) {
    assert.equal(effortLevelFromKey(key(code)), null, String(code));
  }
});

test("only plain Alt counts; Shift, Ctrl and Cmd combinations stay with T3 Code", () => {
  assert.equal(effortLevelFromKey(key("Digit1", { altKey: false })), null);
  assert.equal(effortLevelFromKey(key("Digit1", { shiftKey: true })), null);
  assert.equal(effortLevelFromKey(key("Digit1", { ctrlKey: true })), null); // AltGr on Windows is Ctrl+Alt
  assert.equal(effortLevelFromKey(key("Digit1", { metaKey: true })), null);
  assert.equal(effortLevelFromKey(key("Digit1", { getModifierState: (modifier) => modifier === "AltGraph" })), null);
});

test("held keys and IME composition are ignored", () => {
  assert.equal(effortLevelFromKey(key("Digit2", { repeat: true })), null);
  assert.equal(effortLevelFromKey(key("Digit2", { isComposing: true })), null);
});

test("the physical key decides, not the typed character (macOS Option+digit types symbols)", () => {
  assert.equal(effortLevelFromKey({ ...key("Digit3"), key: "£" }), 3);
});

const el = (tagName, extra = {}) => ({ tagName, isContentEditable: false, ...extra });

test("keys in other text fields are left alone, keys in the composer are not", () => {
  const inside = el("SPAN");
  const composer = el("DIV", { isContentEditable: true, contains: (n) => n === inside });
  assert.equal(isOtherTextField(composer, composer), false);
  assert.equal(isOtherTextField(inside, composer), false);
  assert.equal(isOtherTextField(el("INPUT"), composer), true);
  assert.equal(isOtherTextField(el("TEXTAREA"), composer), true);
  assert.equal(isOtherTextField(el("SELECT"), composer), true);
  assert.equal(isOtherTextField(el("DIV", { isContentEditable: true }), composer), true);
  assert.equal(isOtherTextField(el("BUTTON"), composer), false);
  assert.equal(isOtherTextField(null, composer), false);
});

const row = (label, extra = {}) => ({
  disabled: false,
  textContent: `${label}Default`,
  querySelector: (sel) => (sel === "span" ? { textContent: ` ${label} ` } : null),
  dataset: { effortLevel: "true" },
  ...extra,
});

test("carousel steps skip disabled levels and stop at the lowest and highest available levels", () => {
  const rows = [row("Low"), row("Medium", { disabled: true }), row("High")];
  assert.equal(stepEffortIndex(rows, 0, 1), 2);
  assert.equal(stepEffortIndex(rows, 2, -1), 0);
  assert.equal(stepEffortIndex(rows, 0, -1), 0);
  assert.equal(stepEffortIndex(rows, 2, 1), 2);
  assert.equal(stepEffortIndex(rows, -1, 1), 0);
  assert.equal(stepEffortIndex(rows, -1, -1), 2);
  assert.equal(stepEffortIndex([], -1, 1), -1);
  assert.equal(stepEffortIndex([rows[1]], 0, 1), 0);
});

test("picks the row for the level and reads its label from the first span", () => {
  const rows = ["Low", "Medium", "High"].map((l) => row(l));
  assert.deepEqual(pickEffortRow(rows, 2), { row: rows[1], label: "Medium" });
});

test("explains why nothing was picked", () => {
  assert.deepEqual(pickEffortRow([], 1), { reason: "This model has no effort levels" });
  assert.deepEqual(pickEffortRow([row("Low")], 4), { reason: "This model has 1 effort level" });
  assert.deepEqual(pickEffortRow([row("Low"), row("High")], 3), { reason: "This model has 2 effort levels" });
  assert.deepEqual(pickEffortRow([row("Low", { disabled: true })], 1), { reason: "Effort is set in the message (ultrathink)" });
});

test("label falls back to the row text, then a non-boolean data-effort-level, then the number", () => {
  assert.equal(effortRowLabel({ textContent: " Max ", querySelector: () => null }), "Max");
  assert.equal(effortRowLabel({ textContent: "", querySelector: () => null, dataset: { effortLevel: "xhigh" } }), "xhigh");
  const bare = { textContent: "", querySelector: () => null, dataset: { effortLevel: "true" }, disabled: false };
  assert.equal(effortRowLabel(bare), "");
  assert.deepEqual(pickEffortRow([bare], 1), { row: bare, label: "1" });
});
