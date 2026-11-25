// Upstream exposes no extension API, so features read the props React already holds for a
// rendered element. Prop names are JSX attribute names and survive minification; component
// names do not, so never match on those.

/** The fiber of `el`, or of its nearest React-rendered ancestor (editor DOM such as ProseMirror has none). */
export function fiberOf(el) {
  for (let node = el, hops = 0; node && hops < 8; node = node.parentElement, hops++) {
    for (const key in node) {
      if (key.startsWith("__reactFiber$")) return node[key];
    }
  }
  return null;
}

/** React may leave a DOM node pointing to the fiber from the previous render. */
export function currentFiberOf(el) {
  let fiber = fiberOf(el);
  if (fiber?.alternate) {
    let root = fiber;
    while (root.return) root = root.return;
    if (root.stateNode?.current === root.alternate) fiber = fiber.alternate;
  }
  return fiber;
}

/** Walk from a DOM element up the React tree and return the first props object matching `test`. */
export function findPropsUp(el, test, maxDepth = 80) {
  let fiber = currentFiberOf(el);
  for (let depth = 0; fiber && depth < maxDepth; depth++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (props && typeof props === "object") {
      try {
        if (test(props)) return props;
      } catch {
        // A getter on someone else's props threw; keep walking.
      }
    }
  }
  return null;
}
