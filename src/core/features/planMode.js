import { composerHandle } from "../pickerDriver.js";
import { findPropsUp } from "../react.js";
import { toast } from "../styles.js";

const PICKER = "button[data-chat-provider-model-picker]";
const BUTTON = "[data-t3tk-plan-mode]";
const IMPLEMENT = "[data-t3tk-implement-plan]";
const FORM = "[data-chat-composer-form]";
const CONTENT_FIELDS = ["images", "files", "terminalContexts", "previewAnnotations", "reviewComments",
  "threadContexts", "environmentContexts"];
const PLAN_PROVIDERS = new Set(["codex", "claudeAgent"]);

// These are the renderer chunks shipped by T3 Code 0.1.13. The command object has stable
// property names, but Vite mangles the exports. A different renderer needs its own verified hook.
const MAIN_ASSET = "main-GgskcymW.js";
const ENTITIES_ASSET = "entities-Cv_YurUT.js";
const EFFECT_ASSET = "network-DUK9MIbu.js";

function rendererAsset() {
  const urls = [
    ...Array.from(document.querySelectorAll('script[type="module"][src], link[rel="modulepreload"][href]'),
      (element) => element.src || element.href),
    ...performance.getEntriesByType("resource").map(({ name }) => name),
  ];
  return urls.find((url) => {
    const asset = new URL(url, location.href);
    return asset.protocol === location.protocol && asset.host === location.host &&
      (asset.pathname === `/assets/${MAIN_ASSET}` || asset.pathname === `/assets/${ENTITIES_ASSET}`);
  });
}

export function attachPlanModeCommands(environment, flatMap, map, selectedMode) {
  const start = environment?.startTurn;
  const setMode = environment?.setInteractionMode;
  if (start?.label !== "environment-data:commands:thread:start-turn" ||
      setMode?.label !== "environment-data:commands:thread:set-interaction-mode" ||
      typeof start.run !== "function" || typeof setMode.run !== "function" ||
      typeof flatMap !== "function" || typeof map !== "function") return null;

  const run = start.run;
  function startWithMode(registry, request) {
    const input = request?.input;
    // The normal composer sends a title seed and an explicit selected model. Preserve
    // native commands, continuation/plan-approval actions and other callers of startTurn.
    if (!input?.titleSeed || input.message?.role !== "user" || !input.modelSelection?.instanceId ||
        input.message.idleCompaction || input.sourceProposedPlan || input.manualContinuationOfRunId ||
        input.interactionMode !== "default") return run.call(this, registry, request);

    const selection = selectedMode(request.environmentId, input.threadId, input.modelSelection.instanceId);
    if (!selection) return run.call(this, registry, request);
    const { approval } = selection;
    const approved = approval && !input.bootstrap &&
      (input.message.text === approval.prompt || input.message.text === `Ultrathink:\n${approval.prompt}`);
    const mode = approved ? "default" : selection.mode;

    const next = { ...request, input: { ...input, interactionMode: mode } };
    if (approved) {
      next.input.sourceProposedPlan = { threadId: input.threadId, planId: approval.planId };
    }
    // A launch carries its mode in the native launch RPC. For existing threads the
    // message RPC reads the thread's persisted mode, so wait for the native setter.
    if (input.bootstrap?.createThread || input.bootstrap?.prepareWorktree) {
      return run.call(this, registry, next);
    }
    return setMode.run(registry, {
      environmentId: request.environmentId,
      input: { threadId: input.threadId, interactionMode: mode },
    }).pipe(flatMap(() => {
      const send = run.call(this, registry, next);
      if (!approved) return send;
      return send.pipe(map((value) => {
        // Keep Plan selected until T3 Code acknowledges the implementation send.
        approval.accept();
        return value;
      }));
    }));
  }
  start.run = startWithMode;
  return () => {
    if (start.run === startWithMode) start.run = run;
  };
}

const modes = new Map();
const approvals = new Map();
const modeKey = (environmentId, threadId, instanceId) => JSON.stringify([environmentId, threadId, instanceId]);
let hook = null;
let loading = null;
let unsupported = false;
let resync = () => {};

function currentComposer() {
  const found = composerHandle();
  const props = found && findPropsUp(found.editor, (p) =>
    typeof p.onCompactContext === "function" && "routeThreadRef" in p && "activeThreadId" in p);
  const form = found?.editor.closest(FORM);
  const picker = form?.querySelector(PICKER);
  const context = picker && found.handle.getSendContext?.();
  if (!props?.canOperateThread || !props.activeThreadId || !props.environmentId ||
      !PLAN_PROVIDERS.has(context?.selectedProvider) || typeof context.prompt !== "string" ||
      !context.selectedModelSelection?.instanceId ||
      context.multipleModelSelections?.length > 1) return null;

  return {
    ...found,
    props,
    form,
    context,
    picker,
    key: modeKey(props.environmentId, props.activeThreadId, context.selectedModelSelection.instanceId),
    busy: props.isSendBusy || props.phase === "running" || props.phase === "connecting" ||
      props.activeThreadRuns?.some(({ status }) => ["preparing", "queued", "starting", "running", "waiting"].includes(status)),
  };
}

export function latestActionablePlan(entries = [], runs = [], latestRunId) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind === "message" && entry.message.role === "user") return null;
    if (entry.kind !== "proposed-plan") continue;
    const plan = entry.proposedPlan;
    return plan.status === "active" && plan.id && plan.planMarkdown?.trim() &&
      (!latestRunId || latestRunId === plan.runId) &&
      runs.some(({ id, status }) => id === plan.runId && status === "completed") ? plan : null;
  }
  return null;
}

