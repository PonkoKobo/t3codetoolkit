// Pure helpers for the project image gallery: find images in thread transcript rows and sort them.
// No DOM or network here so they can be unit-tested with plain fixtures.

// Raster types only, matching what the server will serve inline for tool output images.
const RASTER_MIME = /^image\/(png|jpe?g|gif|webp)$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
const MAX_TOOL_IMAGES_PER_ITEM = 8; // the server indexes at most 8 images per tool item

const isObject = (v) => v !== null && typeof v === "object";

/** Image blocks in a tool item's output, in the order the server's `tool-output-image` index uses. */
export function toolOutputImageMimes(output) {
  const blocks = Array.isArray(output) ? output : isObject(output) && Array.isArray(output.content) ? output.content : [output];
  const mimes = [];
  for (const block of blocks) {
    if (!isObject(block) || block.type !== "image") continue;
    const source = isObject(block.source) ? block.source : undefined;
    if (source !== undefined && source.type !== "base64") continue;
    const mime = source === undefined ? block.mimeType : source.media_type;
    if (typeof mime !== "string" || !RASTER_MIME.test(mime)) continue;
    mimes.push(mime.toLowerCase());
    if (mimes.length === MAX_TOOL_IMAGES_PER_ITEM) break;
  }
  return mimes;
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Classify a markdown/HTML image destination.
 * Returns { url } for web/data images, { path, relative } for files on the server's machine, or null.
 */
export function classifyImageSource(raw) {
  if (typeof raw !== "string") return null;
  let src = raw.trim();
  if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1).trim();
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return { url: src };
  if (/^data:image\//i.test(src)) return { url: src };
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^file:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) return null; // other schemes
  let path = src;
  path = safeDecode(/^file:/i.test(path) ? path.replace(/^file:\/*/i, "") : path);
  path = path.split(/[?#]/, 1)[0];
  if (/^file:/i.test(src) && !/^[a-z]:/i.test(path) && !path.startsWith("/")) path = `/${path}`;
  if (!IMAGE_EXTENSION.test(path)) return null;
  const absolute = /^[a-z]:[\\/]/i.test(path) || path.startsWith("/") || path.startsWith("\\\\");
  return { path, relative: !absolute };
}

/** Decode an embedded image without a network request, which the desktop renderer can block. */
export function embeddedImageBlob(url) {
  const [, type, parameters, payload] = /^data:(image\/[^;,]+)([^,]*),(.*)$/is.exec(url.split("#", 1)[0]) ?? [];
  if (!type) throw new Error("Invalid embedded image URL");
  if (/;\s*base64\s*$/i.test(parameters)) {
    const bytes = Uint8Array.from(atob(decodeURIComponent(payload)), (byte) => byte.charCodeAt(0));
    return new Blob([bytes], { type });
  }
  const bytes = new TextEncoder().encode(payload);
  let length = 0;
  for (let offset = 0; offset < bytes.length; offset++) {
    if (bytes[offset] === 37 && offset + 2 < bytes.length) {
      const hex = String.fromCharCode(bytes[offset + 1], bytes[offset + 2]);
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        bytes[length++] = Number.parseInt(hex, 16);
        offset += 2;
        continue;
      }
    }
    bytes[length++] = bytes[offset];
  }
  return new Blob([bytes.subarray(0, length)], { type });
}

/** Image destinations written in markdown text: `![alt](dest "title")` and `<img src="...">`. */
export function markdownImageSources(text) {
  if (typeof text !== "string" || !text.includes("!") && !/<img/i.test(text)) return [];
  const found = [];
  const markdown = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  for (let m; (m = markdown.exec(text)); ) found.push({ alt: m[1], src: m[2] });
  const html = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
  for (let m; (m = html.exec(text)); ) {
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0]);
    found.push({ alt: alt?.[1] ?? alt?.[2] ?? "", src: m[1] ?? m[2] });
  }
  return found;
}

