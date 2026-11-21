const widthAttribute = "data-column-widths";
const widthMarker = /[ \t]*<!-- spec-table-widths: ([\d,]+) -->$/;

export function readColumnWidths(value, count) {
  if (!value) return null;
  const widths = value.split(",").map(Number);
  return widths.length === count &&
    widths.every(
      (width) => Number.isInteger(width) && width > 0 && width <= 100000,
    )
    ? widths
    : null;
}

export function tableWidthMarker(widths) {
  return widths ? " <!-- spec-table-widths: " + widths.join(",") + " -->" : "";
}

export function setTableWidthMarker(markdown, widths) {
  const [first] = /^[ \t]*\|?(?:\\\||[^|\r\n])*/.exec(markdown);
  const trimmed = first.trimEnd();
  const content = trimmed.replace(widthMarker, "");
  return (
    content +
    tableWidthMarker(widths) +
    first.slice(trimmed.length) +
    markdown.slice(first.length)
  );
}

export function automaticColumnWidths(rows) {
  const lengths = rows[0].map(() => 6);
  for (const row of rows)
    row.forEach((value, index) => {
      lengths[index] = Math.max(lengths[index], Math.min(65, value.length));
    });
  return lengths.map((length) => Math.round(Math.sqrt(length) * 100));
}

export function tableWidths(md) {
  md.core.ruler.before("inline", "table_widths", ({ tokens }) => {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "table_open") continue;
      const rows = [];
      for (
        let j = i + 1;
        j < tokens.length && tokens[j].type !== "table_close";
        j++
      ) {
        if (tokens[j].type === "tr_open") rows.push([]);
        if (tokens[j].type === "inline") rows.at(-1).push(tokens[j]);
      }
      const first = rows[0]?.[0];
      if (!first) continue;
      const marker = widthMarker.exec(first.content);
      const widths = readColumnWidths(marker?.[1], rows[0].length);
      if (marker) first.content = first.content.slice(0, marker.index);
      if (widths) tokens[i].attrSet(widthAttribute, widths.join(","));
      tokens[i].attrSet(
        "data-auto-column-widths",
        automaticColumnWidths(
          rows.map((row) => row.map((cell) => cell.content)),
        ).join(","),
      );
    }
  });
  md.renderer.rules.table_open = (tokens, index, options, env, self) => {
    const opening = self.renderToken(tokens, index, options);
    const token = tokens[index];
    const weights =
      token.attrGet(widthAttribute) || token.attrGet("data-auto-column-widths");
    return (
      opening + (weights ? columnsMarkup(weights.split(",").map(Number)) : "")
    );
  };
}

const totalWidth = (widths) => widths.reduce((sum, width) => sum + width, 0);
const minColumn = 72;
const widthPercent = (width, total) => (width / total) * 100 + "%";
function columnsMarkup(widths) {
  const total = totalWidth(widths);
  return (
    "<colgroup>" +
    widths
      .map((width) => '<col style="width:' + widthPercent(width, total) + '">')
      .join("") +
    "</colgroup>"
  );
}

export function applyTableWidths(table, widths) {
  table.querySelector("colgroup")?.remove();
  if (widths) table.dataset.columnWidths = widths.join(",");
  else delete table.dataset.columnWidths;
  const weights =
    widths || table.dataset.autoColumnWidths.split(",").map(Number);
  table.insertAdjacentHTML("afterbegin", columnsMarkup(weights));
  sizeTable(table);
}

function sizeTable(table) {
  const widths = readColumnWidths(
    table.dataset.columnWidths || table.dataset.autoColumnWidths,
    table.tHead.rows[0].cells.length,
  );
  if (widths)
    table.style.minWidth =
      ((table.dataset.columnWidths ? minColumn : 120) * totalWidth(widths)) /
        Math.min(...widths) +
      "px";
  else table.style.removeProperty("min-width");
}

export function isColumnBoundary(cell, event) {
  if (event.target !== cell || !cell.hasAttribute("data-column-resize"))
    return false;
  return Math.abs(event.clientX - cell.getBoundingClientRect().right) <= 7;
}

export function enableTableResize(table, enabled, save) {
  sizeTable(table);
  if (!enabled) return;
  const headers = [...table.tHead.rows[0].cells];
  let drag;
  const savedWidths = () =>
    readColumnWidths(table.dataset.columnWidths, headers.length);
  function moveBoundary(widths, index, distance) {
    const left = widths[index];
    const right = widths[index + 1];
    const delta = Math.max(
      Math.min(0, minColumn - left),
      Math.min(Math.max(0, right - minColumn), distance),
    );
    const next = widths.slice();
    next[index] += delta;
    next[index + 1] -= delta;
    return next;
  }
  const measured = () =>
    headers.map((cell) => Math.round(cell.getBoundingClientRect().width));
  headers.slice(0, -1).forEach((cell, index) => {
    cell.dataset.columnResize = "";
    cell.title = "Потяните правую границу столбца или нажмите Alt+← / Alt+→";
    cell.setAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");
    const hover = (event) => {
      cell.classList.toggle(
        "column-resize-hover",
        !drag && event.pointerType !== "touch" && isColumnBoundary(cell, event),
      );
    };
    cell.addEventListener("pointerover", hover);
    cell.addEventListener("pointermove", hover);
    cell.addEventListener("pointerleave", () =>
      cell.classList.remove("column-resize-hover"),
    );
    cell.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !isColumnBoundary(cell, event) || drag) return;
      event.preventDefault();
      drag = {
        pointer: event.pointerId,
        index,
        x: event.clientX,
        start: measured(),
        saved: savedWidths(),
      };
      table.setPointerCapture(event.pointerId);
      cell.classList.remove("column-resize-hover");
      cell.classList.add("resizing-column");
      table.classList.add("resizing-columns");
    });
    cell.addEventListener("keydown", (event) => {
      if (
        !event.target.isContentEditable ||
        !event.altKey ||
        !["ArrowLeft", "ArrowRight"].includes(event.key)
      )
        return;
      event.preventDefault();
      const start = measured();
      const next = moveBoundary(
        start,
        index,
        event.key === "ArrowLeft" ? -20 : 20,
      );
      if (start[index] === next[index]) return;
      applyTableWidths(table, next);
      save(next);
    });
  });
  table.addEventListener("pointermove", (event) => {
    if (drag?.pointer !== event.pointerId) return;
    const next = moveBoundary(
      drag.start,
      drag.index,
      Math.round(event.clientX - drag.x),
    );
    drag.next = next[drag.index] === drag.start[drag.index] ? null : next;
    applyTableWidths(table, drag.next || drag.saved);
  });
  function finish(event) {
    if (drag?.pointer !== event.pointerId) return;
    const { index, next, saved } = drag;
    drag = null;
    headers[index].classList.remove("resizing-column");
    table.classList.remove("resizing-columns");
    if (event.type === "pointerup" && next) save(next);
    else applyTableWidths(table, saved);
  }
  table.addEventListener("pointerup", finish);
  table.addEventListener("lostpointercapture", finish);
}
