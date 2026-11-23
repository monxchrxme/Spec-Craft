const dragType = "application/x-speccraft-files";

export function workspaceFileActions(section, { open, rename, move }) {
  const selected = new Set();
  const rows = () => [...section.querySelectorAll("[data-document-row]")];
  const visible = () => rows().filter((row) => !row.closest("[hidden]"));
  const idFor = (row) => row.dataset.documentRow;
  const root = section.querySelector(".side-heading");
  let anchor, dragged, target, editing;

  function paint() {
    const listed = rows();
    const ids = new Set(listed.map(idFor));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    section.classList.toggle("has-file-selection", selected.size > 0);
    for (const row of listed) {
      const active = selected.has(idFor(row));
      row.classList.toggle("file-selected", active);
      row.querySelector(".file")?.setAttribute("aria-pressed", String(active));
    }
  }

  function select(row, event) {
    const id = idFor(row);
    if (event.shiftKey) {
      const order = visible().map(idFor);
      const last = order.indexOf(id);
      const first = order.indexOf(anchor);
      if (!event.metaKey && !event.ctrlKey) selected.clear();
      if (first < 0) selected.add(id);
      else for (const item of order.slice(Math.min(first, last), Math.max(first, last) + 1))
        selected.add(item);
    } else {
      anchor = id;
      if (event.metaKey || event.ctrlKey) {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      } else {
        selected.clear();
        selected.add(id);
        open(id);
      }
    }
    paint();
  }

  const findRow = (id, folder) => folder
    ? [...section.querySelectorAll("[data-folder]")].find((entry) => entry.dataset.folder === id)?.firstElementChild
    : rows().find((row) => idFor(row) === id);

  function edit(id, folder = false) {
    editing?.cancel();
    const ids = !folder && selected.has(id)
      ? [id, ...visible().map(idFor).filter((item) => item !== id && selected.has(item))]
      : [id];
    function next() {
      const key = ids.shift();
      if (!key) return;
      const row = findRow(key, folder);
      const button = row?.querySelector(".file");
      if (!button || row.closest("[hidden]")) return next();
      const form = document.createElement("form");
      const input = document.createElement("input");
      form.className = "file-rename";
      form.append(input);
      input.value = button.title;
      input.required = true;
      if (folder) input.maxLength = 100;
      input.setAttribute("aria-label", folder ? "Название папки" : "Название файла");
      button.hidden = true;
      button.after(form);

      function close(focus) {
        editing = null;
        button.hidden = false;
        form.remove();
        if (focus) findRow(key, folder)?.querySelector(".file")?.focus({ preventScroll: true });
      }
      editing = { cancel: () => close(false) };
      form.onsubmit = (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value || !rename(key, folder, value)) return;
        close(true);
        next();
      };
      input.onkeydown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      };
      input.focus();
      const extension = folder ? -1 : input.value.lastIndexOf(".");
      input.setSelectionRange(0, extension > 0 ? extension : input.value.length);
    }
    next();
  }

  section.addEventListener("keydown", (event) => {
    const button = event.target.closest(".file");
    if (event.key !== "F2" || !button) return;
    const row = button.closest("[data-document-row]");
    event.preventDefault();
    if (row) edit(idFor(row));
    else edit(button.closest("[data-folder]").dataset.folder, true);
  });
  section.addEventListener("click", (event) => {
    const row = event.target.closest(".file")?.closest("[data-document-row]");
    if (row) select(row, event);
  });

  function highlight(next) {
    if (next === target) return;
    target?.classList.remove("file-drop-target");
    target = next;
    target?.classList.add("file-drop-target");
  }
  function endDrag() {
    highlight(null);
    dragged = null;
  }
  section.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".file")?.closest("[data-document-row]");
    if (!row) return;
    if (!selected.has(idFor(row))) {
      selected.clear();
      selected.add(idFor(row));
      anchor = idFor(row);
      paint();
    }
    dragged = visible().map(idFor).filter((id) => selected.has(id));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(dragType, "files");
  });
  section.addEventListener("dragover", (event) => {
    if (!dragged || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    highlight(event.target.closest("[data-folder]")?.firstElementChild || root);
  });
  section.addEventListener("dragleave", (event) => {
    if (!section.contains(event.relatedTarget)) highlight(null);
  });
  section.addEventListener("drop", (event) => {
    if (!dragged || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault();
    const ids = dragged;
    endDrag();
    move(ids, event.target.closest("[data-folder]")?.dataset.folder || "");
  });
  section.addEventListener("dragend", endDrag);
  return { edit, paint };
}