const baseName = (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

function rowItem(row) {
  return isObject(row) && isObject(row.item) ? row.item : isObject(row) && typeof row.type === "string" ? row : null;
}

/**
 * Images in one thread's transcript rows.
 * Each entry: { key, threadId, threadTitle, from: "you"|"agent", name, mimeType, sizeBytes, createdAt,
 *               resource (asset resource to mint) | url (direct) }.
 */
export function imagesFromRows(rows, thread) {
  const out = [];
  const seen = new Set();
  const push = (entry) => {
    if (seen.has(entry.key)) return;
    seen.add(entry.key);
    out.push({ threadId: thread.id, threadTitle: thread.title ?? "", ...entry });
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = rowItem(row);
    if (!item) continue;
    // Rows from other threads (forks, subagents) belong to those threads; they are listed there.
    if (item.threadId && item.threadId !== thread.id) continue;
    const createdAt = item.startedAt ?? item.completedAt ?? item.updatedAt ?? thread.updatedAt ?? null;
    const from = item.type === "user_message" ? "you" : "agent";

    for (const a of Array.isArray(item.attachments) ? item.attachments : []) {
      if (!isObject(a) || typeof a.id !== "string") continue;
      const mime = typeof a.mimeType === "string" ? a.mimeType : "";
      if (a.type !== "image" && !mime.startsWith("image/")) continue;
      push({ key: `attachment:${a.id}`, from, name: a.name || "image", mimeType: mime, sizeBytes: a.sizeBytes ?? null, createdAt, resource: { _tag: "attachment", attachmentId: a.id } });
    }

    if (item.type === "assistant_message" && typeof item.text === "string") {
      for (const { alt, src } of markdownImageSources(item.text)) {
        const kind = classifyImageSource(src);
        if (!kind) continue;
        if (kind.url) {
          push({ key: `url:${kind.url.slice(0, 500)}`, from: "agent", name: alt || (kind.url.startsWith("data:") ? "image" : baseName(kind.url.split(/[?#]/, 1)[0])), mimeType: "", sizeBytes: null, createdAt, url: kind.url });
        } else {
          const resource = { _tag: "media-file", threadId: thread.id, path: kind.path, ...(kind.relative ? { hostOnly: true } : {}) };
          push({ key: `file:${thread.id}:${kind.path}`, from: "agent", name: baseName(kind.path), mimeType: "", sizeBytes: null, createdAt, resource, path: kind.path });
        }
      }
    }

    if (item.type === "dynamic_tool" && typeof item.id === "string") {
      toolOutputImageMimes(item.output).forEach((mimeType, index) => {
        const tool = typeof item.toolName === "string" ? item.toolName.split(/[.:/]/).at(-1) : "tool";
        push({ key: `tool:${item.id}:${index}`, from: "agent", name: `${tool || "tool"} output ${index + 1}`, mimeType, sizeBytes: null, createdAt, resource: { _tag: "tool-output-image", threadId: thread.id, itemId: item.id, index } });
      });
    }
  }
  return out;
}

const time = (iso) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
};
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

export const SORTS = {
  newest: { label: "Newest first", compare: (a, b) => time(b.createdAt) - time(a.createdAt) || byName(a, b) },
  oldest: { label: "Oldest first", compare: (a, b) => time(a.createdAt) - time(b.createdAt) || byName(a, b) },
  name: { label: "Name A–Z", compare: (a, b) => byName(a, b) || time(b.createdAt) - time(a.createdAt) },
  size: { label: "Largest first", compare: (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) || time(b.createdAt) - time(a.createdAt) },
  thread: {
    label: "By thread",
    compare: (a, b) => a.threadTitle.localeCompare(b.threadTitle, undefined, { sensitivity: "base" }) || time(b.createdAt) - time(a.createdAt),
  },
};

/** Filter by text (name, thread title, path) and source, then sort. Never mutates the input. */
export function arrangeImages(images, { sort = "newest", query = "", from = "all" } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = images.filter((img) => {
    if (from !== "all" && img.from !== from) return false;
    if (!words.length) return true;
    const hay = `${img.name} ${img.threadTitle} ${img.path ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return kept.sort((SORTS[sort] ?? SORTS.newest).compare);
}

/** Threads of the given projects, newest activity first, excluding deleted ones. */
export function projectThreads(threads, projectIds) {
  const ids = new Set(projectIds);
  const byId = new Map();
  for (const t of threads) {
    if (!isObject(t) || !ids.has(t.projectId) || t.deletedAt) continue;
    const prev = byId.get(t.id);
    if (!prev || time(t.updatedAt) >= time(prev.updatedAt)) byId.set(t.id, t);
  }
  return [...byId.values()].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
}
