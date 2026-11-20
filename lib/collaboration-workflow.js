import { requestPattern, text } from "./discussion.js";
import {
  approvalStates,
  makePatch,
  patchedBody,
  validPatch,
  patchOffset,
} from "../public/workflow-model.js";

export const deny = {
  status: 403,
  error: "У этой ссылки нет прав на это действие.",
};
const invalid = (error) => ({ status: 400, error });
const conflict = (error) => ({ status: 409, error });
const size = (value) => Buffer.byteLength(JSON.stringify(value));

export function authorOf(role, value) {
  return role === "owner"
    ? "Автор"
    : text(value, 80)
      ? value.trim()
      : role === "commenter"
        ? "Комментатор"
        : "Редактор";
}

function historyEntry(data, author, action, label) {
  return {
    revision: data.revision,
    date: Date.now(),
    author,
    action,
    label,
    snapshot: data.snapshot,
  };
}

export function advance(data, snapshot, author, action = "edit", label = "") {
  data.history ??= historyOf(data);
  data.snapshot = snapshot;
  data.revision++;
  data.history.push(historyEntry(data, author, action, label));
  let retained = size(data.history);
  while (
    data.history.length > 2 &&
    (data.history.length > 30 || retained > 2_400_000)
  )
    retained -= size(data.history.shift()) + 1;
}

export function historyOf(data) {
  return (
    data.history || [
      {
        revision: data.revision,
        date: data.created || null,
        author: "",
        action: "initial",
        label: "",
        snapshot: data.snapshot,
      },
    ]
  );
}

function polishAnchor(value) {
  if (!value || !["text", "cell", "edge"].includes(value.kind)) return null;
  const string = (key, max) =>
    typeof value[key] === "string" ? value[key].slice(0, max) : "";
  const integer = (key) =>
    Number.isSafeInteger(value[key]) && value[key] >= 0 ? value[key] : -1;
  if (value.kind === "edge") {
    if (!text(value.diagram, 160) || !text(value.edge, 160)) return null;
    return { kind: "edge", diagram: value.diagram, edge: value.edge };
  }
  const common = {
    kind: value.kind,
    section: string("section", 240),
    block: integer("block"),
    quote: string("quote", 700),
  };
  if (value.kind === "cell")
    return {
      ...common,
      row: integer("row"),
      column: integer("column"),
      rowKey: string("rowKey", 140),
      header: string("header", 140),
      tableKey: string("tableKey", 220),
    };
  if (!common.quote) return null;
  return {
    ...common,
    prefix: string("prefix", 72),
    suffix: string("suffix", 72),
    offset: integer("offset"),
  };
}

export function anchorFor(input) {
  return input.anchor ? polishAnchor(input.anchor) : undefined;
}

export function workflowView(data, role) {
  if (role === "reader") return {};
  const canHistory = role === "editor" || role === "owner";
  return {
    proposals: data.proposals || [],
    sections: data.sections || [],
    ...(canHistory
      ? {
          history: historyOf(data)
            .map(({ snapshot, ...entry }) => entry)
            .reverse(),
        }
      : {}),
  };
}

