import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const idPattern = /^[a-p]{32}$/;

export function createBrowserSharing(directory) {
  const exe = join(directory, "T3ToolkitBrowser.exe");
  const manifest = join(directory, "com.t3codetoolkit.browser.json");
  const claudeConfig = join(directory, "browser-mcp.json");
  const available = process.platform === "win32" && existsSync(exe);
  let broker = null;
  let enabled = false;
  let changing = false;

  function status() {
    let extensionId;
    try {
      extensionId = /^chrome-extension:\/\/([a-p]{32})\/$/.exec(
        JSON.parse(readFileSync(manifest, "utf8")).allowed_origins[0],
      )?.[1];
    } catch {}
    const forwardPath = exe.replaceAll("\\", "/");
    return {
      enabled,
      extensionId,
      codex: `-c 'mcp_servers.t3_toolkit_browser.command="${forwardPath}"' -c 'mcp_servers.t3_toolkit_browser.args=["mcp"]'`,
      claude: `--mcp-config "${claudeConfig}"`,
      command: `& '${exe.replaceAll("'", "''")}' request_share`,
    };
  }

  async function disable() {
    if (changing) throw new Error("Wait for the current change to finish.");
    if (!broker) return;
    changing = true;
    const child = broker;
    const exited = new Promise((resolve) => child.once("close", resolve));
    child.stdin.end();
    try { await exited; }
    finally { changing = false; }
  }

  async function enable(extensionId) {
    if (!available || !idPattern.test(extensionId ?? "")) throw new Error("Copy the extension ID from the Toolkit popup in Chrome.");
    if (changing) throw new Error("Wait for the current change to finish.");
    if (enabled) return;
    changing = true;
    let child;
    try {
      writeFileSync(claudeConfig, JSON.stringify({
        mcpServers: { t3_toolkit_browser: { command: exe, args: ["mcp"] } },
      }, null, 2) + "\n");
      await run(exe, ["register", extensionId], { windowsHide: true, timeout: 3000 });
      child = spawn(exe, ["broker"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      broker = child;
      child.stdin.on("error", () => {});
      child.once("close", () => {
        if (broker === child) {
          broker = null;
          enabled = false;
        }
      });
      await new Promise((resolve, reject) => {
        let output = "";
        let problem = "";
        const timer = setTimeout(() => reject(new Error("The browser helper did not start.")), 3000);
        child.stderr.on("data", (value) => { problem = (problem + value).slice(0, 500); });
        child.stdout.on("data", (value) => {
          output += value;
          if (output.startsWith("ready\n") || output.startsWith("ready\r\n")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("close", () => { clearTimeout(timer); reject(new Error(problem.trim() || "The browser helper stopped.")); });
      });
      enabled = broker === child;
      if (!enabled) throw new Error("The browser helper stopped.");
    } catch (error) {
      child?.stdin.end();
      throw new Error(error.stderr?.trim() || error.message);
    } finally { changing = false; }
  }

  return { available, status, enable, disable };
}
