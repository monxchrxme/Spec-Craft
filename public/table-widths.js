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

export function tableWidths(md) {
  md.core.ruler.before("inline", "table_widths", ({ tokens }) => {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "table_open") continue;
      const headers = [];
      let index = i + 1;
      for (
        ;
        index < tokens.length && tokens[index].type !== "thead_close";
        index++
      )
        if (tokens[index].type === "inline") headers.push(tokens[index]);
      const first = headers[0];
      const marker = widthMarker.exec(first?.content || "");
      const widths = readColumnWidths(marker?.[1], headers.length);
      if (marker) first.content = first.content.slice(0, marker.index);
      if (!widths) continue;
      tokens[i].attrSet(widthAttribute, widths.join(","));
    }
  });
  md.renderer.rules.table_open = (tokens, index, options, env, self) => {
    const opening = self.renderToken(tokens, index, options);
    const widths = tokens[index]
      .attrGet(widthAttribute)
      ?.split(",")
      .map(Number);
    return opening + (widths ? columnsMarkup(widths) : "");
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
  if (widths) {
    table.dataset.columnWidths = widths.join(",");
    table.insertAdjacentHTML("afterbegin", columnsMarkup(widths));
  } else delete table.dataset.columnWidths;
  sizeTable(table);
}

function sizeTable(table) {
  const widths = readColumnWidths(
    table.dataset.columnWidths,
    table.tHead.rows[0].cells.length,
  );
  if (widths)
    table.style.minWidth =
      (minColumn * totalWidth(widths)) / Math.min(...widths) + "px";
  else table.style.removeProperty("min-width");
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
    cell.addEventListener("pointerdown", (event) => {
      const nearEdge =
        Math.abs(event.clientX - cell.getBoundingClientRect().right) <= 7;
      if (event.button !== 0 || !nearEdge || drag) return;
      event.preventDefault();
      drag = {
        pointer: event.pointerId,
        index,
        x: event.clientX,
        start: measured(),
        saved: savedWidths(),
      };
      table.setPointerCapture(event.pointerId);
      table.classList.add("resizing-columns");
    });
    cell.addEventListener("keydown", (event) => {
      if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key))
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
    const { next, saved } = drag;
    drag = null;
    table.classList.remove("resizing-columns");
    if (event.type === "pointerup" && next) save(next);
    else applyTableWidths(table, saved);
  }
  table.addEventListener("pointerup", finish);
  table.addEventListener("lostpointercapture", finish);
}
