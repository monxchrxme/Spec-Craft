import { documentTypes, templateBody } from "./espd.js";
import { examples } from "./documents.js";

const prefix = "buro:template:";
const fileFormat = "speccraft-template";
const fields = /\{\{\s*([\p{L}\p{N}][\p{L}\p{N} _.-]{0,59}?)\s*\}\}/gu;

function outline(title, sections) {
  return (
    [
      "# " + title,
      ...sections.map(([name, text]) => "## " + name + "\n\n" + text),
    ].join("\n\n") + "\n"
  );
}

export const builtinTemplates = {
  ...examples,
  ...Object.fromEntries(
    Object.entries(documentTypes).map(([type, [label]]) => [
      "espd-" + type,
      { label, body: templateBody(type), espd: type },
    ]),
  ),
  spec: {
    ...examples.spec,
    body: outline("Техническое задание", [
      ["Назначение", "Опишите цель системы."],
      [
        "Функциональные требования",
        "| ID | Требование | Критерий приёмки |\n| --- | --- | --- |\n| FR-01 |  |  |",
      ],
      ["Критерии приёмки", "Укажите условия приёмки."],
    ]),
  },
  product: {
    label: "Спецификация продукта",
    body: outline("{{Продукт}}", [
      ["Пользователи и задачи", "Опишите группы пользователей и их задачи."],
      ["Границы версии", "Перечислите сценарии текущей версии."],
      [
        "Сценарии и критерии",
        "| ID | Сценарий | Критерий приёмки |\n| --- | --- | --- |\n| FR-01 |  |  |",
      ],
      ["Метрики и допущения", "Укажите метрики успеха и допущения."],
    ]),
  },
  api: {
    label: "Контракт API",
    body: outline("API — {{Название API}}", [
      ["Обзор", "Базовый адрес, версия и правила аутентификации."],
      [
        "Операции",
        "| Метод | Путь | Назначение |\n| --- | --- | --- |\n| GET | / |  |",
      ],
      ["Запрос и ответ", "Укажите параметры, схемы и примеры."],
      [
        "Ошибки",
        "| Код | Условие | Ответ |\n| --- | --- | --- |\n| 400 |  |  |",
      ],
    ]),
  },
  tests: {
    label: "План испытаний",
    body: outline("План испытаний — {{Система}}", [
      ["Цель и состав", "Укажите проверяемую версию и область испытаний."],
      ["Среда и исходные данные", "Укажите конфигурацию и предусловия."],
      [
        "TC-01 · Основной сценарий",
        "1. Подготовить исходные данные.\n2. Выполнить сценарий.\n\n**Ожидаемый результат**",
      ],
      [
        "Протокол",
        "| Проверка | Результат | Замечания |\n| --- | --- | --- |\n| TC-01 |  |  |",
      ],
    ]),
  },
  adr: {
    label: "Архитектурное решение",
    body: outline("ADR — {{Решение}}", [
      ["Контекст", "Какая проблема требует решения."],
      [
        "Варианты",
        "| Вариант | Плюсы | Ограничения |\n| --- | --- | --- |\n|  |  |  |",
      ],
      ["Решение", "Опишите выбранный вариант и основания."],
      ["Последствия", "Запишите риски и план внедрения."],
    ]),
  },
  formal: {
    label: "Формальный документ с титулом",
    body: "# {{Название документа}}\n\n**Организация** {{Организация}}\n\n**Обозначение** {{Обозначение}}\n\n**Редакция** {{Редакция}}\n\n## Основание и нормативные документы\n\n{{Стандарт}}\n\n## Область применения\n\n## Требования\n\n## Порядок проверки и приёмки\n\n## Приложения\n",
  },
};

export function templateFields(body) {
  return [...new Set(Array.from(body.matchAll(fields), (match) => match[1]))];
}
export function applyTemplate(body, values, diagrams) {
  const fill = (text, escape = (value) => value) =>
    text.replace(fields, (placeholder, name) => {
      const value = values.get(name);
      return value ? escape(value) : placeholder;
    });
  let result = "",
    offset = 0;
  for (const { start, end } of diagrams) {
    result += fill(body.slice(offset, start));
    result += fill(body.slice(start, end), (value) =>
      JSON.stringify(value).slice(1, -1),
    );
    offset = end;
  }
  return result + fill(body.slice(offset));
}

