import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

export function readConfig(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const config = JSON.parse(source.replace(/^\uFEFF/, ""));
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Expected a JSON object in config.json.");
  }
  return config;
}

export function updateConfig(path, changes) {
  const current = readConfig(path) ?? {};
  const updated = { ...current, ...changes(current) };
  const staging = `${path}.${randomUUID()}.tmp`;
  writeFileSync(staging, JSON.stringify(updated, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  try {
    renameSync(staging, path);
  } finally {
    rmSync(staging, { force: true });
  }
  return updated;
}
