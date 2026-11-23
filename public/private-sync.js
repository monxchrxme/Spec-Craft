import { emptyWorkspace, mergeWorkspace, sameWorkspaceSummary, workspaceSummary } from "./private-workspace-model.js";

const endpoint = "/api/private-workspace";
const partSize = 1_500_000;
const maxParts = 16;
const blankSummary = () => ({ documents: {}, folders: [] });

export async function privateRequest(action, input, workspace, extra = {}) {
  const query = new URLSearchParams(action ? { action, ...extra.query } : extra.query);
  const headers = workspace ? { "X-SpecCraft-Workspace": workspace } : {};
  if (input !== undefined) headers["Content-Type"] = "application/json";
  if (extra.etag) headers["If-None-Match"] = extra.etag;
  let response;
  try {
    response = await fetch(endpoint + "?" + query, {
      headers, cache: "no-store",
      method: input === undefined ? "GET" : "POST",
      body: input === undefined ? undefined : JSON.stringify(input),
      signal: AbortSignal.timeout(18_000),
    });
  } catch {
    throw Error("Нет связи с личным пространством.");
  }
  if (response.status === 304) return { unchanged: true };
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = Error(data?.error || "Личная синхронизация временно недоступна.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function base64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  return btoa(chunks.join(""));
}

async function pack(snapshot) {
  const blob = new Blob([JSON.stringify(snapshot)]);
  if (!globalThis.CompressionStream)
    return "r" + base64(new Uint8Array(await blob.arrayBuffer()));
  const gzip = blob.stream().pipeThrough(new CompressionStream("gzip"));
  return "g" + base64(new Uint8Array(await new Response(gzip).arrayBuffer()));
}

async function unpack(packed) {
  const bytes = Uint8Array.from(atob(packed.slice(1)), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream();
  const content = packed[0] === "g" ? stream.pipeThrough(new DecompressionStream("gzip")) : stream;
  const snapshot = JSON.parse(await new Response(content).text());
  if (!Array.isArray(snapshot.documents) || !Array.isArray(snapshot.folders) ||
      snapshot.documents.some((doc) => typeof doc?.id !== "string" ||
        typeof doc.body !== "string" || typeof doc.name !== "string"))
    throw Error("Не удалось прочитать документы из облака.");
  return snapshot;
}

async function readSnapshot(workspace, current) {
  if (!current) return emptyWorkspace();
  const pieces = await Promise.all(Array.from({ length: current.parts }, (_, part) =>
    privateRequest("part", undefined, workspace, { query: { upload: current.upload, part } })));
  return unpack(pieces.map(({ text }) => text).join(""));
}

async function publish(workspace, snapshot, etag) {
  const text = await pack(snapshot);
  const parts = Math.ceil(text.length / partSize);
  if (parts > maxParts)
    throw Error("Личное пространство слишком велико для синхронизации. Локальные файлы сохранены.");
  const upload = crypto.randomUUID();
  try {
    for (let part = 0; part < parts; part++)
      await privateRequest("part", {
        upload, part, text: text.slice(part * partSize, (part + 1) * partSize),
      }, workspace);
    return await privateRequest("commit", { upload, parts, etag }, workspace);
  } catch (error) {
    // The server skips cleanup if the commit succeeded but its response was lost.
    await privateRequest("discard", { upload, parts }, workspace).catch(() => {});
    throw error;
  }
}

export function personalSync({ workspace, read, apply, canApply, status }) {
  const key = "speccraft:private-base:" + workspace;
  let inFlight, timer, pending = false;
  const initial = () => ({ etag: null, summary: blankSummary() });
  const readBase = () => {
    try {
      return JSON.parse(localStorage.getItem(key)) || initial();
    } catch {
      return initial();
    }
  };
  const retainBase = (etag, summary) => localStorage.setItem(key, JSON.stringify({ etag, summary }));

  async function run() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const base = readBase();
      const manifest = await privateRequest("", undefined, workspace, { etag: base.etag });
      const remote = manifest.unchanged ? null : await readSnapshot(workspace, manifest.current);
      const theirSummary = remote ? await workspaceSummary(remote) : base.summary;
      const mine = read();
      const mySummary = await workspaceSummary(mine);
      let snapshot = mine, summary = mySummary, conflicts = 0;
      const etag = manifest.unchanged ? base.etag : manifest.etag;
      if (remote && !sameWorkspaceSummary(mySummary, theirSummary)) {
        ({ workspace: snapshot, conflicts } = mergeWorkspace(base.summary, mine, remote, mySummary, theirSummary));
        summary = await workspaceSummary(snapshot);
        if (!sameWorkspaceSummary(summary, mySummary)) {
          if (!canApply()) {
            status("Завершите редактирование, чтобы получить изменения с другого устройства.");
            return false;
          }
          if (!apply(mine, snapshot)) continue;
        }
      }
      retainBase(etag, theirSummary);
      if (!sameWorkspaceSummary(summary, theirSummary)) {
        status("Синхронизация личных документов…");
        try {
          const saved = await publish(workspace, snapshot, etag);
          retainBase(saved.etag, summary);
        } catch (error) {
          if (error.status === 409) continue;
          throw error;
        }
      }
      status(conflicts
        ? "Синхронизировано. Пересекающиеся правки сохранены в отдельных копиях."
        : "Личное пространство синхронизировано.");
      return true;
    }
    status("Есть изменения на другом устройстве. Повторим синхронизацию.");
    return false;
  }

  function flush() {
    clearTimeout(timer);
    const sync = () => navigator.locks
      ? navigator.locks.request(key, { ifAvailable: true }, (lock) => lock ? run() : false)
      : run();
    if (!inFlight) inFlight = sync().catch((error) => {
      status(error.message);
      return false;
    }).finally(() => {
      inFlight = null;
      if (pending) {
        pending = false;
        queue();
      }
    });
    return inFlight;
  }
  function queue() {
    if (inFlight) {
      pending = true;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }
  return { queue, flush };
}