function implementAction(composer) {
  const { props, handle, context, form, key } = composer;
  if (modes.get(key) !== "plan" || approvals.has(key) || composer.busy ||
      props.routeKind !== "server" || props.canResume || props.sendDisabledReason ||
      props.environmentUnavailable || props.editingQueuedAttachments != null ||
      props.pendingUserInputs?.length || props.pendingApprovals?.length ||
      !context.providerAvailable || context.answeringPendingUserInput || context.prompt.trim() ||
      CONTENT_FIELDS.some((field) => context[field]?.length) || handle.hasPendingAttachments?.() ||
      handle.isModelPickerOpen() || form.closest("[inert]") ||
      typeof props.captureDetachedSend !== "function") return null;

  return latestActionablePlan(props.promptHistoryEntries, props.activeThreadRuns,
    props.activeThread?.latestRun?.runId);
}

async function implement(composer, plan) {
  const { key, props, context } = composer;
  const prompt = `PLEASE IMPLEMENT THIS PLAN:\n\n${plan.planMarkdown.trim()}`;
  const approval = {
    prompt,
    planId: plan.id,
    accept() {
      if (approvals.get(key) === approval) modes.set(key, "default");
    },
  };
  approvals.set(key, approval);
  resync();
  try {
    // Use the native send path with an explicit prompt, as the composer does after dictation.
    await props.captureDetachedSend()(undefined, "start", "foreground", undefined, {
      prompt,
      sendContext: { ...context, prompt },
    });
  } catch {
    toast("Could not send the plan for implementation.");
  } finally {
    if (approvals.get(key) === approval) approvals.delete(key);
    resync();
  }
}

function onEnter(event) {
  if (event.key !== "Enter" || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.repeat || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
  if (!(event.target instanceof Element) || !event.target.closest(".ProseMirror")) return;
  const composer = currentComposer();
  if (!composer?.editor.contains(event.target)) return;
  const plan = implementAction(composer);
  if (!plan) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void implement(composer, plan);
}

function syncImplement(composer, modeButton) {
  let button = document.querySelector(IMPLEMENT);
  if (!composer || !implementAction(composer)) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.dataset.t3tkImplementPlan = "";
    button.textContent = "Implement";
    button.title = "Implement plan · Enter";
    button.setAttribute("aria-keyshortcuts", "Enter");
    button.addEventListener("click", () => {
      const current = currentComposer();
      const plan = current && button.closest(FORM) === current.form && implementAction(current);
      if (plan) void implement(current, plan);
    });
  }
  if (modeButton.previousElementSibling !== button) modeButton.before(button);
}

function render(button, composer) {
  const planning = modes.get(composer.key) === "plan";
  const label = planning ? "Plan" : "Build";
  if (button.textContent !== label) button.textContent = label;
  if (button.getAttribute("aria-pressed") !== String(planning)) button.setAttribute("aria-pressed", planning);
  const busy = Boolean(composer.busy || approvals.has(composer.key));
  if (button.disabled !== busy) button.disabled = busy;
  button.title = busy ? `${label} mode · wait for the current turn`
    : planning ? "Plan mode · click to switch to Build" : "Build mode · click to switch to Plan";
}

export const planMode = {
  id: "plan-mode",
  title: "Plan / Build button",
  surfaces: ["desktop", "web"],
  init({ resync: schedule }) { resync = schedule; },
  sync() {
    const composer = currentComposer();
    let button = document.querySelector(BUTTON);
    if (!composer || unsupported) {
      button?.remove();
      syncImplement(null);
      return "idle";
    }
    if (!hook && !loading) {
      const base = rendererAsset();
      if (!base) return "idle";
      const pending = Promise.all([
        import(new URL(ENTITIES_ASSET, base).href),
        import(new URL(EFFECT_ASSET, base).href),
      ]);
      loading = pending;
      pending.then(([{ it: environment }, { Wp: flatMap, hm: map }]) => {
        if (loading !== pending) return;
        hook = attachPlanModeCommands(environment, flatMap, map, (environmentId, threadId, instanceId) => {
          const key = modeKey(environmentId, threadId, instanceId);
          const mode = modes.get(key);
          return mode && { mode, approval: approvals.get(key) };
        });
        if (hook) window.addEventListener("keydown", onEnter, true);
        unsupported = !hook;
      }).catch(() => {
        if (loading === pending) unsupported = true;
      }).finally(() => {
        if (loading !== pending) return;
        loading = null;
        resync();
      });
    }
    if (!hook) return "idle";
    if (!modes.has(composer.key) && composer.props.routeKind === "server" &&
        composer.props.activeThread?.interactionMode === "plan") {
      modes.set(composer.key, "plan");
    }
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.t3tkPlanMode = "";
      button.setAttribute("aria-label", "Plan mode");
      button.addEventListener("click", () => {
        const current = currentComposer();
        if (!current || current.busy || approvals.has(current.key) ||
            button.nextElementSibling !== current.picker) return;
        modes.set(current.key, modes.get(current.key) === "plan" ? "default" : "plan");
        render(button, current);
        syncImplement(current, button);
      });
    }
    render(button, composer);
    if (button.nextElementSibling !== composer.picker) composer.picker.before(button);
    syncImplement(composer, button);
    return "ok";
  },
  stop() {
    loading = null;
    hook?.();
    hook = null;
    unsupported = false;
    modes.clear();
    approvals.clear();
    window.removeEventListener("keydown", onEnter, true);
    syncImplement(null);
    document.querySelectorAll(BUTTON).forEach((button) => button.remove());
  },
};
