import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeRepositories, moveRepository, repositoryPreferences, repositoryScope } from "../src/core/repositoryPreferences.js";

const rows = (...keys) => keys.map((key) => ({ key }));
const arrange = (list, preferences) => arrangeRepositories(rows(...list), preferences).map(({ key }) => key);

test("repository layouts separate project folders and environments", () => {
  assert.notEqual(repositoryScope("local", "folder-a"), repositoryScope("local", "folder-b"));
  assert.notEqual(repositoryScope("local", "folder-a"), repositoryScope("remote", "folder-a"));
  assert.deepEqual(repositoryPreferences({ pinned: ["A", "A", 1], order: null }), { pinned: ["A"], hidden: [], order: [] });
});

test("pins stay above unpinned rows and newly listed repositories retain their native order", () => {
  const saved = repositoryPreferences({ pinned: ["D", "C"], order: ["D", "B"] });
  assert.deepEqual(arrange(["A", "B", "C", "D", "E"], saved), ["D", "C", "B", "A", "E"]);
  const moved = moveRepository(rows("A", "B", "C", "D", "E"), saved, "C", -1);
  assert.deepEqual(arrange(["A", "B", "C", "D", "E"], moved), ["C", "D", "B", "A", "E"]);
  assert.equal(moveRepository(rows("A", "B", "C", "D", "E"), moved, "C", -1), moved);
});

test("reordering a partial list preserves absent repository positions and visibility preferences", () => {
  const saved = repositoryPreferences({ order: ["A", "B", "C"], hidden: ["B"] });
  const moved = moveRepository(rows("A", "C"), saved, "C", -1);
  assert.deepEqual(moved.order, ["C", "B", "A"]);
  assert.deepEqual(moved.hidden, ["B"]);
  assert.deepEqual(arrange(["A", "B", "C"], moved), ["C", "B", "A"]);
});
