function keys(value) {
  return Array.isArray(value) ? [...new Set(value.filter((key) => typeof key === "string"))] : [];
}

export function repositoryPreferences(value) {
  return { pinned: keys(value?.pinned), hidden: keys(value?.hidden), order: keys(value?.order) };
}

export function repositoryScope(environmentId, projectId) {
  return JSON.stringify([environmentId, projectId]);
}

export function arrangeRepositories(rows, preferences) {
  const pinned = new Set(preferences.pinned);
  const order = new Map(preferences.order.map((key, index) => [key, index]));
  const rank = (row) => order.get(row.key) ?? order.size;
  return [...rows].sort((a, b) => Number(pinned.has(b.key)) - Number(pinned.has(a.key)) || rank(a) - rank(b));
}

export function moveRepository(rows, preferences, key, direction) {
  const pinned = new Set(preferences.pinned);
  const sorted = arrangeRepositories(rows, preferences);
  const tier = sorted.filter((row) => pinned.has(row.key) === pinned.has(key));
  const index = tier.findIndex((row) => row.key === key);
  const neighbor = tier[index + direction];
  if (index < 0 || !neighbor) return preferences;

  // Absent repositories retain their slots when organizing a different thread or worktree.
  const order = [...new Set([...preferences.order, ...sorted.map((row) => row.key)])];
  const from = order.indexOf(key);
  const to = order.indexOf(neighbor.key);
  [order[from], order[to]] = [order[to], order[from]];
  return { ...preferences, order };
}
