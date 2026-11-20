import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { collaborationHandler } from "../api/collaboration.js";
import { mergeDocument } from "../public/merge-document.js";
import { addReply } from "../lib/discussion.js";
import {
  fingerprint,
  makePatch,
  patchOffset,
} from "../public/workflow-model.js";

function memoryStore() {
  const records = new Map();
  return {
    async read(path) {
      return structuredClone(records.get(path) || null);
    },
    async write(path, data, etag) {
      const current = records.get(path);
      if (current?.etag !== etag) return false;
      records.set(path, { data: structuredClone(data), etag: randomUUID() });
      return true;
    },
  };
}

const sample = {
  name: "Спецификация.md",
  body: "# Назначение\n\nПервый раздел\n",
  kind: "ТЗ",
  style: {},
};
function harness() {
  const handler = collaborationHandler(memoryStore());
  const id = "a".repeat(48),
    owner = "b".repeat(48);
  async function request(input, key = owner, headers = {}, query = {}) {
    let code, result;
    await handler(
      {
        method: input ? "POST" : "GET",
        query: { ...query, id },
        headers: {
          host: "spec.test",
          origin: "https://spec.test",
          ...(key === owner
            ? { "x-document-owner": key }
            : { "x-document-invite": key }),
          ...headers,
        },
        body: input,
      },
      {
        setHeader() {},
        status(value) {
          code = value;
          return this;
        },
        json(value) {
          result = structuredClone(value);
          return this;
        },
      },
    );
    return { code, ...result };
  }
  const save = (snapshot, revision) => ({
    action: "save",
    requestId: randomUUID(),
    revision,
    snapshot,
  });
  async function invite(role) {
    const id = randomUUID();
    const created = await request({ action: "invite", role, requestId: id });
    assert.equal(created.code, 200);
    return created.invitations.find((invite) => invite.id === id);
  }
  return { request, invite, save };
}

test("link roles are enforced by the server and owner can revoke one invitation", async () => {
  const { request, invite, save } = harness();
  assert.equal(
    (await request({ action: "publish", snapshot: sample })).code,
    201,
  );
  assert.equal((await request(undefined, "")).code, 404);
  const reader = await invite("reader"),
    commenter = await invite("commenter"),
    editor = await invite("editor");
  const note = {
    action: "comment",
    author: "Коллега",
    target: "document",
    targetLabel: "Весь документ",
    text: "Уточнить назначение",
    requestId: randomUUID(),
  };
  const view = await request(undefined, reader.key);
  assert.equal(view.role, "reader");
  assert.deepEqual(view.snapshot, sample);
  assert.equal(view.invitations, undefined);
  assert.equal(view.comments, undefined);
  assert.equal(view.ownerHash, undefined);
  assert.equal((await request(note, reader.key)).code, 403);
  assert.equal((await request(save(sample, 0), commenter.key)).code, 403);
  assert.equal(
    (
      await request(
        { action: "invite", role: "editor", requestId: randomUUID() },
        editor.key,
      )
    ).code,
    403,
  );
  assert.equal(
    (await request(note, commenter.key, { origin: "https://elsewhere.test" }))
      .code,
    403,
  );

  const { comments } = await request(note, commenter.key);
  const comment = comments[0].id;
  const reply = {
    action: "reply",
    comment,
    text: "Уточнение добавлено",
    requestId: randomUUID(),
  };
  assert.equal((await request(reply, reader.key)).code, 403);
  assert.equal((await request(reply)).comments[0].replies[0].author, "Автор");
  assert.equal((await request(reply)).comments[0].replies.length, 1);
  assert.equal(
    (await request(undefined, commenter.key)).comments[0].replies[0].text,
    reply.text,
  );
  assert.equal(
    (await request({ action: "resolve", comment, resolved: true }, editor.key))
      .code,
    403,
  );
  assert.equal(
    (await request({ action: "resolve", comment, resolved: true })).comments[0]
      .resolved,
    true,
  );

  const update = save({ ...sample, body: "Обновлено" }, 0);
  assert.equal((await request(update, editor.key)).revision, 1);
  assert.equal((await request(update, editor.key)).revision, 1);
  assert.equal(
    (await request({ action: "revoke", invitation: editor.id })).code,
    200,
  );
  assert.equal((await request(update, editor.key)).code, 404);
  assert.equal((await request(undefined, editor.key)).code, 404);
  assert.equal(
    (await request(undefined, reader.key)).snapshot.body,
    "Обновлено",
  );
});

