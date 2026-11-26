import { diffLines } from "./vendor/jsdiff/diff/line.js";
import { approvalStates, makePatch, validPatch } from "./workflow-model.js";
import { specIndex } from "./spec-index.js";
import { documentOption, enhanceDocumentPicker } from "./document-picker.js";
import {
  anchorFrom,
  historyUnits,
  proposalSource,
  resolveAnchor,
  sectionAt,
  selectedTextAnchor,
  showAnchor,
  workflowSections,
} from "./review-anchors.js";
import { participantName, presencePanel, presenceSession } from "./presence.js";

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(text, click, className) {
  const el = node("button", text, className);
  el.type = "button";
  el.onclick = click;
  return el;
}
function field(text, input) {
  const el = node("label", text);
  input.setAttribute("aria-label", text);
  el.append(input);
  return el;
}
const dateLabel = (value) =>
  value ? new Date(value).toLocaleString("ru") : "";

function difference(before, after) {
  const box = node("div", undefined, "workflow-diff");
  if (before === after) {
    box.append(node("p", "Фрагмент совпадает с сохранённой версией."));
    return box;
  }
  const changes = diffLines(before, after, {
    timeout: 90,
    maxEditLength: 3000,
  });
  if (!changes) {
    box.append(
      node("pre", "− " + before.slice(0, 6000), "workflow-removed"),
      node("pre", "+ " + after.slice(0, 6000), "workflow-added"),
    );
    return box;
  }
  let remaining = 10000;
  for (const part of changes) {
    if (!part.added && !part.removed) continue;
    const value = part.value.slice(0, remaining);
    if (!value) break;
    const sign = part.added ? "+ " : "− ";
    box.append(
      node(
        "pre",
        sign + value,
        part.added ? "workflow-added" : "workflow-removed",
      ),
    );
    remaining -= value.length;
  }
  if (remaining <= 0) box.append(node("p", "Показано начало различий."));
  return box;
}

const verdict = {
  open: "Ожидает решения",
  accepted: "Принято",
  rejected: "Отклонено",
};
const historyActions = {
  initial: "Начало истории",
  edit: "Правка",
  proposal: "Принято предложение",
  restore: "Восстановление",
};

function arrowFields(candidate, root, textarea) {
  const options = (entries, value) => {
    const select = node("select");
    for (const [id, label] of entries) select.add(new Option(label, id));
    select.value = value;
    return select;
  };
  const nodes = candidate.nodes.map((item) => [item.id, item.label || item.id]);
  const edge = candidate.connection,
    label = node("input");
  label.value = edge.label || "";
  const fields = [
    ["from", "Начало стрелки", options(nodes, edge.from)],
    ["to", "Конец стрелки", options(nodes, edge.to)],
    ["label", "Подпись стрелки", label],
    [
      "route",
      "Маршрут стрелки",
      options(
        [
          ["orthogonal", "Ломаная"],
          ["straight", "Прямая"],
          ["curve", "Кривая"],
        ],
        edge.route || "orthogonal",
      ),
    ],
  ];
  for (const [key, name, input] of fields) {
    input.oninput = () => {
      let draft;
      try {
        draft = JSON.parse(textarea.value);
      } catch {
        return;
      }
      if (!draft || typeof draft !== "object") return;
      if (draft[key] !== input.value && (key === "from" || key === "to")) {
        delete draft.points;
        delete draft.lockedSegments;
      }
      if (key === "route" && input.value !== "orthogonal")
        delete draft.lockedSegments;
      draft[key] = input.value;
      textarea.value = JSON.stringify(draft, null, 2);
    };
    root.append(field(name, input));
  }
}

