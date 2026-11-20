import {
  get,
  head,
  put,
  BlobPreconditionFailedError,
  BlobNotFoundError,
} from "@vercel/blob";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { addReply, requestPattern, text } from "../lib/discussion.js";

const secret = /^[a-f0-9]{48}$/;
const roles = new Set(["reader", "commenter", "editor"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const inviteKey = (owner, id) =>
  createHmac("sha256", owner)
    .update("speccraft-invite:" + id)
    .digest("hex")
    .slice(0, 48);

const blobStore = {
  async read(path, writable) {
    const meta = writable
      ? await head(path).catch((error) => {
          if (error instanceof BlobNotFoundError) return null;
          throw error;
        })
      : null;
    if (writable && !meta) return null;
    const result = await get(path, { access: "private", useCache: false });
    if (result?.statusCode !== 200) return null;
    return { data: await new Response(result.stream).json(), etag: meta?.etag };
  },
  async write(path, data, etag) {
    try {
      await put(path, JSON.stringify(data), {
        access: "private",
        contentType: "application/json",
        ...(etag === undefined ? {} : { ifMatch: etag }),
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      if (etag === undefined && (await this.read(path, false))) return false;
      throw error;
    }
  },
};

function snapshot(input) {
  if (
    !text(input?.name, 300) ||
    typeof input.body !== "string" ||
    Buffer.byteLength(input.body) > 750_000 ||
    typeof input.kind !== "string" ||
    input.kind.length > 150
  )
    return null;
  const keys = [
    "font",
    "size",
    "leading",
    "gap",
    "lineLength",
    "align",
    "accent",
    "tabSize",
    "wrap",
    "spellcheck",
  ];
  const style = Object.fromEntries(
    keys.flatMap((key) => {
      const value = input.style?.[key];
      return typeof value === "string"
        ? [[key, value.slice(0, 40)]]
        : Number.isFinite(value) || typeof value === "boolean"
          ? [[key, value]]
          : [];
    }),
  );
  return { name: input.name, body: input.body, kind: input.kind, style };
}

function permission(data, owner, key) {
  if (secret.test(owner || "") && hash(owner) === data.ownerHash)
    return "owner";
  if (!secret.test(key || "")) return null;
  const hashed = hash(key);
  return (
    data.invitations.find((invite) => invite.hash === hashed)?.role || null
  );
}

function view(data, role, owner, knownRevision) {
  return {
    role,
    revision: data.revision,
    ...(knownRevision === data.revision ? {} : { snapshot: data.snapshot }),
    ...(role === "reader" ? {} : { comments: data.comments }),
    ...(role === "owner"
      ? {
          invitations: data.invitations.map(({ id, role, date }) => ({
            id,
            role,
            date,
            key: inviteKey(owner, id),
          })),
        }
      : {}),
  };
}

function mutate(data, input, role, owner) {
  const admin = role === "owner";
  const deny = {
    status: 403,
    error: "У этой ссылки нет прав на это действие.",
  };
  switch (input.action) {
    case "save": {
      if (!admin && role !== "editor") return deny;
      if (
        !requestPattern.test(input.requestId || "") ||
        !Number.isSafeInteger(input.revision)
      )
        return { status: 400, error: "Проверьте параметры сохранения." };
      if (data.writes.includes(input.requestId))
        return { unchanged: true, accepted: true };
      if (input.revision !== data.revision)
        return {
          status: 409,
          error: "Коллега изменил документ.",
          current: true,
        };
      const next = snapshot(input.snapshot);
      if (!next)
        return {
          status: 400,
          error: "Проверьте параметры файла. Размер Markdown ограничен 750 КБ.",
        };
      if (JSON.stringify(next) === JSON.stringify(data.snapshot))
        return { unchanged: true, accepted: true };
      data.snapshot = next;
      data.revision++;
      data.writes = [...data.writes.slice(-39), input.requestId];
      return { accepted: true };
    }
    case "invite": {
      if (!admin) return deny;
      if (!roles.has(input.role) || !requestPattern.test(input.requestId || ""))
        return { status: 400, error: "Выберите роль для ссылки." };
      if (data.invitations.some((item) => item.id === input.requestId))
        return { unchanged: true };
      if (data.invitations.length >= 40)
        return { status: 409, error: "Достигнут лимит в 40 активных ссылок." };
      const id = input.requestId;
      data.invitations.push({
        id,
        role: input.role,
        hash: hash(inviteKey(owner, id)),
        date: Date.now(),
      });
      return {};
    }
    case "revoke":
      if (!admin) return deny;
      data.invitations = data.invitations.filter(
        (item) => item.id !== input.invitation,
      );
      return {};
    case "comment":
      if (role === "reader") return deny;
      if (
        !text(input.target, 500) ||
        !text(input.targetLabel, 450) ||
        (!admin && !text(input.author, 80)) ||
        !text(input.text, 2000) ||
        !requestPattern.test(input.requestId || "")
      )
        return {
          status: 400,
          error: "Укажите имя и напишите замечание до 2000 символов.",
        };
      if (data.comments.some((item) => item.requestId === input.requestId))
        return { unchanged: true };
      if (data.comments.length >= 250)
        return { status: 409, error: "Достигнут лимит в 250 замечаний." };
      data.comments.push({
        id: randomUUID(),
        requestId: input.requestId,
        target: input.target,
        targetLabel: input.targetLabel.trim(),
        author: admin ? "Автор" : input.author.trim(),
        owner: admin,
        text: input.text.trim(),
        date: Date.now(),
        resolved: false,
      });
      return {};
    case "reply":
      return role === "reader" ? deny : addReply(data.comments, input, admin);
    case "resolve": {
      if (!admin) return deny;
      const item = data.comments.find(
        (comment) => comment.id === input.comment,
      );
      if (!item || typeof input.resolved !== "boolean")
        return { status: 400, error: "Замечание не найдено." };
      if (item.resolved === input.resolved) return { unchanged: true };
      item.resolved = input.resolved;
      return {};
    }
    default:
      return { status: 400, error: "Неизвестное действие." };
  }
}

export function collaborationHandler(store = blobStore) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const send = (status, data) => res.status(status).json(data);
    const denied = () =>
      send(404, { error: "Документ недоступен. Возможно, ссылка отозвана." });
    const id = req.query.id;
    const owner =
      typeof req.headers["x-document-owner"] === "string"
        ? req.headers["x-document-owner"]
        : "";
    const key =
      typeof req.headers["x-document-invite"] === "string"
        ? req.headers["x-document-invite"]
        : "";
    const post = req.method === "POST";
    if (typeof id !== "string" || !secret.test(id)) return denied();
    if (req.method !== "GET" && !post) {
      res.setHeader("Allow", "GET, POST");
      return send(405, { error: "Метод не поддерживается." });
    }
    if (
      post &&
      req.headers.origin !== "https://" + req.headers.host &&
      !(
        process.env.VERCEL_ENV !== "production" &&
        req.headers.origin === "http://" + req.headers.host
      )
    )
      return send(403, { error: "Откройте документ в SpecCraft." });
    const path = "documents/" + id + ".json";
    const input = req.body || {};
    try {
      if (post && input.action === "publish") {
        const initial = snapshot(input.snapshot);
        if (!secret.test(owner) || !initial)
          return send(400, {
            error:
              "Проверьте параметры файла. Размер Markdown ограничен 750 КБ.",
          });
        const original = await store.read(path, false);
        if (original)
          return permission(original.data, owner) === "owner"
            ? send(200, view(original.data, "owner", owner))
            : denied();
        const data = {
          ownerHash: hash(owner),
          snapshot: initial,
          revision: 0,
          invitations: [],
          comments: [],
          writes: [],
        };
        if (await store.write(path, data))
          return send(201, view(data, "owner", owner));
        const written = await store.read(path, false);
        return written && permission(written.data, owner) === "owner"
          ? send(200, view(written.data, "owner", owner))
          : denied();
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const record = await store.read(path, post);
        if (!record) return denied();
        const { data, etag } = record;
        const role = permission(data, owner, key);
        if (!role) return denied();
        if (!post) {
          const known = /^[0-9]+$/.test(req.query.revision || "")
            ? Number(req.query.revision)
            : undefined;
          return send(200, view(data, role, owner, known));
        }
        const result = mutate(data, input, role, owner);
        if (result.error)
          return send(result.status, {
            error: result.error,
            ...(result.current ? { current: view(data, role, owner) } : {}),
          });
        if (result.unchanged || (await store.write(path, data, etag)))
          return send(200, {
            ...view(data, role, owner),
            ...(result.accepted ? { accepted: true } : {}),
          });
      }
      return send(409, { error: "Документ изменился. Повторите действие." });
    } catch (error) {
      console.error("collaboration-storage", error?.name);
      return send(503, {
        error: "Хранилище общих документов временно недоступно.",
      });
    }
  };
}

export default collaborationHandler();
