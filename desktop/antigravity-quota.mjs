import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export function parseQuotaReport(stdout) {
  const rows = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [group, limit, percent, reset] = line.split("\t").map((field) => field.trim());
    if (!group || !limit || !/^\d+(?:\.\d+)?%$/.test(percent)) continue;
    const remaining = Number(percent.slice(0, -1));
    if (remaining > 100) continue;
    const resetMs = Date.parse(reset);
    rows.push({ group, limit, remaining, resetAt: resetMs > 0 ? new Date(resetMs).toISOString() : null });
  }
  if (!rows.length) throw new Error("Antigravity returned no quota rows. Check that agy is signed in and up to date.");
  return rows;
}

export async function readAntigravityQuota() {
  const directories = (process.env.PATH ?? "").split(delimiter).map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"));
  if (process.env.LOCALAPPDATA) directories.push(join(process.env.LOCALAPPDATA, "agy", "bin"));
  const executable = directories.filter(isAbsolute).map((dir) => join(dir, "agy.exe"))
    .find((file) => statSync(file, { throwIfNoEntry: false })?.isFile());
  if (!executable) throw new Error("Antigravity CLI (agy.exe) was not found. Install it and restart T3 Code + Toolkit.");

  let stdout;
  try {
    ({ stdout } = await exec(executable, ["-p", "/usage", "--output-format", "text", "--print-timeout", "30s",
      "--settings", '{"disableSlashCommands":false}'], {
      cwd: homedir(), windowsHide: true, timeout: 35_000, maxBuffer: 128 * 1024,
    }));
  } catch (error) {
    if (error.killed) throw new Error("Antigravity took too long to respond. Try refreshing again.");
    throw new Error("Antigravity could not check quota. Check your CLI sign-in and connection, then try again.");
  }
  return { rows: parseQuotaReport(stdout), checkedAt: new Date().toISOString() };
}