export function workflowPanel({
  share,
  panel,
  comments,
  paper,
  viewport,
  parse,
  menuLabel,
  state,
  request,
  mutate,
  commentAt,
  status,
  advanced = false,
}) {
  const tabs = node("div", undefined, "workflow-tabs");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Работа с документом");
  const tools = node("div", undefined, "workflow-tools");
  const hint = node("small", undefined, "workflow-hint");
  const content = node("section", undefined, "workflow-content");
  const proposalForm = node("form", undefined, "workflow-form");
  const proposalList = node("div");
  const proposalPane = node("div");
  proposalPane.append(proposalForm, proposalList);
  const historyPane = node("div");
  const approvalPane = node("div");
  const peoplePane = node("div");
  const panes = {
    comments,
    proposals: proposalPane,
    history: historyPane,
    approval: approvalPane,
    people: peoplePane,
  };
  const buttons = {};
  let view = "comments",
    choosing = false,
    selected = null,
    presence,
    updatePeople;
  let signature,
    historyRevision,
    historySelection,
    historyVersion,
    historyWait = 0;
  let chosenSection, approvalPicker, approvalDraft;
  const place = node("p", undefined, "workflow-place");
  place.hidden = true;
  const more = button(
    "Инструменты согласования",
    () => {
      advanced = !advanced;
      if (!advanced) setChoosing(false);
      setView(advanced ? view : "comments");
    },
    "review-muted-button",
  );
  more.hidden = true;

  const mark = button("Комментировать выделение", () => {
    const next = selectedTextAnchor(paper, sections());
    if (!next) {
      status(
        "Выделите фразу в пределах одного блока. Для таблиц используйте выбор ячейки.",
      );
      return;
    }
    choose(next, true);
  });
  const pick = button("Выбрать ячейку или стрелку", () => {
    setChoosing(!choosing);
  });
  const suggest = button("Предложить правку", () => {
    const next = selectedTextAnchor(paper, sections());
    if (next) choose(next, false);
    setView("proposals");
    prepareProposal();
  });
  for (const control of [mark, pick, suggest])
    control.onpointerdown = (event) => event.preventDefault();
  tools.append(mark, pick, suggest);
  tools.hidden = true;
  comments.before(more, tabs, tools, hint, place);
  panel.append(content);
  for (const [id, label] of Object.entries({
    comments: "Комментарии",
    proposals: "Предложения",
    history: "История",
    approval: "Согласование",
    people: "Участники",
  })) {
    const control = button(label, () => setView(id));
    buttons[id] = control;
    tabs.append(control);
    if (id !== "comments") content.append(panes[id]);
  }
  tabs.hidden = true;
  setView("comments");
  paper.addEventListener("keydown", (event) => {
    if (!choosing) return;
    if (event.key === "Escape") {
      setChoosing(false);
      pick.focus();
    } else if (
      ["Enter", " "].includes(event.key) &&
      targetClick(event.target)
    ) {
      event.preventDefault();
    }
  });

  function parts() {
    return state()?.snapshot ? parse(state().snapshot.body) : [];
  }
  function sections() {
    return workflowSections(parts(), state()?.snapshot?.body || "");
  }
  function setChoosing(value) {
    choosing = value;
    pick.setAttribute("aria-pressed", String(value));
    paper.classList.toggle("workflow-picking", value);
    for (const target of paper.querySelectorAll("td,th,[data-edge]")) {
      if (value && !target.hasAttribute("tabindex")) {
        target.tabIndex = 0;
        target.dataset.workflowFocus = "";
      } else if (!value && target.hasAttribute("data-workflow-focus")) {
        target.removeAttribute("tabindex");
        delete target.dataset.workflowFocus;
      }
    }
    hint.textContent = value
      ? "Щёлкните по ячейке таблицы или линии связи на холсте."
      : "";
  }
  function jumpIndex(index) {
    if (index >= 0 && paper.children[index]) {
      showAnchor(paper, { element: paper.children[index] });
      void presence?.pulse();
    }
  }
  function choose(target, commenting) {
    selected = target;
    place.textContent = target.label;
    place.hidden = false;
    const match = resolveAnchor(paper, parts(), sections(), target.anchor);
    showAnchor(paper, match, false);
    setChoosing(false);
    document.getSelection()?.removeAllRanges();
    if (commenting) {
      setView("comments");
      commentAt(target);
    }
    void presence?.pulse();
  }
  function targetClick(element) {
    if (!choosing || !element.matches("td,th,[data-edge]")) return false;
    const target = anchorFrom(paper, parts(), sections(), element);
    if (!target) return false;
    choose(target, view === "comments");
    if (view === "proposals") prepareProposal();
    return true;
  }

  function setView(value) {
    view = value;
    more.setAttribute("aria-expanded", String(advanced));
    panel.classList.toggle("is-advanced", advanced);
    tabs.hidden = more.hidden || !advanced;
    updateFigureMarkers();
    if (choosing && !["comments", "proposals"].includes(view))
      setChoosing(false);
    for (const [id, control] of Object.entries(buttons)) {
      control.setAttribute("aria-pressed", String(view === id));
      panes[id].hidden = view !== id;
    }
    tools.hidden =
      !state() ||
      state().role === "reader" ||
      !["comments", "proposals"].includes(view);
    mark.hidden = view !== "comments";
    pick.hidden = suggest.hidden = !advanced;
    if (value === "proposals") {
      if (!proposalForm.childElementCount) prepareProposal();
      renderProposals();
    } else if (value === "history") renderHistory();
    else if (value === "approval") renderApproval();
    else if (value === "people" && presence) {
      updatePeople = presencePanel(peoplePane, presence, state().role);
      void presence.pulse();
    }
  }

  function updateFigureMarkers() {
    for (const figure of paper.querySelectorAll("[data-review-target]")) {
      if (advanced) {
        figure.setAttribute("role", "button");
        figure.setAttribute("tabindex", "0");
      } else {
        figure.removeAttribute("role");
        figure.removeAttribute("tabindex");
      }
    }
  }

  function prepareProposal() {
    const data = state();
    if (!data?.snapshot) return;
    const body = data.snapshot.body,
      current = parts(),
      currentSections = workflowSections(current, body);
    const choice = node("select");
    const items = new Map();
    if (selected) {
      const match = resolveAnchor(
        paper,
        current,
        currentSections,
        selected.anchor,
      );
      if (match)
        items.set("anchor", {
          ...selected,
          index: match.index,
          ...(selected.anchor.kind === "cell"
            ? {
                anchor: anchorFrom(
                  paper,
                  current,
                  currentSections,
                  match.element,
                ).anchor,
              }
            : {}),
        });
    }
    current.forEach((part, index) => {
      const type = part.t.type;
      if (
        ![
          "heading_open",
          "paragraph_open",
          "table_open",
          "fence",
          "bullet_list_open",
          "ordered_list_open",
        ].includes(type)
      )
        return;
      if (type === "fence" && part.t.info.trim() === "studio-diagram") return;
      items.set(String(index), {
        index,
        table: type === "table_open",
        label: menuLabel(part.tokens.find((token) => token.type === "inline") ||
          (type === "fence" ? part.t.content.split("\n")[0] || "Код" : part.text)),
      });
    });
    if (!items.size) {
      proposalForm.replaceChildren(
        node("p", "В документе пока нет фрагментов для предложений."),
      );
      return;
    }
    for (const [key, item] of items) {
      const label = typeof item.label === "string" ? menuLabel(item.label) : item.label;
      choice.add(documentOption(label, key, { prefix: item.table ? "Таблица · " : "" }));
    }
    const textarea = node("textarea");
    textarea.rows = 7;
    const label = field("Предлагаемая замена", textarea);
    const visual = node("div", undefined, "workflow-form");
    const advanced = node("details");
    advanced.append(node("summary", "JSON стрелки"));
    const name = node("input");
    name.maxLength = 80;
    name.value = participantName();
    name.required = data.role !== "owner";
    const author = field("Имя для предложения", name);
    author.hidden = data.role === "owner";
    const submit = node("button", "Отправить предложение", "primary");
    const mode = node("small");
    const addRow = button("Предложить новую строку", () => seed(true));
    let candidate,
      adding = false,
      confirmation;
    function seed(row = false) {
      adding = row;
      const target = items.get(choice.value);
      candidate = proposalSource(body, current, target, row);
      addRow.hidden = !(target.table || target.anchor?.kind === "cell");
      mode.textContent = candidate?.type || "";
      textarea.value = candidate?.initial || "";
      textarea.readOnly = !candidate;
      submit.disabled = !candidate;
      confirmation = undefined;
      visual.replaceChildren();
      advanced.hidden = !candidate?.connection;
      if (candidate?.connection) {
        advanced.append(label);
        arrowFields(candidate, visual, textarea);
      } else advanced.before(label);
    }
    choice.onchange = () => seed();
    proposalForm.replaceChildren(
      field("Фрагмент предложения", choice),
      addRow,
      author,
      mode,
      visual,
      label,
      advanced,
      submit,
    );
    enhanceDocumentPicker(choice);
    seed();
    proposalForm.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const patch = candidate.patch(textarea.value);
        if (!validPatch(patch))
          throw Error(
            "Измените фрагмент. Для длинных правок выберите меньший участок.",
          );
        const hash = JSON.stringify(patch);
        if (confirmation?.hash !== hash)
          confirmation = { hash, id: crypto.randomUUID() };
        submit.disabled = true;
        const target = items.get(choice.value);
        if (
          await mutate({
            action: "propose",
            label:
              (adding ? "Новая строка · " : "") + target.label.slice(0, 190),
            revision: data.revision,
            patch,
            author: name.value.trim(),
            requestId: confirmation.id,
          })
        ) {
          status("Предложение отправлено.");
          prepareProposal();
        }
      } catch (error) {
        status(error.message);
      } finally {
        submit.disabled = false;
      }
    };
  }

  function renderProposals() {
    const data = state();
    proposalList.replaceChildren();
    const proposals = data?.proposals || [];
    if (!proposals.length)
      proposalList.append(node("p", "Предложений пока нет.", "review-status"));
    for (const item of [...proposals].reverse()) {
      const article = node("article", undefined, "workflow-entry");
      const details = node("details");
      details.open = item.state === "open";
      const leading = item.patch.prefix.split("\n").at(-1);
      const trailing = item.patch.suffix.split("\n")[0];
      details.append(
        node("summary", item.label),
        node(
          "small",
          [item.author, dateLabel(item.date), verdict[item.state]]
            .filter(Boolean)
            .join(" · "),
        ),
        difference(
          leading + item.patch.before + trailing,
          leading + item.patch.after + trailing,
        ),
      );
      if (item.state === "open" && data.role === "owner") {
        const actions = node("div", undefined, "workflow-actions");
        actions.append(
          button(
            "Принять",
            async () => {
              if (
                await mutate({
                  action: "decide",
                  proposal: item.id,
                  state: "accepted",
                })
              )
                status("Предложение принято. Изменение сохранено.");
            },
            "primary",
          ),
          button("Отклонить", async () => {
            if (
              await mutate({
                action: "decide",
                proposal: item.id,
                state: "rejected",
              })
            )
              status("Предложение отклонено.");
          }),
        );
        details.append(actions);
      }
      article.append(details);
      proposalList.append(article);
    }
  }

  async function loadHistory(value) {
    const seq = ++historyWait;
    historyRevision = Number(value);
    historyVersion = null;
    renderHistory();
    try {
      const { version } = await request(share, undefined, undefined, {
        version: historyRevision,
      });
      if (seq !== historyWait) return;
      historyVersion = version;
      historySelection = null;
      renderHistory();
    } catch (error) {
      if (seq === historyWait) status(error.message);
    }
  }

  function renderHistory() {
    const data = state();
    const history = data?.history || [];
    historyPane.replaceChildren();
    if (!history.length) {
      historyPane.append(node("p", "История этого документа пока пуста."));
      return;
    }
    const picker = node("select");
    picker.add(new Option("Выберите редакцию", ""));
    for (const entry of history)
      picker.add(
        new Option(
          [
            "Редакция " + entry.revision,
            entry.author,
            dateLabel(entry.date),
            historyActions[entry.action],
            entry.label,
          ]
            .filter(Boolean)
            .join(" · "),
          String(entry.revision),
        ),
      );
    picker.value = historyRevision !== undefined ? String(historyRevision) : "";
    picker.onchange = () => {
      if (picker.value === "") {
        historyWait++;
        historyRevision = historyVersion = undefined;
        renderHistory();
      } else void loadHistory(picker.value);
    };
    historyPane.append(field("Редакция общего документа", picker));
    if (!historyVersion) return;
    const oldBody = historyVersion.snapshot.body,
      body = data.snapshot.body;
    const former = historyUnits(parse(oldBody), oldBody),
      latest = historyUnits(parse(body), body);
    const units = node("select");
    units.add(new Option("Весь документ", ""));
    for (const item of former)
      units.add(
        documentOption(menuLabel(item.labelSource || item.label), item.key, {
          prefix: item.type === "diagram" ? "Схема · " : "Раздел · ",
        }),
      );
    units.value = historySelection || "";
    units.onchange = () => {
      historySelection = units.value;
      renderHistory();
    };
    const item = former.find((unit) => unit.key === historySelection);
    const current = item && latest.find((unit) => unit.key === item.key);
    const before = item ? oldBody.slice(item.start, item.end) : oldBody;
    const after = item
      ? current
        ? body.slice(current.start, current.end)
        : ""
      : body;
    historyPane.append(
      field("Часть документа для сравнения", units),
      difference(before, after),
    );
    enhanceDocumentPicker(units);
    if (!item) {
      const meta = (snapshot) =>
        JSON.stringify(
          {
            "Имя файла": snapshot.name,
            Надпись: snapshot.kind,
            Оформление: snapshot.style,
          },
          null,
          2,
        );
      const oldMeta = meta(historyVersion.snapshot),
        newMeta = meta(data.snapshot);
      if (oldMeta !== newMeta) {
        const info = node("details");
        info.append(
          node("summary", "Имя и оформление"),
          difference(oldMeta, newMeta),
        );
        historyPane.append(info);
      }
    }
    if (data.role === "owner" && item && before !== after)
      historyPane.append(
        button(
          current ? "Восстановить часть" : "Восстановить в конце документа",
          async () => {
            const newline = body.includes("\r\n") ? "\r\n" : "\n";
            const restored =
              current && item.type === "section" && current.end < body.length
                ? before.trimEnd() + newline + newline
                : before;
            const patch = current
              ? makePatch(body, current.start, current.end, restored, false)
              : makePatch(
                  body,
                  body.length,
                  body.length,
                  (body.trim() ? newline + newline : "") + before,
                  false,
                );
            if (
              await mutate({
                action: "restore",
                patch,
                source: { start: item.start, end: item.end },
                version: historyVersion.revision,
                revision: data.revision,
                label: item.label.slice(0, 240),
                requestId: crypto.randomUUID(),
              })
            )
              status("Выбранная часть восстановлена. Создана новая редакция.");
          },
          "primary",
        ),
      );
  }

  function renderApproval() {
    const data = state();
    if (!data?.snapshot) return;
    if (approvalDraft && approvalPane.contains(document.activeElement)) return;
    approvalDraft = false;
    const current = parts(),
      units = workflowSections(current, data.snapshot.body);
    const records = new Map(
      (data.sections || []).map((item) => [item.key, item]),
    );
    const approval = (unit) => {
      const saved = records.get(unit.key);
      return saved?.state === "approved" && saved.signature !== unit.signature
        ? "rework"
        : saved?.state || "draft";
    };
    const idx = specIndex(current);
    const missing = idx.requirements.filter((requirement) => {
      const heading = current[requirement.index]?.t.type === "heading_open";
      const section = units.find((unit) => unit.index === requirement.index);
      const criterion =
        requirement.criterion ||
        (heading &&
          section &&
          data.snapshot.body
            .slice(section.start, section.end)
            .match(
              /критерии?й?\s+при[её]мки(?:\*\*)?\s*[:—–-]?\s*(\S[^\n]*)/i,
            )?.[1]);
      return (
        !criterion ||
        /^укажите/i.test(criterion) ||
        !idx.bindings.some((binding) => binding.req === requirement.id)
      );
    });
    const readiness = node("section", undefined, "workflow-entry");
    readiness.append(
      node("h3", "Перед выпуском"),
      node(
        "p",
        "Открытых замечаний: " +
          data.comments.filter((item) => !item.resolved).length,
      ),
      node(
        "p",
        "Ожидают решения: " +
          (data.proposals || []).filter((item) => item.state === "open").length,
      ),
      node(
        "p",
        "Разделов без согласования: " +
          units.filter((unit) => approval(unit) !== "approved").length,
      ),
      node("p", "Требований без критерия или проверки: " + missing.length),
    );
    for (const requirement of missing)
      readiness.append(
        button(requirement.label, () => jumpIndex(requirement.index)),
      );
    approvalPane.replaceChildren(readiness);
    if (!units.length) {
      approvalPane.append(
        node("p", "Добавьте заголовки, чтобы согласовывать разделы."),
      );
      return;
    }
    approvalPicker = node("select");
    for (const unit of units)
      approvalPicker.add(
        documentOption(menuLabel(unit.labelSource || unit.label), unit.key, {
          suffix: " · " + approvalStates[approval(unit)],
        }),
      );
    if (!units.some((unit) => unit.key === chosenSection))
      chosenSection = units[0].key;
    approvalPicker.value = chosenSection;
    approvalPicker.onchange = () => {
      approvalDraft = false;
      chosenSection = approvalPicker.value;
      renderApproval();
    };
    approvalPane.append(field("Раздел для согласования", approvalPicker));
    enhanceDocumentPicker(approvalPicker);
    const unit = units.find((item) => item.key === chosenSection),
      saved = records.get(unit.key);
    approvalPane.append(button("К разделу", () => jumpIndex(unit.index)));
    if (saved?.state === "approved" && saved.signature !== unit.signature)
      approvalPane.append(
        node("small", "После согласования раздел изменился.", "review-status"),
      );
    if (data.role !== "owner") {
      approvalPane.append(
        node("p", approvalStates[approval(unit)]),
        node(
          "p",
          saved?.assignee
            ? "Ответственный · " + saved.assignee
            : "Ответственный пока не указан.",
        ),
      );
      return;
    }
    const form = node("form", undefined, "workflow-form");
    const assignee = node("input");
    assignee.value = saved?.assignee || "";
    assignee.maxLength = 80;
    const assignees = node("datalist");
    assignees.id = "workflow-assignees";
    for (const name of new Set(presence?.names().map((item) => item.name)))
      assignees.append(new Option(name));
    assignee.setAttribute("list", assignees.id);
    const states = node("select");
    for (const [key, value] of Object.entries(approvalStates))
      states.add(new Option(value, key));
    states.value = approval(unit);
    const send = node("button", "Сохранить статус", "primary");
    form.append(
      field("Ответственный", assignee),
      assignees,
      field("Статус раздела", states),
      send,
    );
    form.oninput = () => {
      approvalDraft = true;
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      send.disabled = true;
      approvalDraft = false;
      if (
        await mutate({
          action: "section",
          key: unit.key,
          label: unit.label.slice(0, 240),
          assignee: assignee.value,
          state: states.value,
          signature: unit.signature,
          revision: data.revision,
        })
      )
        status("Статус раздела сохранён.");
      send.disabled = false;
    };
    approvalPane.append(form);
  }

  function location() {
    const box = viewport.getBoundingClientRect();
    const anchor =
      selected && paper.children[selected.index]?.getBoundingClientRect();
    if (anchor && anchor.bottom > box.top && anchor.top < box.bottom)
      return selected.label;
    const start = viewport.getBoundingClientRect().top + 42;
    const blocks = [...paper.children];
    const index = Math.max(
      0,
      blocks.findLastIndex((item) => item.getBoundingClientRect().top <= start),
    );
    return (
      sections().findLast((section) => section.index <= index)?.label ||
      "Просмотр документа"
    );
  }

  return {
    chooseCell(element) {
      return targetClick(element);
    },
    locate(anchor, scroll) {
      return showAnchor(
        paper,
        resolveAnchor(paper, parts(), sections(), anchor),
        scroll,
      );
    },
    clear() {
      showAnchor(paper, null);
    },
    update(data) {
      if (!data || data.role === "reader") return;
      more.hidden = false;
      updateFigureMarkers();
      if (choosing) setChoosing(true);
      buttons.history.hidden = !["editor", "owner"].includes(data.role);
      if (!presence) {
        presence = presenceSession({
          share,
          location,
          update: (people) => {
            buttons.people.textContent =
              "Участники" + (people.length ? " · " + people.length : "");
            if (view === "people") updatePeople?.(people);
          },
        });
        setView(view);
      }
      const next = JSON.stringify([
        data.revision,
        data.comments.map(({ id, resolved }) => [id, resolved]),
        data.proposals,
        data.history,
        data.sections,
      ]);
      if (signature === next) return;
      signature = next;
      if (view === "proposals") renderProposals();
      else if (view === "history") renderHistory();
      else if (view === "approval") renderApproval();
    },
    stop() {
      presence?.stop();
      this.clear();
    },
  };
}
