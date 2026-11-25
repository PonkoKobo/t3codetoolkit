import test from "node:test";
import assert from "node:assert/strict";
import { dominantColor, parseRgb, readableColor, rgbToHsl } from "../src/core/projectColors.js";

const pixels = (...colors) => Uint8ClampedArray.from(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));

test("parseRgb reads computed colours", () => {
  assert.deepEqual(parseRgb("rgb(167, 139, 250)"), [167, 139, 250]);
  assert.deepEqual(parseRgb("rgba(1 2 3 / 50%)"), [1, 2, 3]);
  assert.equal(parseRgb("oklch(0.7 0.1 200)"), null);
});

test("rgbToHsl", () => {
  assert.deepEqual(rgbToHsl([255, 0, 0]), [0, 1, 0.5]);
  assert.deepEqual(rgbToHsl([128, 128, 128]).slice(0, 2), [0, 0]);
});

test("dominantColor picks the main hue and ignores transparent and grey pixels", () => {
  const purple = [140, 80, 220];
  const data = pixels(purple, purple, purple, [255, 0, 0], [30, 30, 30], [250, 250, 250], [0, 255, 0, 0]);
  assert.deepEqual(dominantColor(data), purple);
});

test("dominantColor is null for grey or blank icons", () => {
  assert.equal(dominantColor(pixels([20, 20, 20], [200, 200, 200])), null);
  assert.equal(dominantColor(pixels([255, 0, 0, 0])), null);
  // A stray coloured pixel on a big grey icon doesn't count.
  const grey = Array.from({ length: 30 }, () => [120, 120, 120]);
  assert.equal(dominantColor(pixels(...grey, [255, 0, 0])), null);
});

test("readableColor gives a light-dark pair, null for grey", () => {
  assert.equal(readableColor([34, 197, 94]), "light-dark(hsl(142 71% 38%), hsl(142 71% 68%))");
  assert.equal(readableColor([150, 150, 160]), null);
  assert.equal(readableColor(null), null);
});
