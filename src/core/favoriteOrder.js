// The native combobox uses length-prefixed keys so account IDs and slugs can contain colons.
export function decodeModelKey(key) {
  if (typeof key !== "string") return null;
  const match = /^model:(\d+):(.+)$/s.exec(key);
  if (!match) return null;
  const length = Number(match[1]);
  const pair = match[2];
  if (!Number.isSafeInteger(length) || length < 1 || length >= pair.length) return null;
  return { instanceId: pair.slice(0, length), slug: pair.slice(length) };
}

export function effectiveOrder(saved, visibleKeys) {
  return [...new Set([...saved, ...visibleKeys].filter((key) => decodeModelKey(key)))];
}

// Swap participating favorites in place, preserving the positions of hidden or locked models.
export function moveFavorite(order, movableKeys, key, offset) {
  const visible = order.filter((candidate) => movableKeys.has(candidate));
  const index = visible.indexOf(key);
  const neighbor = index < 0 ? undefined : visible[index + offset];
  if (!neighbor) return order;
  return order.map((candidate) => candidate === key ? neighbor : candidate === neighbor ? key : candidate);
}

// Drop a favorite at `targetIndex` among the movable favorites (drag and drop). Hidden or locked models
// keep their slots; the movable ones fill the remaining slots in their new order.
export function placeFavorite(order, movableKeys, key, targetIndex) {
  const visible = order.filter((candidate) => movableKeys.has(candidate));
  const from = visible.indexOf(key);
  if (from < 0 || !Number.isInteger(targetIndex)) return order;
  const to = Math.max(0, Math.min(visible.length - 1, targetIndex));
  if (from === to) return order;
  visible.splice(from, 1);
  visible.splice(to, 0, key);
  let next = 0;
  return order.map((candidate) => (movableKeys.has(candidate) ? visible[next++] : candidate));
}