export function workflowAction(data, input, role) {
  if (role === "reader") return deny;
  const owner = role === "owner";
  switch (input.action) {
    case "propose": {
      if (
        !requestPattern.test(input.requestId || "") ||
        !text(input.label, 240) ||
        !validPatch(input.patch) ||
        (!owner && !text(input.author, 80)) ||
        !Number.isSafeInteger(input.revision)
      )
        return invalid("Проверьте имя, формулировку и размер предложения.");
      data.proposals ??= [];
      if (data.proposals.some((item) => item.id === input.requestId))
        return { unchanged: true };
      const offset = patchOffset(
        data.snapshot.body,
        input.patch,
        input.revision === data.revision,
      );
      if (offset === null)
        return conflict(
          "Место предложения изменилось. Обновите документ и выберите его снова.",
        );
      const { before, after } = input.patch;
      const proposal = {
        id: input.requestId,
        patch: makePatch(
          data.snapshot.body,
          offset,
          offset + before.length,
          after,
          false,
        ),
        label: input.label.trim(),
        author: authorOf(role, input.author),
        date: Date.now(),
        revision: data.revision,
        state: "open",
      };
      if (
        data.proposals.length >= 100 ||
        size(data.proposals) + size(proposal) > 550_000
      )
        return conflict("Достигнут лимит предложений для этого документа.");
      data.proposals.push(proposal);
      return {};
    }
    case "decide": {
      if (!owner) return deny;
      const proposal = data.proposals?.find(
        (item) => item.id === input.proposal,
      );
      if (!proposal || !["accepted", "rejected"].includes(input.state))
        return invalid("Выберите предложение и решение.");
      if (proposal.state === input.state) return { unchanged: true };
      if (proposal.state !== "open")
        return conflict("Решение по предложению уже принято.");
      if (input.state === "accepted") {
        const body = patchedBody(
          data.snapshot.body,
          proposal.patch,
          proposal.revision === data.revision,
        );
        if (body === null)
          return conflict(
            "Этот фрагмент уже изменён. Попросите автора предложения открыть актуальный текст.",
          );
        if (Buffer.byteLength(body) > 750_000)
          return invalid("Размер общего Markdown ограничен 750 КБ.");
        advance(
          data,
          { ...data.snapshot, body },
          "Автор",
          "proposal",
          proposal.label,
        );
      }
      proposal.state = input.state;
      proposal.decided = Date.now();
      return {};
    }
    case "restore": {
      if (!owner) return deny;
      const version = historyOf(data).find(
        (item) => item.revision === input.version,
      );
      const from = input.source?.start,
        to = input.source?.end;
      if (
        !validPatch(input.patch, 750_000) ||
        !text(input.label, 240) ||
        !version ||
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < 0 ||
        to <= from ||
        to > version.snapshot.body.length ||
        !requestPattern.test(input.requestId || "") ||
        !Number.isSafeInteger(input.revision)
      )
        return invalid("Выберите часть документа в сохранённой версии.");
      if (
        version.snapshot.body.slice(from, to).trim() !==
        input.patch.after.trim()
      )
        return invalid("Фрагмент не совпадает с сохранённой версией.");
      if (data.writes.includes(input.requestId)) return { unchanged: true };
      const body = patchedBody(
        data.snapshot.body,
        input.patch,
        input.revision === data.revision,
      );
      if (body === null)
        return conflict(
          "Эта часть уже изменилась. Обновите сравнение перед восстановлением.",
        );
      if (Buffer.byteLength(body) > 750_000)
        return invalid("Размер общего Markdown ограничен 750 КБ.");
      advance(
        data,
        { ...data.snapshot, body },
        "Автор",
        "restore",
        input.label.trim(),
      );
      data.writes = [...data.writes.slice(-39), input.requestId];
      return {};
    }
    case "section": {
      if (!owner) return deny;
      if (
        !text(input.key, 240) ||
        !text(input.label, 240) ||
        !Object.hasOwn(approvalStates, input.state) ||
        typeof input.assignee !== "string" ||
        input.assignee.length > 80 ||
        !/^[a-f0-9]{8}\.[0-9]+$/.test(input.signature || "") ||
        !Number.isSafeInteger(input.revision)
      )
        return invalid("Укажите раздел и статус согласования.");
      if (input.revision !== data.revision)
        return conflict("Раздел изменился. Обновите документ.");
      data.sections ??= [];
      const previous = data.sections.findIndex(
        (item) => item.key === input.key,
      );
      if (previous < 0 && data.sections.length >= 180)
        return conflict("Достигнут лимит разделов.");
      const section = {
        key: input.key,
        label: input.label,
        assignee: input.assignee.trim(),
        state: input.state,
        signature: input.signature,
        date: Date.now(),
      };
      if (previous < 0) data.sections.push(section);
      else Object.assign(data.sections[previous], section);
      return {};
    }
    default:
      return invalid("Неизвестное действие.");
  }
}

export async function presenceFor(store, path, document, actor, role, input) {
  if (role === "reader") return deny;
  if (
    !requestPattern.test(input.client || "") ||
    typeof input.name !== "string" ||
    input.name.length > 80 ||
    typeof input.location !== "string" ||
    input.location.length > 160
  )
    return invalid("Проверьте имя участника.");
  const now = Date.now();
  const available = new Set([
    document.ownerHash,
    ...document.invitations.map((item) => item.hash),
  ]);
  const id = actor + ":" + input.client;
  const active = (entries) =>
    entries.filter((item) => item.expires > now && available.has(item.actor));
  for (let attempt = 0; attempt < 5; attempt++) {
    const record = await store.read(path, true);
    const entries = active(record?.data.entries || []);
    const own = entries.find((item) => item.id === id);
    const updated = {
      id,
      actor,
      role,
      client: input.client,
      name: authorOf(role, input.name),
      location: input.location.trim(),
      expires: now + 45_000,
    };
    if (own) Object.assign(own, updated);
    else {
      if (entries.length >= 40)
        entries.sort((a, b) => a.expires - b.expires).shift();
      entries.push(updated);
    }
    if (await store.write(path, { entries }, record?.etag))
      return { participants: publicEntries(entries, id) };
  }
  return conflict("Список участников изменился. Повторите запрос.");
}
function publicEntries(entries, id) {
  return entries.map(({ id: entry, role, name, location }) => ({
    role,
    name,
    location,
    self: entry === id,
  }));
}
