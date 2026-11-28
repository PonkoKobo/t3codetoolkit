const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

export function svgIcon(paths, strokeWidth = "2") {
  const svg = svgElement("svg", {
    "aria-hidden": "true", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": strokeWidth, "stroke-linecap": "round", "stroke-linejoin": "round",
  });
  svg.append(...paths.map((d) => svgElement("path", { d })));
  return svg;
}

export const hammerIcon = () => svgIcon([
  "m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9",
  "m18 15 4-4",
  "m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5",
]);
export const compactIcon = () => svgIcon(["m7 20 5-5 5 5", "m7 4 5 5 5-5"]);
export const expandIcon = () => svgIcon(["m7 9 5-5 5 5", "m7 15 5 5 5-5"]);
export const annotateIcon = () => svgIcon(["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"]);
export const launcherIcon = () => svgIcon(["M4 6h16", "M4 12h10", "M4 18h7", "m15 13 5 3-5 3Z"]);

export function galleryIcon() {
  const svg = svgIcon([]);
  svg.append(
    svgElement("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }),
    svgElement("circle", { cx: "9", cy: "9", r: "2" }),
    svgElement("path", { d: "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" }),
  );
  return svg;
}
