import { mergeDocument, sameSnapshot, snapshotOf } from "./merge-document.js";

export const roleLabels = {
  owner: "Автор",
  reader: "Читатель",
  commenter: "Комментатор",
  editor: "Редактор",
};

export function collaborationUrl(id, key) {
  const url = new URL(location.pathname, location.origin);
  url.hash = "document=" + id + "." + key;
  return url.href;
}

export async function collaborationRequest(
  share,
  input,
  revision,
  options = {},
) {
  const headers = {};
  if (share.owner) headers["X-Document-Owner"] = share.owner;
  if (share.key) headers["X-Document-Invite"] = share.key;
  if (input) headers["Content-Type"] = "application/json";
  const url =
    "/api/collaboration?id=" +
    encodeURIComponent(share.id) +
    (Number.isSafeInteger(revision) ? "&revision=" + revision : "") +
    (options.workflow ? "&workflow=1" : "") +
    (Number.isSafeInteger(options.version)
      ? "&version=" + options.version
      : "");
  let response;
  try {
    response = await fetch(url, {
      method: input ? "POST" : "GET",
      headers,
      body: input ? JSON.stringify(input) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout?.(12_000),
    });
  } catch {
    throw Error("Нет связи с общим документом. Проверьте сеть.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.role) {
    const error = Error(data?.error || "Общий документ временно недоступен.");
    error.status = response.status;
    error.current = data?.current;
    throw error;
  }
  return data;
}

export function liveSession({
  share,
  initial,
  get,
  apply,
  canApply,
  status,
  author,
}) {
  const storageKey = "speccraft:draft:" + share.id;
  let base = {
      revision: initial.revision,
      snapshot: snapshotOf(initial.snapshot),
    },
    remote,
    conflict,
    timer,
    stopped = false,
    inFlight = null,
    lastWrite,
    queued = false,
    revoked = false;
  const draft = recoverDraft();
  if (draft) {
    base = draft.base;
    apply(draft.mine);
    if (initial.revision !== base.revision) remote = initial;
  }

  function recoverDraft() {
    try {
      const record = JSON.parse(sessionStorage.getItem(storageKey));
      if (
        Number.isSafeInteger(record?.base?.revision) &&
        [record.base.snapshot, record.mine].every(
          (item) =>
            typeof item?.body === "string" && typeof item.name === "string",
        )
      )
        return record;
    } catch {
      // A disabled or damaged browser store leaves the cloud document available.
    }
    return null;
  }

  function remember() {
    try {
      const mine = get();
      if (sameSnapshot(mine, base.snapshot))
        sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify({ mine, base }));
    } catch {
      // The current draft can still be downloaded from the editor.
    }
  }

  function update(next) {
    base = { revision: next.revision, snapshot: snapshotOf(next.snapshot) };
    remote = conflict = null;
  }

  async function run(poll, remaining = 4) {
    if (stopped) return;
    const mine = get();
    if (remote) {
      if (!canApply())
        return status("Есть правки коллеги · завершите ввод, чтобы объединить");
      const merged = mergeDocument(
        base.snapshot,
        mine,
        snapshotOf(remote.snapshot),
      );
      if (!merged) {
        conflict = remote;
        remember();
        return status(
          "Правки пересекаются · выберите, какую версию сохранить",
          true,
        );
      }
      update(remote);
      if (!sameSnapshot(mine, merged)) apply(merged);
      remember();
    }
    const current = get();
    if (!sameSnapshot(current, base.snapshot)) {
      status("Сохранение общего документа…");
      const signature = JSON.stringify([base.revision, current]);
      if (lastWrite?.signature !== signature)
        lastWrite = { signature, id: crypto.randomUUID() };
      try {
        const next = await collaborationRequest(share, {
          action: "save",
          revision: base.revision,
          snapshot: current,
          requestId: lastWrite.id,
          author: author?.(),
        });
        if (stopped) return;
        if (sameSnapshot(next.snapshot, current)) update(next);
        else {
          // A retry may find a previous save followed by another editor's save.
          base = { revision: base.revision + 1, snapshot: current };
          remote = next;
        }
        remember();
        lastWrite = null;
        status(
          remote
            ? "Есть правки коллеги"
            : sameSnapshot(get(), base.snapshot)
              ? "Сохранено в общем документе"
              : "Есть несохранённые правки",
        );
      } catch (error) {
        if (error.current && remaining) {
          remote = error.current;
          return run(false, remaining - 1);
        }
        throw error;
      }
      return;
    }
    if (poll) {
      const next = await collaborationRequest(share, undefined, base.revision);
      if (stopped) return;
      if (next.snapshot && next.revision !== base.revision) {
        remote = next;
        return run(false);
      }
    }
    status("Сохранено в общем документе");
  }

  function sync(poll = false) {
    clearTimeout(timer);
    if (stopped || revoked) return Promise.resolve(false);
    if (inFlight) return inFlight;
    inFlight = run(poll)
      .then(() => !remote && sameSnapshot(get(), base.snapshot))
      .catch((error) => {
        revoked = error.status === 404;
        remember();
        status(
          error.status === 404
            ? "Доступ отозван · скачайте свои правки"
            : error.message + " Черновик остаётся в этой вкладке.",
        );
        return false;
      })
      .finally(() => {
        inFlight = null;
        if (queued && !stopped && !revoked && !conflict) {
          queued = false;
          schedule();
        }
      });
    return inFlight;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!conflict) void sync();
    }, 350);
  }
  const heartbeat = setInterval(() => {
    if (!document.hidden && !conflict) void sync(true);
  }, 4000);

  return {
    queue() {
      remember();
      if (inFlight) queued = true;
      else if (!revoked && !stopped) schedule();
    },
    async flush() {
      if (inFlight) await inFlight;
      return sync();
    },
    conflict() {
      return conflict?.snapshot;
    },
    resolve(useMine) {
      if (!conflict) return;
      const chosen = conflict;
      update(chosen);
      if (!useMine) apply(chosen.snapshot);
      remember();
      void sync();
    },
    stop() {
      remember();
      stopped = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
    },
  };
}
