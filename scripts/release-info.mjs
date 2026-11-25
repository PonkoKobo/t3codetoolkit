import { execFileSync } from "node:child_process";

/**
 * How a build relates to the GitHub release tags. A clean build of the commit tagged v<version> is
 * the release itself (null). Anything else names the release it follows, so a development build
 * can't pass for a published one. Without git history (a release ZIP, a shallow CI checkout) the
 * package version is all there is, so that also gives null.
 */
export function releaseInfo(describe, version) {
  const match = /^v(\d+\.\d+\.\d+)-(\d+)-g([0-9a-f]+)(-dirty)?$/.exec(describe ?? "");
  if (!match) return null;
  const [, tag, ahead, commit, dirty] = match;
  if (tag === version && ahead === "0" && !dirty) return null;
  return { tag, ahead: Number(ahead), commit, dirty: Boolean(dirty), untagged: tag !== version };
}

export function gitDescribe(cwd) {
  try {
    return execFileSync("git", ["describe", "--tags", "--long", "--dirty", "--match", "v[0-9]*"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