function valid(template) {
  return (
    template &&
    typeof template.label === "string" &&
    template.label.trim() &&
    typeof template.body === "string" &&
    template.body.trim()
  );
}

export function readTemplates() {
  const result = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const template = JSON.parse(localStorage.getItem(key));
        if (valid(template))
          result.push({ ...template, id: key.slice(prefix.length) });
      } catch {
        /* An invalid entry leaves the rest of the library available. */
      }
    }
  } catch {
    /* Built-in templates are available without local storage. */
  }
  return result.sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

export function saveTemplate(template) {
  if (!valid(template)) throw Error("Укажите название и заполните Markdown.");
  const id = template.id || crypto.randomUUID();
  const record = { id, label: template.label.trim(), body: template.body };
  localStorage.setItem(prefix + id, JSON.stringify(record));
  return record;
}

export function restoreTemplates(items) {
  if (!Array.isArray(items) || items.some((template) => !valid(template)))
    throw Error("Повреждена библиотека шаблонов.");
  const existing = readTemplates();
  const previous = existing.length;
  for (const template of items) {
    if (
      existing.some(
        (item) => item.label === template.label && item.body === template.body,
      )
    )
      continue;
    existing.push(saveTemplate({ label: template.label, body: template.body }));
  }
  return existing.length - previous;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, action, className) {
  const item = node("button", text, className);
  item.type = "button";
  item.onclick = action;
  return item;
}
function label(text, control) {
  const wrapper = node("label", text);
  wrapper.append(control);
  if (control.tagName === "SELECT") control.setAttribute("aria-label", text);
  return wrapper;
}

