import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseInfo } from "../scripts/release-info.mjs";

test("a clean build of the release tag is the release", () => {
  assert.equal(releaseInfo("v0.1.1-0-g7c96ed3", "0.1.1"), null);
});

test("builds after a tag, with local changes, or of an untagged version say so", () => {
  assert.deepEqual(releaseInfo("v0.1.1-3-g7c96ed3", "0.1.1"), { tag: "0.1.1", ahead: 3, commit: "7c96ed3", dirty: false, untagged: false });
  assert.deepEqual(releaseInfo("v0.1.1-0-g7c96ed3-dirty", "0.1.1"), { tag: "0.1.1", ahead: 0, commit: "7c96ed3", dirty: true, untagged: false });
  assert.deepEqual(releaseInfo("v0.1.1-2-gabc1234", "0.2.0"), { tag: "0.1.1", ahead: 2, commit: "abc1234", dirty: false, untagged: true });
});

test("without git history the package version stands alone", () => {
  for (const describe of [null, "", "7c96ed3", "release-1-gabc", "v0.1-1-gabc"]) assert.equal(releaseInfo(describe, "0.1.1"), null);
});
