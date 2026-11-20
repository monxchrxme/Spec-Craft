import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { collaborationHandler } from "../api/collaboration.js";
import { mergeDocument } from "../public/merge-document.js";
import { addReply } from "../lib/discussion.js";

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
  async function request(input, key = owner, headers = {}) {
    let code, result;
    await handler(
      {
        method: input ? "POST" : "GET",
        query: { id },
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
