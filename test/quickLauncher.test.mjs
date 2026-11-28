import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  buildLaunchArgs,
  childEnv,
  normalizeLaunchers,
  normalizeMenuData,
  publicLauncherSpecs,
  readMenu,
  resolveActionTarget,
  runLaunchCommand,
  spawnDetached,
  toPublicMenu,
  validateCachedMenu,
} from "../desktop/quick-launcher.mjs";
import {
  filterMenuItems,
  matchesShortcut,
  menuDigitSlot,
  parseShortcut,
} from "../src/core/quickLauncherKeys.js";

const tmp = mkdtempSync(join(tmpdir(), "t3tk-ql-"));
const fakeProvider = join(tmp, "provider.mjs");

before(() => {
  writeFileSync(fakeProvider, `
    const mode = process.argv[2];
    if (mode === "--menu") {
      console.log(JSON.stringify({
        quickResume: { group: "Alpha", label: "Run Alpha", target: "/apps/alpha.cmd", meta: "261128 10:00" },
        items: [
          {
            id: "alpha",
            label: "Alpha",
            subtitle: "Run Alpha (261128)",
            defaultAction: { label: "Run Alpha", target: "/apps/alpha.cmd", category: "Play", meta: "261128" },
            actions: [
              { label: "Run Alpha", target: "/apps/alpha.cmd", category: "Play" },
              { label: "Open Alpha Editor", target: "/apps/alpha-ed.cmd", category: "Editor" },
            ],
          },
          {
            id: "tools",
            label: "Tools",
            defaultAction: null,
            actions: [{ label: "Tool One", target: "/apps/tool1.exe", category: "Tool" }],
          },
        ],
      }));
    } else if (mode === "--bad-json") {
      console.log("not json");
    } else if (mode === "--launch-ok") {
      process.exit(0);
    } else if (mode === "--launch-cancel") {
      process.exit(3);
    } else if (mode === "--launch-delayed-cancel") {
      setTimeout(() => process.exit(3), 120);
    } else if (mode === "--launch-fail") {
      console.error("Missing C:\\\\Secret\\\\PrivatePath\\\\game.cmd");
      process.exit(2);
    } else if (mode === "--check-env") {
      if (process.env.ELECTRON_RUN_AS_NODE || process.env.NODE_OPTIONS) {
        console.error("Inherited Electron/Node override");
        process.exit(1);
      }
      process.exit(0);
    } else {
      process.exit(2);
    }
  `);
});

after(() => rmSync(tmp, { recursive: true, force: true }));

test("parseShortcut and matchesShortcut handle Ctrl+G and modifiers cleanly", () => {
  const ctrlG = parseShortcut("ctrl+g");
  assert.deepEqual(ctrlG, { ctrl: true, alt: false, shift: false, meta: false, mod: false, key: "g", label: "Ctrl+G" });
  assert.equal(matchesShortcut({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: "g", code: "KeyG" }, ctrlG), true);
  assert.equal(matchesShortcut({ ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, key: "g", code: "KeyG" }, ctrlG), false);
  assert.equal(matchesShortcut({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: "g", repeat: true }, ctrlG), false);
  assert.equal(matchesShortcut({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: "g", getModifierState: (k) => k === "AltGraph" }, ctrlG), false);

  const cmdOrCtrl = parseShortcut("CmdOrCtrl+Shift+L");
  assert.equal(matchesShortcut({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: "L" }, cmdOrCtrl, false), true);
  assert.equal(matchesShortcut({ ctrlKey: false, shiftKey: true, altKey: false, metaKey: true, key: "L" }, cmdOrCtrl, true), true);
  assert.equal(parseShortcut("Ctrl+F12"), null);
  assert.equal(parseShortcut(""), null);
});

test("filterMenuItems distinguishes group matches from sub-action matches and maps 1-9 slots", () => {
  const items = [
    {
      id: "a",
      label: "Project Alpha",
      subtitle: "Play Demo",
      defaultAction: { actionId: "a1", label: "Play Demo" },
      actions: [
        { actionId: "a1", label: "Play Demo", category: "Play" },
        { actionId: "a2", label: "Open Editor", category: "Editor" },
      ],
    },
    {
      id: "b",
      label: "Project Beta",
      subtitle: "Run Test",
      defaultAction: { actionId: "b1", label: "Run Test" },
      actions: [{ actionId: "b2", label: "Build Release", category: "Build", description: "Package binary" }],
    },
  ];
  assert.equal(filterMenuItems(items, "").length, 2);

  const beta = filterMenuItems(items, "beta");
  assert.deepEqual(beta.map((m) => [m.item.id, m.groupMatches]), [["b", true]]);

  // Sub-action only match flags groupMatches=false and narrows matchedActions to the Editor action.
  const editor = filterMenuItems(items, "editor");
  assert.equal(editor.length, 1);
  assert.equal(editor[0].item.id, "a");
  assert.equal(editor[0].groupMatches, false);
  assert.deepEqual(editor[0].matchedActions.map((a) => a.actionId), ["a2"]);

  const binary = filterMenuItems(items, "binary");
  assert.equal(binary[0].item.id, "b");
  assert.equal(binary[0].groupMatches, false);

  assert.equal(menuDigitSlot({ key: "1" }), 0);
  assert.equal(menuDigitSlot({ key: "9" }), 8);
  assert.equal(menuDigitSlot({ key: "0" }), -1);
  assert.equal(menuDigitSlot({ key: "1", ctrlKey: true }), -1);
});

