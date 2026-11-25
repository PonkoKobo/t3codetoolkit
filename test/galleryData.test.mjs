import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeImages, classifyImageSource, imagesFromRows, markdownImageSources, projectThreads, toolOutputImageMimes } from "../src/core/galleryData.js";

const thread = { id: "thread-a", title: "Sprite work", updatedAt: "2026-01-03T00:00:00.000Z" };

test("image sources: web, data, absolute, relative and file URLs", () => {
  assert.deepEqual(classifyImageSource("https://example.com/a.png?x=1"), { url: "https://example.com/a.png?x=1" });
  assert.deepEqual(classifyImageSource("data:image/png;base64,AAAA"), { url: "data:image/png;base64,AAAA" });
  assert.deepEqual(classifyImageSource("C:\\work\\shot.png"), { path: "C:\\work\\shot.png", relative: false });
  assert.deepEqual(classifyImageSource("/srv/out/shot.jpg"), { path: "/srv/out/shot.jpg", relative: false });
  assert.deepEqual(classifyImageSource("out/my%20shot.webp"), { path: "out/my shot.webp", relative: true });
  assert.deepEqual(classifyImageSource("file:///C:/work/a%20b.png"), { path: "C:/work/a b.png", relative: false });
  assert.deepEqual(classifyImageSource("file:///srv/a.png"), { path: "/srv/a.png", relative: false });
  assert.deepEqual(classifyImageSource("<out/space name.png>"), { path: "out/space name.png", relative: true });
  for (const no of ["out/readme.md", "mailto:x@example.com", "javascript:alert(1)", "", null]) assert.equal(classifyImageSource(no), null);
});

test("markdown and html image tags are found, links are not", () => {
  const text = 'See ![hero](out/hero.png "Hero") and [doc](out/a.png) plus <img alt="map" src=\'maps/m.png\'>.';
  assert.deepEqual(markdownImageSources(text), [
    { alt: "hero", src: "out/hero.png" },
    { alt: "map", src: "maps/m.png" },
  ]);
});

test("tool output images follow the server's index order and limits", () => {
  const png = { type: "image", source: { type: "base64", media_type: "image/png" } };
  assert.deepEqual(toolOutputImageMimes([{ type: "text", text: "hi" }, png, { type: "image", mimeType: "image/svg+xml" }, { type: "image", mimeType: "image/jpeg" }]), ["image/png", "image/jpeg"]);
  assert.deepEqual(toolOutputImageMimes({ content: [png] }), ["image/png"]);
  assert.deepEqual(toolOutputImageMimes(png), ["image/png"]);
  assert.equal(toolOutputImageMimes(Array(12).fill(png)).length, 8);
  assert.deepEqual(toolOutputImageMimes({ type: "image", source: { type: "url", url: "https://example.com" } }), []);
});

test("rows yield sent attachments, agent markdown images and tool images once each", () => {
  const rows = [
    { position: 1, item: { id: "i1", type: "user_message", text: "look", startedAt: "2026-01-01T00:00:00.000Z", attachments: [{ type: "image", id: "att-1", name: "ref.png", mimeType: "image/png", sizeBytes: 100 }, { type: "file", id: "att-2", name: "notes.txt", mimeType: "text/plain" }] } },
    { position: 2, item: { id: "i2", type: "assistant_message", text: "Done ![](out/a.png) ![again](out/a.png)", completedAt: "2026-01-02T00:00:00.000Z" } },
    { position: 3, item: { id: "i3", type: "dynamic_tool", toolName: "browser.screenshot", output: [{ type: "image", mimeType: "image/png" }], startedAt: "2026-01-02T01:00:00.000Z" } },
    { position: 4, item: { id: "i4", type: "assistant_message", threadId: "other-thread", text: "![](x.png)" } },
  ];
  const images = imagesFromRows(rows, thread);
  assert.deepEqual(
    images.map(({ key, from, name }) => ({ key, from, name })),
    [
      { key: "attachment:att-1", from: "you", name: "ref.png" },
      { key: "file:thread-a:out/a.png", from: "agent", name: "a.png" },
      { key: "tool:i3:0", from: "agent", name: "screenshot output 1" },
    ],
  );
  assert.deepEqual(images[1].resource, { _tag: "media-file", threadId: "thread-a", path: "out/a.png", hostOnly: true });
  assert.deepEqual(images[2].resource, { _tag: "tool-output-image", threadId: "thread-a", itemId: "i3", index: 0 });
  assert.equal(images[0].threadTitle, "Sprite work");
});

test("arrange filters by words and source, sorts newest first by default without mutating", () => {
  const list = [
    { name: "b.png", threadTitle: "Level", from: "agent", createdAt: "2026-01-01T00:00:00Z", sizeBytes: 5 },
    { name: "a.png", threadTitle: "Sprites", from: "you", createdAt: "2026-01-03T00:00:00Z", sizeBytes: 1 },
    { name: "c.png", threadTitle: "Sprites", from: "agent", createdAt: "2026-01-02T00:00:00Z", sizeBytes: null },
  ];
  const before = list.map((i) => i.name);
  assert.deepEqual(arrangeImages(list).map((i) => i.name), ["a.png", "c.png", "b.png"]);
  assert.deepEqual(arrangeImages(list, { sort: "oldest" }).map((i) => i.name), ["b.png", "c.png", "a.png"]);
  assert.deepEqual(arrangeImages(list, { sort: "size" }).map((i) => i.name), ["b.png", "a.png", "c.png"]);
  assert.deepEqual(arrangeImages(list, { query: "sprites" }).map((i) => i.name), ["a.png", "c.png"]);
  assert.deepEqual(arrangeImages(list, { from: "agent", sort: "name" }).map((i) => i.name), ["b.png", "c.png"]);
  assert.deepEqual(list.map((i) => i.name), before);
});

test("project threads keep the newest copy, skip deleted and other projects", () => {
  const threads = [
    { id: "t1", projectId: "p1", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "t2", projectId: "p1", updatedAt: "2026-01-05T00:00:00Z" },
    { id: "t1", projectId: "p1", updatedAt: "2026-01-06T00:00:00Z", title: "newer" },
    { id: "t3", projectId: "p1", deletedAt: "2026-01-02T00:00:00Z" },
    { id: "t4", projectId: "p2" },
  ];
  assert.deepEqual(projectThreads(threads, ["p1"]).map((t) => [t.id, t.title]), [["t1", "newer"], ["t2", undefined]]);
});
