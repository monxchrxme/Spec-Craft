import { projectTreeMarkdown } from "./project-tree.js";
import { bibliographyMarkdown } from "./portable-blocks.js";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function action(label, run, description) {
  const button = element("button", label);
  button.type = "button";
  button.onclick = run;
  if (description) button.setAttribute("aria-label", description);
  return button;
}

function field(form, name, control) {
  const label = element("label", name);
  label.append(control);
  form.append(label);
  return control;
}

export function projectTreeEditor(panel, root, save) {
  let selected = root;
  const list = element("div", "", "project-tree-entries");
  list.setAttribute("aria-label", "Файлы и папки");
  const form = element("form", "", "structured-form");
  const name = field(form, "Имя файла или папки", element("input"));
  const note = field(form, "Комментарий", element("input"));
  const controls = element("div", "", "structured-actions");
  const submit = element("button", "Сохранить структуру", "primary");
  submit.type = "submit";
  name.required = true;
  form.append(controls, submit);
  panel.append(list, form);

  function parentOf(entry, parent = root) {
    if (parent.children?.includes(entry)) return parent;
    for (const child of parent.children || []) {
      const result = parentOf(entry, child);
      if (result) return result;
    }
    return null;
  }
  function move(delta) {
    const siblings = parentOf(selected)?.children;
    if (!siblings) return;
    const index = siblings.indexOf(selected);
    const next = index + delta;
    if (next < 0 || next >= siblings.length) return;
    [siblings[index], siblings[next]] = [siblings[next], siblings[index]];
    render();
  }
  function add(folder) {
    const parent = selected.children ? selected : parentOf(selected);
    selected = {
      name: folder ? "новая-папка" : "новый-файл",
      note: "",
      children: folder ? [] : null,
    };
    parent.children.push(selected);
    render();
    name.focus();
    name.select();
  }
  const up = action("↑", () => move(-1), "Поднять элемент");
  const down = action("↓", () => move(1), "Опустить элемент");
  const nest = action(
    "Вложить",
    () => {
      const siblings = parentOf(selected)?.children;
      const index = siblings?.indexOf(selected);
      const folder = siblings?.[index - 1];
      if (!folder?.children) return;
      siblings.splice(index, 1);
      folder.children.push(selected);
      render();
    },
    "Вложить в предыдущую папку",
  );
  const unnest = action("На уровень выше", () => {
    const parent = parentOf(selected),
      outer = parent && parentOf(parent);
    if (!outer) return;
    parent.children.splice(parent.children.indexOf(selected), 1);
    outer.children.splice(outer.children.indexOf(parent) + 1, 0, selected);
    render();
  });
  const remove = action(
    "Убрать",
    () => {
      const parent = parentOf(selected);
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(selected), 1);
      selected = parent;
      render();
    },
    "Удалить элемент с вложенными файлами",
  );
  controls.append(
    action("Добавить файл", () => add(false)),
    action("Добавить папку", () => add(true)),
    up,
    down,
    nest,
    unnest,
    remove,
  );

  function renderList() {
    list.replaceChildren();
    function visit(entry, depth) {
      const label =
        entry.name + (entry.children && entry.name !== "/" ? "/" : "");
      const button = action(label || "Без имени", () => {
        selected = entry;
        render();
        list
          .querySelector('[aria-current="true"]')
          ?.focus({ preventScroll: true });
      });
      button.style.paddingInlineStart = Math.min(depth, 12) * 13 + 7 + "px";
      button.setAttribute("aria-current", String(entry === selected));
      if (entry.note) button.append(element("small", entry.note));
      list.append(button);
      for (const child of entry.children || []) visit(child, depth + 1);
    }
    visit(root, 0);
  }
  function render() {
    renderList();
    name.value = selected.name;
    note.value = selected.note;
    const parent = parentOf(selected);
    const siblings = parent?.children || [];
    const index = siblings.indexOf(selected);
    up.disabled = index < 1;
    down.disabled = index < 0 || index === siblings.length - 1;
    nest.disabled = !siblings[index - 1]?.children;
    unnest.disabled = !parent || parent === root;
    remove.disabled = !parent;
  }
  name.oninput = () => {
    selected.name =
      name.value.trim().replace(/\/$/, "") || (name.value === "/" ? "/" : "");
    renderList();
  };
  note.oninput = () => {
    selected.note = note.value.trim();
    renderList();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    function complete(entry) {
      return (
        !!entry.name.trim() &&
        !/\s+#/.test(entry.name) &&
        (entry.children || []).every(complete)
      );
    }
    if (!complete(root)) {
      name.setCustomValidity(
        "У каждого элемента должно быть имя. Комментарий укажите в отдельном поле.",
      );
      name.reportValidity();
      name.setCustomValidity("");
      return;
    }
    save(projectTreeMarkdown(root));
  };
  render();
}

export function bibliographyEditor(panel, entries, save) {
  const form = element("form", "", "structured-form");
  const rows = element("div", "", "bibliography-entries");
  const submit = element("button", "Сохранить список", "primary");
  submit.type = "submit";
  form.append(
    rows,
    action("Добавить источник", () => {
      entries.push("");
      render();
      rows.lastElementChild?.querySelector("textarea")?.focus();
    }),
    submit,
  );
  panel.append(form);
  function render() {
    rows.replaceChildren();
    entries.forEach((entry, index) => {
      const item = element("div", "", "bibliography-entry");
      const label = element("label", "Источник " + (index + 1));
      const text = element("textarea");
      text.rows = 2;
      text.value = entry;
      text.placeholder = "Автор. Название. Год. [Ссылка](https://…)";
      text.oninput = () => {
        entries[index] = text.value;
      };
      const controls = element("div", "", "structured-actions");
      const move = (delta) => {
        const next = index + delta;
        [entries[index], entries[next]] = [entries[next], entries[index]];
        render();
      };
      const up = action("↑", () => move(-1), "Поднять источник " + (index + 1));
      const down = action(
        "↓",
        () => move(1),
        "Опустить источник " + (index + 1),
      );
      up.disabled = index === 0;
      down.disabled = index === entries.length - 1;
      controls.append(
        up,
        down,
        action(
          "Убрать",
          () => {
            entries.splice(index, 1);
            render();
          },
          "Удалить источник " + (index + 1),
        ),
      );
      label.append(text);
      item.append(label, controls);
      rows.append(item);
    });
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    save(bibliographyMarkdown(entries));
  };
  render();
}