test("simultaneous edits use compare-and-swap and preserve concurrent feedback", async () => {
  const { request, invite, save } = harness();
  await request({ action: "publish", snapshot: sample });
  const editor = await invite("editor");
  const note = {
    action: "comment",
    author: "Коллега",
    target: "document",
    targetLabel: "Весь документ",
    text: "Есть вопрос",
    requestId: randomUUID(),
  };
  const [a, b, feedback] = await Promise.all([
    request(save({ ...sample, body: "Первый вариант" }, 0), editor.key),
    request(save({ ...sample, body: "Второй вариант" }, 0)),
    request(note, editor.key),
  ]);
  const [saved, stale] = [a, b].sort((x, y) => x.code - y.code);
  assert.equal(saved.code, 200);
  assert.equal(stale.code, 409);
  assert.equal(stale.current.snapshot.body, saved.snapshot.body);
  assert.equal(feedback.code, 200);
  assert.equal((await request()).comments.length, 1);
});

test("independent text and style edits merge even within one line", () => {
  const base = { ...sample, body: "начало середина конец\n\nвторая строка\n" };
  const mine = {
    ...base,
    body: "НОВОЕ середина конец\n\nвторая строка\n",
    style: { font: "mono" },
  };
  const theirs = {
    ...base,
    body: "начало середина ФИНАЛ\n\nдругая строка\n",
    kind: "Испытания",
    style: { size: 18 },
  };
  assert.deepEqual(mergeDocument(base, mine, theirs), {
    ...base,
    body: "НОВОЕ середина ФИНАЛ\n\nдругая строка\n",
    kind: "Испытания",
    style: { font: "mono", size: 18 },
  });
  assert.equal(
    mergeDocument(base, mine, {
      ...base,
      body: "ДРУГОЕ середина конец\n\nвторая строка\n",
    }),
    null,
  );
});

test("owner can answer threads from older review records without duplicating a retry", () => {
  const comments = [{ id: randomUUID(), author: "Коллега", text: "Вопрос" }];
  const input = {
    comment: comments[0].id,
    text: "Ответ",
    requestId: randomUUID(),
  };
  assert.deepEqual(addReply(comments, input, true), {});
  assert.equal(comments[0].replies[0].owner, true);
  assert.deepEqual(addReply(comments, input, true), { unchanged: true });
  assert.equal(comments[0].replies.length, 1);
});

test("commentators propose and anchor, owners decide, stale proposals cannot replace divergent text", async () => {
  const { request, invite, save } = harness();
  const body = sample.body + "\n" + "Отдельный параграф. ".repeat(12);
  await request({ action: "publish", snapshot: { ...sample, body } });
  const reader = await invite("reader"),
    commenter = await invite("commenter");
  const start = body.indexOf("Первый");
  const proposal = {
    action: "propose",
    requestId: randomUUID(),
    revision: 0,
    author: "Мария",
    label: "Начальный абзац",
    patch: makePatch(body, start, start + 6, "Критический"),
  };
  assert.equal((await request(proposal, reader.key)).code, 403);
  assert.equal((await request(proposal, commenter.key)).code, 200);
  assert.equal((await request(proposal, commenter.key)).code, 200);
  const records = await request(undefined, undefined, {}, { workflow: "1" });
  assert.equal(records.proposals.length, 1);
  assert.equal(records.snapshot.body, body);
  const anchor = {
    kind: "text",
    quote: "Первый раздел",
    block: 1,
    section: "section-a",
    prefix: "",
    suffix: " ",
    offset: 0,
  };
  const note = await request(
    {
      action: "comment",
      requestId: randomUUID(),
      target: "anchor:test",
      targetLabel: "Начальный абзац",
      author: "Мария",
      anchor,
      text: "Уточнить термин.",
    },
    commenter.key,
  );
  assert.deepEqual(note.comments[0].anchor, anchor);
  const approve = {
    action: "decide",
    proposal: proposal.requestId,
    state: "accepted",
  };
  assert.equal((await request(approve, commenter.key)).code, 403);
  const edited = body + "\nПравка коллеги";
  assert.equal((await request(save({ ...sample, body: edited }, 0))).code, 200);
  const result = await request(approve);
  assert.equal(result.revision, 2);
  assert.equal(result.snapshot.body, edited.replace("Первый", "Критический"));
  assert.equal((await request(approve)).revision, 2);

  const fresh = result.snapshot.body;
  const stale = {
    ...proposal,
    revision: 2,
    requestId: randomUUID(),
    patch: makePatch(fresh, start, start + 11, "Другой"),
  };
  assert.equal((await request(stale, commenter.key)).code, 200);
  assert.equal(
    (
      await request(
        save(
          { ...sample, body: fresh.replace("Критический", "Актуальный") },
          2,
        ),
      )
    ).code,
    200,
  );
  assert.equal(
    (await request({ ...approve, proposal: stale.requestId })).code,
    409,
  );
  assert.equal(
    (
      await request({
        ...approve,
        proposal: stale.requestId,
        state: "rejected",
      })
    ).code,
    200,
  );
});