export function templateTools({
  dialog,
  close,
  create,
  nameOf,
  download,
  current,
  preview,
  diagrams,
  applyProfile,
}) {
  function createFrom(initial = "spec") {
    const panel = dialog("Новый документ", "");
    const own = readTemplates();
    const options = new Map([
      ...Object.entries(builtinTemplates),
      ...own.map((t) => [t.id, t]),
    ]);
    const form = node("form", undefined, "template-form");
    const picker = node("select");
    picker.id = "template";
    for (const [caption, entries] of [
      ["Обычные", Object.entries(builtinTemplates).filter(([, t]) => !t.espd)],
      [
        "ЕСПД · ГОСТ 19.106-78",
        Object.entries(builtinTemplates).filter(([, t]) => t.espd),
      ],
      ["Мои шаблоны", own.map((t) => [t.id, t])],
    ]) {
      if (!entries.length) continue;
      const group = node("optgroup");
      group.label = caption;
      for (const [key, item] of entries)
        group.append(new Option(item.label, key));
      picker.append(group);
    }
    picker.value = options.has(initial) ? initial : "spec";
    const name = node("input");
    name.id = "new-name";
    name.required = true;
    const values = node("div", undefined, "template-form");
    const submit = node("button", "Создать", "primary");
    form.append(
      label("Шаблон", picker),
      label("Имя файла", name),
      values,
      submit,
    );
    panel.append(form, button("Библиотека шаблонов", library, "option"));
    function fieldsForTemplate() {
      const template = options.get(picker.value);
      name.value = nameOf(template.name || template.label);
      values.replaceChildren();
      for (const field of templateFields(template.body)) {
        const input = node("input");
        input.dataset.templateField = field;
        values.append(label(field, input));
      }
    }
    picker.onchange = fieldsForTemplate;
    fieldsForTemplate();
    form.onsubmit = (event) => {
      event.preventDefault();
      const template = options.get(picker.value);
      const data = new Map(
        Array.from(values.querySelectorAll("input"), (input) => [
          input.dataset.templateField,
          input.value.trim(),
        ]),
      );
      close();
      create(
        nameOf(name.value),
        applyTemplate(template.body, data, diagrams(template.body)),
        template.label,
      );
    };
  }

  function edit(template = {}) {
    const panel = dialog("Редактор шаблона", "");
    const form = node("form", undefined, "template-form");
    const title = node("input"),
      source = node("textarea", undefined, "template-source");
    title.value = template.label || "";
    title.required = source.required = true;
    title.maxLength = 120;
    source.value = template.body || "# {{Название}}\n\n";
    source.rows = 14;
    const output = node("article", undefined, "paper template-preview");
    output.hidden = true;
    const status = node("p");
    status.setAttribute("role", "status");
    form.append(
      label("Название шаблона", title),
      label("Markdown шаблона", source),
      node(
        "small",
        "Поля для заполнения при создании документа оформляются как {{Название поля}}.",
      ),
      button(
        "Предпросмотр",
        () => {
          output.hidden = !output.hidden;
          if (!output.hidden) preview(output, source.value);
        },
        "option",
      ),
      output,
      node("button", "Сохранить шаблон", "primary"),
    );
    panel.append(button("← Шаблоны", library), form, status);
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        const saved = saveTemplate({
          ...template,
          label: title.value,
          body: source.value,
        });
        library(saved.id);
      } catch (error) {
        status.textContent =
          error.name === "QuotaExceededError"
            ? "В браузере не хватило места для шаблона."
            : error.message;
      }
    };
  }

  function library(selected) {
    const panel = dialog("Шаблоны", "");
    const own = readTemplates();
    const items = new Map([
      ...Object.entries(builtinTemplates),
      ...own.map((t) => [t.id, t]),
    ]);
    const picker = node("select");
    for (const [label, list] of [
      ["Обычные", [...items].filter(([, t]) => !t.id && !t.espd)],
      ["ЕСПД · ГОСТ 19.106-78", [...items].filter(([, t]) => t.espd)],
      ["Мои шаблоны", [...items].filter(([, t]) => t.id)],
    ]) {
      const group = document.createElement("optgroup");
      group.label = label;
      for (const [id, t] of list) group.append(new Option(t.label, id));
      if (list.length) picker.append(group);
    }
    if (items.has(selected)) picker.value = selected;
    const tools = node("div", undefined, "template-form");
    const status = node("p");
    status.setAttribute("role", "status");
    const upload = node("input");
    upload.type = "file";
    upload.accept = ".md,.markdown,.json,text/markdown,application/json";
    panel.append(
      label("Шаблон библиотеки", picker),
      tools,
      button("Новый шаблон", () => edit(), "option"),
      label("Импорт шаблона", upload),
      node("small", "Поддерживаются Markdown и JSON SpecCraft."),
      status,
    );
    const doc = current();
    if (doc)
      tools.before(
        button(
          "Сохранить документ как шаблон",
          () => edit({ label: doc.name.replace(/\.md$/i, ""), body: doc.body }),
          "option",
        ),
      );
    function showActions() {
      const template = items.get(picker.value);
      tools.replaceChildren(
        button("Создать документ", () => createFrom(picker.value), "primary"),
        button(
          template.id ? "Редактировать шаблон" : "Копировать и настроить",
          () =>
            edit(
              template.id
                ? template
                : { label: template.label + " (копия)", body: template.body },
            ),
          "option",
        ),
        button(
          "Скачать шаблон",
          () =>
            download(
              nameOf(template.label).replace(/\.md$/, ".speccraft.json"),
              JSON.stringify(
                {
                  format: fileFormat,
                  version: 1,
                  label: template.label,
                  body: template.body,
                },
                null,
                2,
              ),
              "application/json",
            ),
          "option",
        ),
      );
      if (doc && template.espd)
        tools.append(
          button(
            "Применить оформление к копии документа",
            () => applyProfile(template.espd),
            "option",
          ),
        );
      if (template.id)
        tools.append(
          button("Удалить шаблон", () => {
            if (!confirm("Удалить шаблон «" + template.label + "»?")) return;
            try {
              localStorage.removeItem(prefix + template.id);
              library();
            } catch {
              status.textContent = "Не удалось удалить шаблон.";
            }
          }),
        );
    }
    picker.onchange = showActions;
    showActions();
    upload.onchange = async () => {
      const file = upload.files[0];
      if (!file) return;
      try {
        const body = await file.text();
        let template = {
          label: file.name.replace(/\.(md|markdown)$/i, ""),
          body: body.replace(/^\uFEFF/, ""),
        };
        if (/\.json$/i.test(file.name)) {
          const data = JSON.parse(body);
          if (data?.format !== fileFormat || data.version !== 1 || !valid(data))
            throw Error("Выберите шаблон JSON SpecCraft.");
          template = { label: data.label, body: data.body };
        }
        if (panel.isConnected) edit(template);
      } catch (error) {
        status.textContent =
          error instanceof SyntaxError
            ? "Не удалось прочитать JSON шаблона."
            : error.message;
        upload.value = "";
      }
    };
  }
  return { createFrom, library };
}
