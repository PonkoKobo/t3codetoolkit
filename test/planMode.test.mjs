import assert from "node:assert/strict";
import { test } from "node:test";
import { attachPlanModeCommands, latestActionablePlan } from "../src/core/features/planMode.js";

function setup({ refuseMode = false, refuseSend = false } = {}) {
  const calls = [];
  const effect = (run) => ({ run, pipe: (apply) => apply(effect(run)) });
  const flatMap = (next) => (previous) =>
    effect(async () => next(await previous.run()).run());
  const map = (transform) => (previous) =>
    effect(async () => transform(await previous.run()));
  const commands = {
    startTurn: {
      label: "environment-data:commands:thread:start-turn",
      run: (_, request) => effect(() => {
        calls.push(["start", request]);
        if (refuseSend) throw new Error("Send failed");
      }),
    },
    setInteractionMode: {
      label: "environment-data:commands:thread:set-interaction-mode",
      run: (_, request) => effect(() => {
        calls.push(["mode", request]);
        if (refuseMode) throw new Error("Mode change failed");
      }),
    },
  };
  const original = commands.startTurn.run;
  let mode = "plan";
  let approval;
  const stop = attachPlanModeCommands(commands, flatMap, map, (environmentId, threadId, instanceId) =>
    environmentId === "local" && threadId === "target" && instanceId === "codex"
      ? { mode, approval } : undefined);
  const send = (input = {}, environmentId = "local") => commands.startTurn.run(null, {
    environmentId,
    input: {
      threadId: "target",
      titleSeed: "A message",
      modelSelection: { instanceId: "codex" },
      message: { role: "user", text: "A message", attachments: [{ id: "one" }] },
      interactionMode: "default",
      ...input,
    },
  }).run();
  return {
    calls, commands, original, send, stop,
    build: () => { mode = "default"; },
    approve: (prompt) => {
      approval = { prompt, planId: "latest-plan", accept: () => { mode = "default"; } };
    },
    mode: () => mode,
  };
}

test("existing threads change mode before the original send, and can return to Build", async () => {
  const { calls, send, build } = setup();
  await send();
  build();
  await send();
  assert.deepEqual(calls.map(([action, { input }]) => [action, input.interactionMode]),
    [["mode", "plan"], ["start", "plan"], ["mode", "default"], ["start", "default"]]);
  assert.deepEqual(calls[1][1].input.message.attachments, [{ id: "one" }]);
});

test("a draft carries Plan on launch, and a refused mode change leaves an existing message unsent", async () => {
  const { calls, send } = setup({ refuseMode: true });
  await send({ bootstrap: { createThread: { projectId: "project" } } });
  await assert.rejects(() => send(), /Mode change failed/);
  assert.deepEqual(calls.map(([action, { input }]) => [action, input.interactionMode]),
    [["start", "plan"], ["mode", "plan"]]);
});

test("other scopes, providers and native actions pass through, and stop restores the command", async () => {
  const { calls, commands, original, send, stop } = setup();
  await send({ threadId: "other-thread" });
  await send({ modelSelection: { instanceId: "unsupported" } });
  await send({}, "other-environment");
  await send({ sourceProposedPlan: { planId: "one" } });
  await send({ titleSeed: undefined });
  stop();
  assert.equal(commands.startTurn.run, original);
  await send();
  assert.deepEqual(calls.map(([action, { input }]) => [action, input.interactionMode]),
    Array.from({ length: 6 }, () => ["start", "default"]));
});

test("only the armed approval switches to Build and links the implementation to its plan", async () => {
  const { approve, calls, send, mode } = setup();
  const prompt = "PLEASE IMPLEMENT THIS PLAN:\n\nCheck the results.";
  approve(prompt);
  await send();
  assert.equal(mode(), "plan");
  assert.equal(calls[1][1].input.sourceProposedPlan, undefined);
  await send({ message: { role: "user", text: `Ultrathink:\n${prompt}`, attachments: [] } });
  assert.equal(calls[2][1].input.interactionMode, "default");
  assert.deepEqual(calls[3][1].input.sourceProposedPlan, { threadId: "target", planId: "latest-plan" });
  assert.equal(mode(), "default");
});

test("an unacknowledged implementation keeps the Plan selection", async () => {
  const { approve, send, mode } = setup({ refuseSend: true });
  approve("Implement this");
  await assert.rejects(send({ message: { role: "user", text: "Implement this" } }), /Send failed/);
  assert.equal(mode(), "plan");
});

test("only an active plan from the latest completed turn can be implemented", () => {
  const user = { kind: "message", message: { role: "user" } };
  const plan = { id: "new", runId: "run", status: "active", planMarkdown: "# Plan" };
  const entry = { kind: "proposed-plan", proposedPlan: plan };
  const completed = [{ id: "run", status: "completed" }];
  assert.equal(latestActionablePlan([user, entry], completed, "run"), plan);
  assert.equal(latestActionablePlan([user, entry, user], completed, "run"), null);
  assert.equal(latestActionablePlan([user, entry], completed, "new-run"), null);
  assert.equal(latestActionablePlan([user, entry], [{ id: "run", status: "running" }]), null);
  assert.equal(latestActionablePlan([user, entry, {
    ...entry, proposedPlan: { ...plan, id: "superseding-plan", status: "superseded" },
  }], completed), null);
});
