import { dragOrder } from "./block-order.js";

export function reorderTable(data, axis, from, to) {
  function move(items) {
    items.splice(to, 0, items.splice(from, 1)[0]);
  }
  if (axis === "row") {
    move(data.rows);
  } else {
    data.rows.forEach(move);
    move(data.align);
    if (data.widths) move(data.widths);
  }
}

export function tableOrderControls(table, scroller, viewport, reorder) {
  const grips = new Map();
  const controllers = [];
  function setup(axis, entries, gripCell, scroll) {
    const handle = ".table-" + axis + "-grip";
    const item = "[data-table-" + axis + "]";
    entries.forEach((entry, index) => {
      entry.dataset.idx = String(axis === "row" ? index + 1 : index);
      entry.setAttribute("data-table-" + axis, "");
      const cell = gripCell(entry);
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "table-order-grip " + handle.slice(1);
      grip.contentEditable = "false";
      grip.setAttribute(
        "aria-label",
        "Переместить " +
          (axis === "row" ? "строку " : "столбец ") +
          (index + 1),
      );
      grip.title =
        grip.getAttribute("aria-label") +
        (axis === "row" ? " · Alt+↑ / Alt+↓" : " · Alt+← / Alt+→");
      grip.setAttribute(
        "aria-keyshortcuts",
        axis === "row"
          ? "Alt+ArrowUp Alt+ArrowDown"
          : "Alt+ArrowLeft Alt+ArrowRight",
      );
      const symbol = document.createElement("i");
      symbol.dataset.lucide =
        axis === "row" ? "grip-vertical" : "grip-horizontal";
      symbol.setAttribute("aria-hidden", "true");
      grip.append(symbol);
      cell.append(grip);
      grips.set(cell, grip);
    });
    controllers.push(
      dragOrder({
        container: table,
        scroller: scroll,
        region: scroller,
        item,
        handle,
        indexSelector: item,
        keyboardOnItem: false,
        axis: axis === "row" ? "vertical" : "horizontal",
        prepare: (origin) => ({ origin }),
        targets: () => entries.map((entry) => Number(entry.dataset.idx)),
        move({ origin }, target, after) {
          const boundary = target + Number(after);
          const destination = boundary - Number(origin < boundary);
          if (destination !== origin) reorder(axis, origin, destination);
        },
      }),
    );
  }

  const headers = [...table.tHead.rows[0].cells];
  const rows = [...table.tBodies].flatMap((body) => [...body.rows]);
  if (headers.length > 1) setup("column", headers, (cell) => cell, scroller);
  if (rows.length > 1) setup("row", rows, (row) => row.cells[0], viewport);
  return {
    detach(cell) {
      grips.get(cell)?.remove();
    },
    restore(cell) {
      const grip = grips.get(cell);
      if (grip) cell.append(grip);
    },
    active: () => controllers.some((controller) => controller.active()),
    cancel() {
      const active = controllers.find((controller) => controller.active());
      active?.cancel();
      return Boolean(active);
    },
  };
}