test("normalizeLaunchers rejects relative paths and publicLauncherSpecs hides host paths", () => {
  const launchers = normalizeLaunchers([
    {
      id: "main",
      label: "Apps",
      shortcut: "Ctrl+G",
      openApp: process.execPath,
      listCommand: [process.execPath, fakeProvider, "--menu"],
      launchCommand: [process.execPath, fakeProvider, "--launch", "{target}"],
    },
    { id: "relative", label: "Bad", openApp: "relative/app.exe" },
    { id: "main", label: "Duplicate", openApp: process.execPath },
  ]);
  assert.equal(launchers.length, 1);
  assert.deepEqual(publicLauncherSpecs(launchers), [{
    id: "main",
    label: "Apps",
    shortcut: "Ctrl+G",
    hasMenu: true,
    canOpenApp: true,
    canLaunch: true,
  }]);
  assert.ok(!JSON.stringify(publicLauncherSpecs(launchers)).includes(fakeProvider));
});

test("buildLaunchArgs preserves literal $$, $&, and {path} inside targets and childEnv strips Electron overrides", () => {
  const tricky = "C:\\Games\\Foo$$Bar$&\\{path}\\Play.cmd";
  assert.deepEqual(
    buildLaunchArgs(["C:\\Tools\\app.exe", "--launch", "{target}", "--no-activate"], tricky),
    {
      executable: "C:\\Tools\\app.exe",
      args: ["--launch", tricky, "--no-activate"],
    },
  );
  const env = childEnv({ PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "--require x" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test("readMenu, toPublicMenu, cache binding, resolveActionTarget and runLaunchCommand work end-to-end", async () => {
  const [launcher] = normalizeLaunchers([{
    id: "demo",
    label: "Demo",
    listCommand: [process.execPath, fakeProvider, "--menu"],
    launchCommand: [process.execPath, fakeProvider, "--launch-ok", "{target}"],
  }]);
  const [differentProvider] = normalizeLaunchers([{
    id: "demo",
    label: "Demo",
    listCommand: [process.execPath, fakeProvider, "--menu", "--v2"],
    launchCommand: [process.execPath, fakeProvider, "--launch-ok", "{target}"],
  }]);

  const menu = await readMenu(launcher);
  assert.equal(menu.quickResume.target, "/apps/alpha.cmd");
  assert.equal(menu.items.length, 2);
  assert.equal(menu.items[1].defaultAction, null);

  // Public menu strips raw host targets and keeps opaque actionIds.
  const pub = toPublicMenu(menu);
  assert.ok(!JSON.stringify(pub).includes("/apps/"));
  assert.equal(resolveActionTarget(menu, pub.quickResume.actionId), "/apps/alpha.cmd");
  assert.equal(resolveActionTarget(menu, pub.items[0].actions[1].actionId), "/apps/alpha-ed.cmd");
  assert.equal(resolveActionTarget(menu, "forged-action-id"), null);

  // Disk cache validates schema and rejects snapshots from a different provider config.
  const cachedRecord = { configHash: launcher.configHash, snapshot: menu };
  assert.ok(validateCachedMenu(cachedRecord, launcher));
  assert.equal(validateCachedMenu(cachedRecord, differentProvider), null);
  assert.equal(validateCachedMenu({ configHash: launcher.configHash, snapshot: "corrupt" }, launcher), null);

  // runLaunchCommand distinguishes success (0), cancellation (3), delayed cancellation, sanitized failure, and strips ELECTRON_RUN_AS_NODE.
  assert.deepEqual(await runLaunchCommand(process.execPath, [fakeProvider, "--launch-ok"]), { ok: true });
  assert.deepEqual(await runLaunchCommand(process.execPath, [fakeProvider, "--launch-cancel"]), { ok: false, cancelled: true });

  const late = [];
  const pendingResult = await runLaunchCommand(process.execPath, [fakeProvider, "--launch-delayed-cancel"], {
    pendingAfterMs: 30,
    onLateResult: (outcome) => late.push(outcome),
  });
  assert.deepEqual(pendingResult, { ok: true, pending: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual(late, [{ ok: false, cancelled: true }]);

  const diagnostics = [];
  await assert.rejects(
    () => runLaunchCommand(process.execPath, [fakeProvider, "--launch-fail"], {
      onDiagnostic: (msg) => diagnostics.push(msg),
    }),
    (err) => /no longer available/i.test(err.message) && !err.message.includes("Secret"),
  );
  assert.ok(diagnostics.some((d) => d.includes("Secret")));

  const prevElectron = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = "1";
  try {
    assert.deepEqual(await runLaunchCommand(process.execPath, [fakeProvider, "--check-env"]), { ok: true });
  } finally {
    if (prevElectron === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = prevElectron;
  }

  const [badJson] = normalizeLaunchers([{ id: "bad", label: "Bad", listCommand: [process.execPath, fakeProvider, "--bad-json"] }]);
  await assert.rejects(() => readMenu(badJson), /non-JSON/);

  const [missingList] = normalizeLaunchers([{ id: "missing", label: "Missing", listCommand: [join(tmp, "secret-bin-nope")] }]);
  await assert.rejects(() => readMenu(missingList), (err) => /Could not load Missing/.test(err.message) && !err.message.includes("secret-bin-nope"));

  assert.throws(() => normalizeMenuData("invalid"), /invalid menu data/i);
  assert.throws(() => normalizeMenuData({ items: "not-an-array" }), /invalid menu data/i);
  await assert.rejects(() => spawnDetached(join(tmp, "missing-executable-nope")), (err) => /Could not start/.test(err.message) && !err.message.includes("missing-executable-nope"));
});
