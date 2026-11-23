import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, put } from "@vercel/blob";
import {
  clearPrivateSession, googleAvailable, googleFinish, googleStart, keyAccount,
  keySession, newPrivateKey, privateAccount, sameOrigin, sessionKey,
} from "../lib/private-account.js";

const maxPart = 1_500_000;
const maxParts = 16;
const uploadId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const validPart = (part) => Number.isInteger(part) && part >= 0 && part < maxParts;
const root = (account) => "private-workspaces/" + account.id + "/";
const partPath = (path, upload, part) => path + "parts/" + upload + "/" + part + ".txt";

const blobs = {
  async read(path, known) {
    const result = await get(path, {
      access: "private", useCache: false, ...(known ? { ifNoneMatch: known } : {}),
    });
    if (!result) return null;
    if (result.statusCode === 304) return { unchanged: true };
    return { text: await new Response(result.stream).text(), etag: result.blob.etag };
  },
  async has(path) {
    return Boolean(await head(path).catch((error) => {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }));
  },
  async write(path, text, etag) {
    try {
      return await put(path, text, {
        access: "private", contentType: "text/plain", allowOverwrite: !!etag,
        ...(etag ? { ifMatch: etag } : {}),
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || (!etag && await this.has(path)))
        return null;
      throw error;
    }
  },
  async remove(paths) {
    await del(paths);
  },
};

async function discard(store, path, snapshot) {
  if (!snapshot) return;
  try {
    await store.remove(Array.from({ length: snapshot.parts }, (_, part) =>
      partPath(path, snapshot.upload, part)));
  } catch (error) {
    console.error("private-workspace-cleanup", error.name);
  }
}

export function privateWorkspaceHandler(store = blobs) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const send = (status, value) => res.status(status).json(value);
    const action = req.query.action;
    if (req.method === "GET" && action === "google") return googleStart(req, res);
    if (req.method === "GET" && action === "google-callback")
      return googleFinish(req, res, {
        async initialize(id) {
          const path = root({ id }) + "current.json";
          return !await store.has(path) && Boolean(await store.write(path, "{}"));
        },
      });
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(405, { error: "Метод не поддерживается." });
    }
    const post = req.method === "POST";
    if (post && !sameOrigin(req)) return send(403, { error: "Откройте SpecCraft." });
    const input = req.body || {};
    const account = privateAccount(req);
    try {
      if (!post && action === "session") return send(200, { account, google: googleAvailable(req) });
      if (post && action === "logout") {
        if (account && account.id !== req.headers["x-speccraft-workspace"])
          return send(409, { error: "На этом устройстве уже открыто другое пространство." });
        clearPrivateSession(req, res);
        return send(200, {});
      }
      if (post && action === "key-create") {
        if (account) return send(409, { error: "Сначала выйдите из текущего пространства." });
        const key = newPrivateKey();
        const created = keyAccount(key);
        const manifest = await store.write(root(created) + "current.json", "{}");
        if (!manifest) return send(409, { error: "Попробуйте создать пространство ещё раз." });
        keySession(req, res, key);
        return send(201, { account: created, key: "sc1_" + key });
      }
      if (post && action === "key-login") {
        if (account) return send(409, { error: "Сначала выйдите из текущего пространства." });
        const key = typeof input.key === "string" && input.key.startsWith("sc1_")
          ? input.key.slice(4) : "";
        const found = keyAccount(key);
        if (!found || !await store.has(root(found) + "current.json"))
          return send(404, { error: "Пространство с таким ключом не найдено." });
        keySession(req, res, key);
        return send(200, { account: found });
      }
      if (!account || account.id !== req.headers["x-speccraft-workspace"])
        return send(401, { error: "Войдите в личное пространство ещё раз." });
      if (post && action === "show-key" && account.method === "key")
        return send(200, { key: "sc1_" + sessionKey(req) });
      const path = root(account);
      const manifestPath = path + "current.json";
      if (!post && action === "part") {
        const { upload } = req.query;
        const part = Number(req.query.part);
        if (typeof upload !== "string" || !uploadId.test(upload) || !validPart(part))
          return send(400, { error: "Некорректная часть данных." });
        const result = await store.read(partPath(path, upload, part));
        return result ? send(200, { text: result.text }) : send(404, { error: "Данные обновились." });
      }
      if (!post && !action) {
        const known = req.headers["if-none-match"];
        const result = await store.read(manifestPath, typeof known === "string" ? known : undefined);
        if (result?.unchanged) return res.status(304).end();
        const manifest = result ? JSON.parse(result.text) : {};
        return send(200, { current: manifest.current || null, etag: result?.etag || null });
      }
      const { upload, part, parts, text, etag } = input;
      if (!post || typeof upload !== "string" || !uploadId.test(upload))
        return send(400, { error: "Некорректное обновление пространства." });
      if (action === "part") {
        if (!validPart(part) || typeof text !== "string" || !text.length ||
            text.length > maxPart || /[^A-Za-z0-9+/_=-]/.test(text))
          return send(400, { error: "Некорректная часть данных." });
        const target = partPath(path, upload, part);
        if (await store.write(target, text) || (await store.read(target))?.text === text)
          return send(200, {});
        return send(409, { error: "Часть уже была загружена." });
      }
      if (!Number.isInteger(parts) || parts < 1 || parts > maxParts)
        return send(400, { error: "Некорректное количество частей." });
      const record = await store.read(manifestPath);
      const manifest = record ? JSON.parse(record.text) : {};
      if (action === "discard") {
        if (![manifest.current?.upload, manifest.previous?.upload].includes(upload))
          await discard(store, path, { upload, parts });
        return send(200, {});
      }
      if (action !== "commit") return send(400, { error: "Неизвестная команда." });
      if (manifest.current?.upload === upload) return send(200, { etag: record.etag });
      if ((record?.etag || null) !== etag)
        return send(409, { error: "Личное пространство изменилось на другом устройстве." });
      const ready = await Promise.all(Array.from({ length: parts }, (_, index) =>
        store.has(partPath(path, upload, index))));
      if (ready.includes(false)) return send(400, { error: "Загружены не все части." });
      const next = await store.write(manifestPath, JSON.stringify({
        current: { upload, parts }, previous: manifest.current,
      }), etag);
      if (!next) return send(409, { error: "Личное пространство изменилось на другом устройстве." });
      await discard(store, path, manifest.previous);
      return send(200, { etag: next.etag });
    } catch (error) {
      console.error("private-workspace", error?.name);
      return send(503, { error: "Личная синхронизация временно недоступна." });
    }
  };
}

export default privateWorkspaceHandler();
