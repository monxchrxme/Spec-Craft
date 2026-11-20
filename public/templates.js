import { examples } from "./documents.js";

import {
  paintDocumentStyle,
  styleControls,
  templateStyle,
} from "./document-style.js";

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

function templateRecord(template) {
  const record = { label: template.label.trim(), body: template.body };
  const style = templateStyle(template.style);
  if (Object.keys(style).length) record.style = style;
  const defaults = Object.fromEntries(
    templateFields(record.body)
      .filter(
        (key) =>
          Object.hasOwn(template.defaults ?? {}, key) &&
          typeof template.defaults[key] === "string" &&
          template.defaults[key],
      )
      .map((key) => [key, template.defaults[key]]),
  );
  if (Object.keys(defaults).length) record.defaults = defaults;
  return record;
}

export function saveTemplate(template) {
  if (!valid(template)) throw Error("Укажите название и заполните Markdown.");
  const id = template.id || crypto.randomUUID();
  const record = { id, ...templateRecord(template) };
  localStorage.setItem(prefix + id, JSON.stringify(record));
  return record;
}

export function restoreTemplates(items) {
  if (!Array.isArray(items) || items.some((template) => !valid(template)))
    throw Error("Повреждена библиотека шаблонов.");
  const existing = readTemplates();
  const previous = existing.length;
  for (const template of items) {
    const record = templateRecord(template);
    if (
      existing.some(
        (item) =>
          JSON.stringify(templateRecord(item)) === JSON.stringify(record),
      )
    )
      continue;
    existing.push(saveTemplate(record));
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
  applyAppearance,
  preview,
  diagrams,
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
      ["Встроенные", Object.entries(builtinTemplates)],
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
        input.value = Object.hasOwn(template.defaults ?? {}, field)
          ? template.defaults[field]
          : "";
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
        templateStyle(template.style),
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
    const settings = node("div", undefined, "template-form");
    const appearance = styleControls(
      settings,
      templateStyle(template.style),
      "none",
    );
    const defaults = new Map(Object.entries(template.defaults || {}));
    const defaultBox = node("details"),
      defaultRows = node("div", undefined, "style-fields");
    defaultBox.append(
      node("summary", "Значения полей по умолчанию"),
      defaultRows,
    );
    let lastFields;
    function updateFields() {
      const fields = templateFields(source.value);
      const signature = JSON.stringify(fields);
      if (lastFields === signature) return;
      lastFields = signature;
      defaultRows.replaceChildren();
      defaultBox.hidden = !fields.length;
      for (const key of fields) {
        const input = node("input");
        input.value = defaults.get(key) || "";
        input.oninput = () => defaults.set(key, input.value);
        defaultRows.append(label(key, input));
      }
    }
    source.oninput = updateFields;
    updateFields();
    function refreshPreview() {
      if (output.hidden) return;
      paintDocumentStyle(output, appearance());
      preview(
        output,
        applyTemplate(source.value, defaults, diagrams(source.value)),
      );
    }
    form.addEventListener("input", refreshPreview);
    form.append(
      label("Название шаблона", title),
      label("Markdown шаблона", source),
      node(
        "small",
        "Поля для заполнения при создании документа оформляются как {{Название поля}}.",
      ),
      defaultBox,
      settings,
      button(
        "Предпросмотр",
        () => {
          output.hidden = !output.hidden;
          refreshPreview();
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
          style: appearance(),
          defaults: Object.fromEntries(defaults),
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
    for (const [id, t] of items)
      picker.add(new Option(t.id ? t.label + " · мой шаблон" : t.label, id));
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
          () =>
            edit({
              label: doc.name.replace(/\.md$/i, ""),
              body: doc.body,
              style: doc.style,
            }),
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
                : { ...template, label: template.label + " (копия)" },
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
                  ...templateRecord(template),
                },
                null,
                2,
              ),
              "application/json",
            ),
          "option",
        ),
      );
      if (doc && template.style && Object.keys(template.style).length)
        tools.append(
          button(
            "Применить оформление к документу",
            () => {
              const style = templateStyle(template.style);
              applyAppearance(style, true);
              close();
            },
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
          template = templateRecord(data);
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
