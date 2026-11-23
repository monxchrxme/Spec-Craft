import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { privateWorkspaceHandler } from "../api/private-workspace.js";
import { googleFinish, privateAccount } from "../lib/private-account.js";
import { mergeWorkspace, workspaceSummary, sameWorkspaceSummary } from "../public/private-workspace-model.js";

function apiFixture() {
  const records = new Map();
  let revision = 0;
  const serve = privateWorkspaceHandler({
    async read(path, known) {
      const row = records.get(path);
      return row?.etag === known && row ? { unchanged: true } : row;
    },
    async has(path) { return records.has(path); },
    async write(path, text, expected) {
      if ((records.get(path)?.etag || null) !== (expected || null)) return null;
      const row = { text, etag: '"' + ++revision + '"' };
      records.set(path, row);
      return row;
    },
    async remove(paths) { for (const path of paths) records.delete(path); },
  });
  return async (action, { body, session, id, query, headers } = {}) => {
    const response = { code: 0, data: null };
    const meta = new Map();
    await serve({
      method: body === undefined ? "GET" : "POST",
      query: { action, ...query }, body,
      headers: {
        host: "speccraft.example", origin: "https://speccraft.example",
        cookie: session, "x-speccraft-workspace": id, ...headers,
      },
    }, {
      status(code) { response.code = code; return this; },
      json(data) { response.data = data; },
      end() {},
      getHeader: (name) => meta.get(name),
      setHeader: (name, value) => meta.set(name, value),
    });
    response.cookie = meta.get("Set-Cookie")?.[0]?.split(";")[0];
    response.location = meta.get("Location");
    return response;
  };
}

test("private workspaces require a matching session and use conditional publication", async () => {
  const request = apiFixture();
  const a = await request("key-create", { body: {} });
  const b = await request("key-create", { body: {} });
  assert.equal(a.code, 201);
  assert.equal(b.code, 201);
  const id = a.data.account.id;
  const session = a.cookie;
  const upload = "b4503db0-cf9a-43c7-bbd8-08bc5b217e83";
  const record = await request("", { id, session });
  assert.equal(record.code, 200);
  assert.equal((await request("", { id })).code, 401);
  assert.equal((await request("", { id, session: b.cookie })).code, 401);
  assert.equal((await request("commit", { id, session, body: {
    upload, parts: 2, etag: record.data.etag,
  } })).code, 400);
  assert.equal((await request("part", { id, session, body: { upload, part: 0, text: "testdata" } })).code, 200);
  const committed = await request("commit", { id, session, body: {
    upload, parts: 1, etag: record.data.etag,
  } });
  assert.equal(committed.code, 200);
  assert.equal((await request("commit", { id, session, body: {
    upload: "b4503db0-cf9a-43c7-bbd8-08bc5b217e84", parts: 1, etag: record.data.etag,
  } })).code, 409);
  assert.equal((await request("", { id, session, headers: { "if-none-match": committed.data.etag } })).code, 304);
  const secondDevice = await request("key-login", { body: { key: a.data.key } });
  assert.equal(secondDevice.code, 200);
  assert.equal((await request("part", {
    id, session: secondDevice.cookie, query: { upload, part: 0 },
  })).data.text, "testdata");
  assert.equal((await request("part", {
    id, session: b.cookie, query: { upload, part: 0 },
  })).code, 401);
  assert.equal((await request("logout", {
    id, session, body: {}, headers: { origin: "https://other.example" },
  })).code, 403);
});

test("Google sign-in uses a state cookie and rejects a callback with different state", async (t) => {
  const env = {
    GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-only-secret",
    GOOGLE_REDIRECT_URI: "https://speccraft.example/api/private-workspace?action=google-callback",
  };
  for (const [name, value] of Object.entries(env)) {
    const original = process.env[name];
    t.after(() => {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    });
    process.env[name] = value;
  }
  const request = apiFixture();
  const start = await request("google");
  assert.equal(start.code, 303);
  const url = new URL(start.location);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "openid email");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(start.cookie.startsWith("sc_google_state=" + url.searchParams.get("state") + "."));
  const rejected = await request("google-callback", {
    session: start.cookie, query: { state: "different", code: "not-used" },
  });
  assert.equal(rejected.location, "/?private-sync=google-failed");
  const signing = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [await exportJWK(signing.publicKey)] });
  const token = await new SignJWT({ nonce: url.searchParams.get("nonce") })
    .setProtectedHeader({ alg: "RS256" })
    .setAudience(env.GOOGLE_CLIENT_ID)
    .setIssuer("https://accounts.google.com")
    .setSubject("synthetic-google-user")
    .setExpirationTime("1m")
    .sign(signing.privateKey);
  const headers = new Map();
  await googleFinish({
    headers: { host: "speccraft.example", cookie: start.cookie },
    query: { state: url.searchParams.get("state"), code: "synthetic-code" },
  }, {
    getHeader: (name) => headers.get(name),
    setHeader: (name, value) => headers.set(name, value),
    status() { return this; },
    end() {},
  }, {
    keys,
    async exchange(endpoint, { body }) {
      assert.equal(endpoint, "https://oauth2.googleapis.com/token");
      const challenge = createHash("sha256").update(body.get("code_verifier")).digest("base64url");
      assert.equal(challenge, url.searchParams.get("code_challenge"));
      return Response.json({ id_token: token });
    },
  });
  assert.equal(headers.get("Location"), "/?private-sync=google");
  const signedSession = headers.get("Set-Cookie").at(-1).split(";")[0];
  const account = privateAccount({ headers: { host: "speccraft.example", cookie: signedSession } });
  assert.equal(account.method, "google");
});

test("workspace merging preserves simultaneous edits and normalizes folder placement", async () => {
  const file = { id: "a", name: "Файл.md", body: "# Начало", folderId: "outer" };
  const inner = { id: "inner", parentId: "", name: "Дочерняя" };
  const outer = { id: "outer", parentId: "", name: "Родительская" };
  const base = { documents: [file], folders: [inner, outer] };
  const theirs = { documents: [{ ...file, body: "# Второе устройство" }], folders: [outer, { ...inner, parentId: "outer" }] };
  const mine = { documents: [{ ...file, body: "# Первое устройство" }], folders: [inner, { ...outer, parentId: "inner" }] };
  const merged = mergeWorkspace(await workspaceSummary(base), mine, theirs,
    await workspaceSummary(mine), await workspaceSummary(theirs));
  assert.equal(merged.conflicts, 1);
  assert.deepEqual(merged.workspace.documents.map(({ body }) => body),
    ["# Второе устройство", "# Первое устройство"]);
  assert.equal(merged.workspace.folders.length, 2);
  assert.ok(merged.workspace.folders.every(({ parentId }) => !parentId));
  assert.ok(sameWorkspaceSummary(await workspaceSummary(base),
    await workspaceSummary({ ...base, documents: [{ ...file, updated: 100 }] })));
});

test("workspace merging propagates deletions without erasing an edit made on another device", async () => {
  const file = { id: "f", name: "Файл.md", body: "Первый текст" };
  const base = { documents: [file], folders: [] };
  const deleted = { documents: [], folders: [] };
  const edited = { documents: [{ ...file, body: "Вторая версия" }], folders: [] };
  const before = await workspaceSummary(base);
  const deletion = await workspaceSummary(deleted);
  assert.deepEqual(mergeWorkspace(before, base, deleted, before, deletion).workspace, deleted);
  assert.deepEqual(mergeWorkspace(before, edited, deleted, await workspaceSummary(edited), deletion).workspace, edited);
});
