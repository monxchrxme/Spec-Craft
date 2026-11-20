import { randomUUID } from "node:crypto";

export const requestPattern = /^[a-f0-9-]{36}$/;
export const text = (value, limit) =>
  typeof value === "string" && value.trim() && value.length <= limit;

export function addReply(comments, input, owner) {
  const comment = comments.find((item) => item.id === input.comment);
  if (!comment) return { status: 404, error: "Замечание не найдено." };
  if (
    !text(input.text, 2000) ||
    (!owner && !text(input.author, 80)) ||
    !requestPattern.test(input.requestId || "")
  )
    return { status: 400, error: "Укажите имя и ответ до 2000 символов." };
  const replies = (comment.replies ??= []);
  if (replies.some((reply) => reply.requestId === input.requestId))
    return { unchanged: true };
  if (
    comments.reduce((sum, item) => sum + (item.replies?.length || 0), 0) >= 250
  )
    return {
      status: 409,
      error: "Достигнут лимит ответов для этого обсуждения.",
    };
  replies.push({
    id: randomUUID(),
    requestId: input.requestId,
    author: owner ? "Автор" : input.author.trim(),
    owner,
    text: input.text.trim(),
    date: Date.now(),
  });
  return {};
}
