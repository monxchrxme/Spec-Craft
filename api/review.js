import {
  get,
  head,
  put,
  BlobPreconditionFailedError,
  BlobNotFoundError,
} from "@vercel/blob";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";

const secretPattern = /^[a-f0-9]{48}$/;
const commentPattern = /^[a-f0-9-]{36}$/;
const blobOptions = { access: "private", contentType: "application/json" };
const hash = (key) => createHash("sha256").update(key).digest("hex");
const text = (value, limit) =>
  typeof value === "string" && value.trim() && value.length <= limit;

async function read(path) {
  const result = await get(path, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return {
    data: await new Response(result.stream).json(),
  };
}

function isOwner(data, key) {
  return (
    secretPattern.test(key || "") &&
    timingSafeEqual(
      Buffer.from(hash(key), "hex"),
      Buffer.from(data.ownerHash, "hex"),
    )
  );
}

function view(data) {
  const { ownerHash, ...review } = data;
  return review;
}

function publication(input) {
  const { snapshot, anchors } = input;
  if (
    !text(snapshot?.title, 300) ||
    !text(snapshot?.name, 300) ||
    typeof snapshot.body !== "string" ||
    Buffer.byteLength(snapshot.body) > 750_000 ||
    !Array.isArray(anchors) ||
    anchors.length > 2500 ||
    anchors.some((key) => !text(key, 500)) ||
    new Set(anchors).size !== anchors.length
  )
    return null;
  const allowed = [
    "font",
    "size",
    "leading",
    "gap",
    "lineLength",
    "align",
    "accent",
  ];
  const style = Object.fromEntries(
    allowed
      .filter((key) =>
        ["string", "number"].includes(typeof snapshot.style?.[key]),
      )
      .map((key) => [
        key,
        typeof snapshot.style[key] === "string"
          ? snapshot.style[key].slice(0, 40)
          : snapshot.style[key],
      ]),
  );
  return {
    snapshot: {
      title: snapshot.title,
      name: snapshot.name,
      body: snapshot.body,
      style,
    },
    anchors,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const id = req.query.id,
    ownerKey = req.headers["x-review-owner"];
  const reply = (status, data) => res.status(status).json(data);
  const error = (status, message) => reply(status, { error: message });
  if (typeof id !== "string" || !secretPattern.test(id))
    return error(404, "Версия недоступна.");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return error(405, "Метод не поддерживается.");
  }
  if (
    req.method === "POST" &&
    req.headers.origin !== "https://" + req.headers.host &&
    !(
      process.env.VERCEL_ENV !== "production" &&
      req.headers.origin === "http://" + req.headers.host
    )
  )
    return error(403, "Откройте версию в SpecCraft.");
  const input = req.body || {};
  const path = "reviews/" + id + ".json";
  try {
    if (req.method === "POST" && input.action === "publish") {
      const content = publication(input);
      if (!secretPattern.test(ownerKey || "") || !content)
        return error(400, "Проверьте название и размер версии.");
      const exists = await read(path);
      if (exists)
        return isOwner(exists.data, ownerKey)
          ? reply(200, view(exists.data))
          : error(404, "Версия недоступна.");
      const data = {
        ...content,
        ownerHash: hash(ownerKey),
        closed: false,
        comments: [],
      };
      try {
        await put(path, JSON.stringify(data), blobOptions);
      } catch (cause) {
        // A retry can arrive before the first upload responds. Never overwrite a snapshot.
        const stored = await read(path);
        if (stored && isOwner(stored.data, ownerKey))
          return reply(200, view(stored.data));
        throw cause;
      }
      return reply(201, view(data));
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      // The metadata API returns the write ETag. The download may have a
      // different validator after compression. Read metadata before the body
      // so a concurrent write can only cause a conflict, never lost changes.
      const metadata =
        req.method === "POST"
          ? await head(path).catch((error) => {
              if (error instanceof BlobNotFoundError) return null;
              throw error;
            })
          : null;
      if (req.method === "POST" && !metadata)
        return error(404, "Версия недоступна.");
      const record = await read(path);
      const data = record?.data;
      if (!data) return error(404, "Версия недоступна.");
      const owner = isOwner(data, ownerKey);
      if (data.closed && !owner) return error(404, "Доступ к версии закрыт.");
      if (req.method === "GET") return reply(200, view(data));

      if (input.action === "comment") {
        if (data.closed) return error(409, "Доступ к версии закрыт.");
        if (
          !data.anchors.includes(input.target) ||
          !text(input.author, 80) ||
          !text(input.text, 2000) ||
          !commentPattern.test(input.requestId || "")
        )
          return error(
            400,
            "Укажите имя и напишите замечание до 2000 символов.",
          );
        if (data.comments.some((item) => item.requestId === input.requestId))
          return reply(200, view(data));
        if (data.comments.length >= 250)
          return error(409, "В этой версии уже 250 замечаний.");
        data.comments.push({
          id: randomUUID(),
          requestId: input.requestId,
          target: input.target,
          author: input.author.trim(),
          text: input.text.trim(),
          date: Date.now(),
          resolved: false,
        });
      } else if (input.action === "resolve" && owner) {
        const comment = data.comments.find((item) => item.id === input.comment);
        if (!comment || typeof input.resolved !== "boolean")
          return error(400, "Замечание не найдено.");
        comment.resolved = input.resolved;
      } else if (input.action === "close" && owner) data.closed = true;
      else return error(403, "Это действие доступно автору версии.");
      try {
        await put(path, JSON.stringify(data), {
          ...blobOptions,
          ifMatch: metadata.etag,
        });
        return reply(200, view(data));
      } catch (cause) {
        if (!(cause instanceof BlobPreconditionFailedError)) throw cause;
      }
    }
    return error(409, "Замечания изменились. Повторите действие.");
  } catch (cause) {
    console.error("review-storage", cause?.name);
    return error(503, "Хранилище согласований временно недоступно.");
  }
}
