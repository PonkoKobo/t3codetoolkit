import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const exe = fileURLToPath(new URL("../dist/browser-bridge/T3ToolkitBrowser.exe", import.meta.url));
const exec = promisify(execFile);
const supported = process.platform === "win32" && existsSync(exe);
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));

async function waitFor(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause();
  }
  assert.fail("Timed out waiting for a bridge operation.");
}

test("Windows browser bridge scopes grants and requires a fresh explicit click approval", { skip: !supported, timeout: 22000 }, async () => {
  const isolatedId = randomUUID().replaceAll("-", "");
  const broker = spawn(exe, ["broker", isolatedId], { windowsHide: true });
  const done = once(broker, "close");
  try {
    const startup = createInterface({ input: broker.stdout });
    assert.equal((await once(startup, "line"))[0], "ready");
    startup.close();

    const { stdout } = await exec("whoami", ["/user", "/fo", "csv", "/nh"], { windowsHide: true });
    const sid = stdout.match(/S-1-[0-9-]+/)[0];
    const pipe = "\\\\.\\pipe\\T3CodeToolkit.Browser." + sid + "." + isolatedId;
    const send = (message) => new Promise((resolve, reject) => {
      const socket = createConnection(pipe);
      const payload = Buffer.from(JSON.stringify(message));
      const header = Buffer.alloc(4);
      header.writeInt32LE(payload.length);
      socket.once("connect", () => socket.write(Buffer.concat([header, payload])));
      socket.once("error", reject);
      const chunks = [];
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.once("end", () => resolve(JSON.parse(Buffer.concat(chunks).subarray(4))));
    });
    const browser = (op, data) => send({ op: "browser_" + op, browser: "fixture-chrome", ...data });
    const { session } = await send({ op: "request_share", client: "Fixture agent" });
    assert.ok(session);
    assert.ok((await send({ op: "request_share" })).error);
    assert.ok((await send({ op: "snapshot", session })).error);
    const { requestId } = await browser("status");
    assert.ok((await browser("share", { requestId: "old", origin: "https://example.test" })).error);
    assert.equal((await browser("share", { requestId, origin: "https://example.test" })).state, "shared");
    assert.equal((await send({ op: "browser_next", browser: "unrelated" })).state, "busy");

    async function snapshot() {
      const read = send({ op: "snapshot", session });
      const action = await waitFor(async () => (await browser("next")).action);
      assert.equal(action.name, "snapshot");
      assert.equal((await browser("complete", {
        actionId: action.id, result: { state: "snapshot", targets: [{ ref: "button", label: "Open details" }] },
      })).state, "shared");
      assert.equal((await read).targets[0].ref, "button");
    }
    await snapshot();
    assert.equal((await send({ op: "request_click", session, arg: "button" })).state, "approval_required");
    const pending = (await browser("next")).action;
    assert.equal(pending.approvalRequired, true);
    assert.ok((await browser("complete", { actionId: pending.id, result: { state: "clicked" } })).error);
    await browser("decide", { actionId: pending.id, decision: "deny" });
    assert.equal((await send({ op: "status", session })).click.state, "denied");
    assert.ok((await send({ op: "request_click", session, arg: "button" })).error);

    await snapshot();
    await send({ op: "request_click", session, arg: "button" });
    const approved = (await browser("next")).action;
    await browser("decide", { actionId: approved.id, decision: "approve" });
    assert.equal((await browser("next")).action.approvalRequired, false);
    assert.equal((await browser("next")).action, undefined);
    await browser("complete", { actionId: approved.id, result: { state: "clicked" } });
    assert.equal((await send({ op: "status", session })).click.state, "clicked");
    await browser("stop");
    assert.ok((await send({ op: "status", session })).error);
  } finally {
    broker.stdin.end();
    await done;
  }
});