test("history restores a bounded fragment, tracks attribution, and keeps section approval scoped", async () => {
  const { request, invite, save } = harness();
  const first = "# Первый\n\nРанний текст.\n\n# Второй\n\nСоседний текст.\n";
  const latest = first
    .replace("Ранний текст.", "Новый текст.")
    .replace("Соседний текст.", "Соседняя правка.");
  await request({ action: "publish", snapshot: { ...sample, body: first } });
  const editor = await invite("editor"),
    commenter = await invite("commenter");
  await request(
    { ...save({ ...sample, body: latest }, 0), author: "Денис" },
    editor.key,
  );
  const query = { workflow: "1" };
  const { history } = await request(undefined, editor.key, {}, query);
  assert.equal(history[0].author, "Денис");
  assert.equal("snapshot" in history[0], false);
  assert.equal(
    (await request(undefined, commenter.key, {}, { version: "0" })).code,
    403,
  );
  assert.equal(
    (await request(undefined, editor.key, {}, { version: "0" })).version
      .snapshot.body,
    first,
  );
  const beforeEnd = first.indexOf("# Второй"),
    latestEnd = latest.indexOf("# Второй");
  const approval = {
    action: "section",
    key: "первый",
    label: "Первый",
    state: "approved",
    assignee: "Денис",
    revision: 1,
    signature: fingerprint(latest.slice(0, latestEnd).trimEnd()),
  };
  assert.equal((await request(approval, editor.key)).code, 403);
  assert.equal((await request(approval)).code, 200);
  const restore = {
    action: "restore",
    revision: 1,
    version: 0,
    label: "Первый",
    requestId: randomUUID(),
    source: { start: 0, end: beforeEnd },
    patch: makePatch(latest, 0, latestEnd, first.slice(0, beforeEnd), false),
  };
  assert.equal(
    (
      await request({
        ...restore,
        patch: { ...restore.patch, after: "Произвольный текст" },
      })
    ).code,
    400,
  );
  assert.equal((await request(restore, editor.key)).code, 403);
  assert.equal((await request(restore)).revision, 2);
  const restored = await request(undefined, undefined, {}, query);
  assert.equal(
    restored.snapshot.body,
    first.replace("Соседний текст.", "Соседняя правка."),
  );
  assert.equal(restored.history[0].action, "restore");
  assert.notEqual(
    restored.sections[0].signature,
    fingerprint(first.slice(0, beforeEnd).trimEnd()),
  );
  assert.equal((await request(approval)).code, 409);
});

test("presence exposes roles and locations without exposing credentials and hides revoked links", async () => {
  const { request, invite } = harness();
  await request({ action: "publish", snapshot: sample });
  const reader = await invite("reader"),
    editor = await invite("editor");
  const heartbeat = {
    action: "presence",
    client: randomUUID(),
    name: "Коллега",
    location: "Схема · API",
  };
  assert.equal((await request(heartbeat, reader.key)).code, 403);
  await request(heartbeat, editor.key);
  const ownerPulse = {
    ...heartbeat,
    client: randomUUID(),
    location: "Раздел требований",
  };
  const list = (await request(ownerPulse)).participants;
  assert.deepEqual(
    list.find((item) => item.role === "editor"),
    {
      role: "editor",
      name: "Коллега",
      location: "Схема · API",
      self: false,
    },
  );
  await request({ action: "revoke", invitation: editor.id });
  assert.equal((await request(heartbeat, editor.key)).code, 404);
  assert.deepEqual(
    (await request(ownerPulse)).participants.map((person) => person.role),
    ["owner"],
  );
});

test("ambiguous or deleted source substrings do not rebase onto another occurrence", () => {
  const patch = makePatch("до Слово после", 3, 8, "Замена", false);
  assert.equal(patchOffset("пролог\nдо Слово после", patch), 10);
  assert.equal(patchOffset("до Слово после\nдо Слово после", patch), null);
  assert.equal(patchOffset("раздел со Слово в другом окружении", patch), null);
});
