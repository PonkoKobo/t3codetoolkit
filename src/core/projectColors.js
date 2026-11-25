// Pure colour helpers for the project colours feature (unit-tested; no DOM).

/** "rgb(1, 2, 3)" / "rgba(1 2 3 / 50%)" → [r, g, b], or null. */
export function parseRgb(text) {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** [r, g, b] (0-255) → [h (0-360), s (0-1), l (0-1)]. */
export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Below this saturation an icon counts as grey/white, and its project keeps the default text colour. */
export const MIN_SATURATION = 0.2;

/**
 * The main colour of an icon's pixels (RGBA bytes, as from getImageData): the hue shared by the
 * most colourful opaque pixels, averaged. Returns [r, g, b], or null for a grey or blank icon.
 */
export function dominantColor(data) {
  const buckets = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = rgbToHsl(rgb);
    if (s < MIN_SATURATION || l < 0.12 || l > 0.92) continue;
    const bucket = buckets[Math.floor(h / 30) % 12];
    bucket.weight += s;
    bucket.r += rgb[0] * s;
    bucket.g += rgb[1] * s;
    bucket.b += rgb[2] * s;
    total++;
  }
  // Too few colourful pixels: a mostly grey icon with a stray coloured edge stays uncoloured.
  const opaque = countOpaque(data);
  if (!total || total < opaque * 0.08) return null;
  const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a));
  return [best.r, best.g, best.b].map((v) => Math.round(v / best.weight));
}

function countOpaque(data) {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) n++;
  return n;
}

/**
 * A text colour for `rgb` that reads on both themes: CSS `light-dark()` with a darker shade for
 * light backgrounds and a lighter one for dark backgrounds. Null for grey colours.
 */
export function readableColor(rgb) {
  if (!rgb) return null;
  const [h, s] = rgbToHsl(rgb);
  if (s < MIN_SATURATION) return null;
  const sat = Math.round(Math.min(1, Math.max(s, 0.55)) * 100);
  const hue = Math.round(h);
  return `light-dark(hsl(${hue} ${sat}% 38%), hsl(${hue} ${sat}% 68%))`;
}
