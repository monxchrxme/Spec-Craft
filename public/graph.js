export const sampleGraph = {
  version: 1,
  title: "Жизненный цикл заявки",
  nodes: [
    {
      id: "request",
      label: "Заявка",
      shape: "start",
      x: 20,
      y: 65,
      fill: "#e9e4fc",
      stroke: "#8876c6",
    },
    {
      id: "check",
      label: "Проверка",
      shape: "decision",
      x: 235,
      y: 54,
      width: 150,
      height: 82,
      fill: "#fcf0d7",
      stroke: "#b08b47",
    },
    {
      id: "ok",
      label: "Подтверждена",
      x: 480,
      y: 12,
      fill: "#e3f1e9",
      stroke: "#76a38b",
    },
    {
      id: "edit",
      label: "На доработку",
      x: 480,
      y: 110,
      fill: "#f2e8f2",
      stroke: "#ae90ac",
    },
  ],
  edges: [
    { id: "e1", from: "request", to: "check" },
    { id: "e2", from: "check", to: "ok", label: "Да" },
    { id: "e3", from: "check", to: "edit", label: "Нет" },
  ],
};
const ns = "http://www.w3.org/2000/svg";
export const shapes = {
  process: "Операция",
  start: "Терминатор",
  decision: "Условие",
  data: "Данные",
  ellipse: "Эллипс",
};
const colors = {
  fill: "#ece8fb",
  stroke: "#8b7bbd",
  text: "#322b46",
  edge: "#746b87",
};
export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
const safeColor = (v, d) => (/^#[a-f0-9]{6}$/i.test(v) ? v : d);
const num = (v, d, min, max) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const clone = (v) => structuredClone(v);
const uid = (prefix) => prefix + crypto.randomUUID().slice(0, 8);
const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};
export function normalize(raw) {
  if (
    raw?.version !== 1 ||
    !Array.isArray(raw.nodes) ||
    !Array.isArray(raw.edges)
  )
    throw Error("Ожидается version 1 и массивы nodes и edges.");
  const g = clone(raw),
    ids = new Set();
  for (const [i, n] of g.nodes.entries()) {
    if (
      !n ||
      typeof n.id !== "string" ||
      !n.id ||
      ids.has(n.id) ||
      typeof n.label !== "string"
    )
      throw Error("Проверьте ID и подпись каждой фигуры.");
    ids.add(n.id);
    n.x = num(n.x, 40 + (i % 4) * 205, 0, 20000);
    n.y = num(n.y, 40 + Math.floor(i / 4) * 110, 0, 20000);
    n.width = num(n.width, 140, 45, 2000);
    n.height = num(n.height, 60, 28, 1500);
    n.shape = n.shape || "process";
    if (!Object.hasOwn(shapes, n.shape))
      throw Error("Неизвестная форма: " + n.shape);
  }
  const edgeIds = new Set();
  for (const [i, e] of g.edges.entries()) {
    if (
      e?.points !== undefined &&
      (!Array.isArray(e.points) ||
        !e.points.every(
          (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y),
        ))
    )
      throw Error("Точки маршрута должны содержать числовые координаты x и y.");
    if (!e || !ids.has(e.from) || !ids.has(e.to))
      throw Error("Связь указывает на отсутствующую фигуру.");
    e.id ??= "edge-" + (i + 1);
    if (typeof e.id !== "string" || edgeIds.has(e.id))
      throw Error("ID связей должны быть уникальны.");
    edgeIds.add(e.id);
  }
  return g;
}
function bounds(g) {
  let x = Infinity,
    y = Infinity,
    r = 0,
    b = 0;
  for (const n of g.nodes) {
    x = Math.min(x, n.x);
    y = Math.min(y, n.y);
    r = Math.max(r, n.x + n.width);
    b = Math.max(b, n.y + n.height);
  }
  for (const e of g.edges) {
    for (const p of e.points || []) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        x = Math.min(x, p.x);
        y = Math.min(y, p.y);
        r = Math.max(r, p.x);
        b = Math.max(b, p.y);
      }
    }
  }
  return g.nodes.length ? { x, y, r, b } : { x: 0, y: 0, r: 500, b: 170 };
}
function port(n, side) {
  return {
    left: [n.x, n.y + n.height / 2],
    right: [n.x + n.width, n.y + n.height / 2],
    top: [n.x + n.width / 2, n.y],
    bottom: [n.x + n.width / 2, n.y + n.height],
  }[side];
}
function anchors(a, b, e) {
  const dx = b.x + b.width / 2 - a.x - a.width / 2,
    dy = b.y + b.height / 2 - a.y - a.height / 2;
  const horiz = Math.abs(dx) > Math.abs(dy);
  return [
    port(a, e.fromSide) ||
      port(
        a,
        horiz ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top",
      ),
    port(b, e.toSide) ||
      port(
        b,
        horiz ? (dx >= 0 ? "left" : "right") : dy >= 0 ? "top" : "bottom",
      ),
  ];
}
export function draw(g, options = {}) {
  const box = bounds(g),
    editor = !!options.editor,
    pad = 24,
    w = Math.max(840, box.r + 130),
    h = Math.max(450, box.b + 110);
  const svg = el("svg", {
    xmlns: ns,
    viewBox: editor
      ? "0 0 " + w + " " + h
      : [
          box.x - pad,
          box.y - pad,
          box.r - box.x + 2 * pad,
          box.b - box.y + 2 * pad,
        ].join(" "),
    role: "img",
    "aria-label": String(g.title || "Блок-схема"),
  });
  if (editor) {
    svg.setAttribute("width", w * options.zoom);
    svg.setAttribute("height", h * options.zoom);
  } else svg.classList.add("thumbnail");
  const defs = el("defs");
  svg.append(defs);
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  for (const e of g.edges) {
    const a = nodes.get(e.from),
      b = nodes.get(e.to),
      [start, end] = anchors(a, b, e);
    const col = safeColor(e.color, colors.edge),
      marker = uid("arrow");
    const arrow = el("marker", {
      id: marker,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto-start-reverse",
    });
    arrow.append(el("path", { d: "M0 0 L10 5 L0 10 z", fill: col }));
    defs.append(arrow);
    let mid = (e.points || [])
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => [p.x, p.y]);
    if (!mid.length && a === b) {
      const x = a.x + a.width + 25,
        y = a.y + a.height + 25;
      mid = [
        [x, start[1]],
        [x, y],
        [end[0], y],
      ];
    } else if (!mid.length && e.route !== "straight") {
      const horizontal = start[0] === a.x || start[0] === a.x + a.width;
      const mx = (start[0] + end[0]) / 2,
        my = (start[1] + end[1]) / 2;
      mid = horizontal
        ? [
            [mx, start[1]],
            [mx, end[1]],
          ]
        : [
            [start[0], my],
            [end[0], my],
          ];
    }
    const pts = [start, ...mid, end],
      d = pts.map((p) => p.join(",")).join(" "),
      group = el("g", {
        "data-edge": e.id,
        style: editor ? "cursor:pointer" : "",
      });
    group.append(
      el("polyline", {
        points: d,
        fill: "none",
        stroke: "transparent",
        "stroke-width": 16,
      }),
    );
    const line = el("polyline", {
      points: d,
      fill: "none",
      stroke: col,
      "stroke-width": options.edge === e.id ? 3.5 : num(e.weight, 1.6, 1, 8),
      "stroke-linejoin": "round",
    });
    if (e.dashed) line.setAttribute("stroke-dasharray", "6 4");
    if (e.arrow !== "none")
      line.setAttribute("marker-end", "url(#" + marker + ")");
    group.append(line);
    if (e.label) {
      const p = mid.length
        ? mid[Math.floor(mid.length / 2)]
        : [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      group.append(
        el(
          "text",
          {
            x: p[0] + num(e.labelX, 7, -1000, 1000),
            y: p[1] + num(e.labelY, -7, -1000, 1000),
            fill: col,
            "font-size": 12,
            "font-family": "system-ui",
            stroke: "#fbfaff",
            "stroke-width": 3,
            "paint-order": "stroke",
          },
          e.label,
        ),
      );
    }
    if (editor && options.edge === e.id)
      (e.points || []).forEach((p, i) =>
        group.append(
          el("circle", {
            cx: p.x,
            cy: p.y,
            r: 5,
            fill: "#fff",
            stroke: "#6954bc",
            "data-point": i,
          }),
        ),
      );
    svg.append(group);
  }
  for (const n of g.nodes) {
    const group = el("g", {
        transform: "translate(" + n.x + " " + n.y + ")",
        "data-node": n.id,
        style: editor ? "cursor:move" : "",
      }),
      w = n.width,
      h = n.height;
    const attrs = {
      fill: safeColor(n.fill, colors.fill),
      stroke: safeColor(n.stroke, colors.stroke),
      "stroke-width": num(n.weight, 1.6, 0, 10),
    };
    let shape;
    if (n.shape === "decision")
      shape = el("polygon", {
        points: [
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ]
          .map((p) => p.join(","))
          .join(" "),
        ...attrs,
      });
    else if (n.shape === "data")
      shape = el("polygon", {
        points: [
          [14, 0],
          [w, 0],
          [w - 14, h],
          [0, h],
        ]
          .map((p) => p.join(","))
          .join(" "),
        ...attrs,
      });
    else if (n.shape === "ellipse")
      shape = el("ellipse", {
        cx: w / 2,
        cy: h / 2,
        rx: w / 2,
        ry: h / 2,
        ...attrs,
      });
    else
      shape = el("rect", {
        width: w,
        height: h,
        rx: n.shape === "start" ? h / 2 : num(n.radius, 7, 0, 100),
        ...attrs,
      });
    group.append(shape);
    const size = num(n.fontSize, 15, 9, 64),
      lines = n.label.split("\n"),
      text = el("text", {
        x: w / 2,
        y: h / 2 - (lines.length - 1) * size * 0.56,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        fill: safeColor(n.textColor, colors.text),
        "font-size": size,
        "font-family": "system-ui",
        "pointer-events": "none",
      });
    lines.forEach((line, i) =>
      text.append(el("tspan", { x: w / 2, dy: i ? size * 1.12 : 0 }, line)),
    );
    group.append(text);
    if (editor && options.node === n.id) {
      group.append(
        el("rect", {
          x: -4,
          y: -4,
          width: w + 8,
          height: h + 8,
          rx: 3,
          fill: "none",
          stroke: "#6954bc",
          "stroke-dasharray": "4 3",
          "pointer-events": "none",
        }),
        el("rect", {
          x: w - 4,
          y: h - 4,
          width: 9,
          height: 9,
          fill: "white",
          stroke: "#6954bc",
          "data-size": 1,
          style: "cursor:nwse-resize",
        }),
      );
    }
    svg.append(group);
  }
  return svg;
}
export function graphEditor(raw, modal, onSave) {
  let graph = normalize(raw),
    node = null,
    edge = null,
    link = null,
    connecting = false,
    zoom = 0.9,
    drag = null,
    dirty = false;
  const history = [],
    future = [];
  modal.className = "graph-dialog";
  modal.innerHTML =
    '<div class="dialog-head"><h2>Редактор схемы</h2><button data-close aria-label="Закрыть">✕</button></div><div class="graph-tools"><select aria-label="Фигура">' +
    Object.entries(shapes)
      .map(([k, v]) => '<option value="' + k + '">' + v + "</option>")
      .join("") +
    '</select><button data-cmd="add">+ Фигура</button><button data-cmd="connect">Связать</button><button data-cmd="undo" aria-label="Отменить действие">↶</button><button data-cmd="redo" aria-label="Повторить действие">↷</button><span class="spacer"></span><button data-cmd="svg" title="Скачать схему как SVG">SVG</button><button data-cmd="minus" aria-label="Уменьшить">−</button><output></output><button data-cmd="plus" aria-label="Увеличить">+</button></div><div class="graph-shell"><div class="graph-stage graph-bg"></div><div class="props"></div></div><div class="graph-foot"><span role="status"></span><span class="spacer"></span><button class="primary" data-cmd="save">Применить</button></div>';
  const stage = modal.querySelector(".graph-stage"),
    props = modal.querySelector(".props"),
    hint = modal.querySelector("[role=status]");
  const current = () =>
    graph.nodes.find((n) => n.id === node) ||
    graph.edges.find((e) => e.id === edge) ||
    graph;
  function checkpoint() {
    history.push(clone(graph));
    if (history.length > 80) history.shift();
    future.length = 0;
    dirty = true;
  }
  function render() {
    stage.replaceChildren(draw(graph, { editor: true, zoom, node, edge }));
    modal.querySelector("output").textContent = Math.round(zoom * 100) + "%";
    modal.querySelector("[data-cmd=undo]").disabled = !history.length;
    modal.querySelector("[data-cmd=redo]").disabled = !future.length;
    modal
      .querySelector("[data-cmd=connect]")
      .setAttribute("aria-pressed", connecting);
    hint.textContent = connecting
      ? link
        ? "Выберите конечную фигуру"
        : "Выберите начальную фигуру"
      : "Перетаскивайте фигуры и точки маршрута";
  }
  function field(label, key, kind, def, opts) {
    const l = document.createElement("label");
    l.textContent = label;
    const inp = document.createElement(
      opts ? "select" : kind === "textarea" ? "textarea" : "input",
    );
    if (inp.tagName === "INPUT") inp.type = kind;
    if (opts)
      for (const [val, name] of Object.entries(opts))
        inp.add(new Option(name, val));
    inp.value = current()[key] ?? def;
    inp.onchange = () => {
      const v = kind === "number" ? Number(inp.value) : inp.value;
      if (kind === "number" && !Number.isFinite(v)) return;
      checkpoint();
      current()[key] = v;
      graph = normalize(graph);
      render();
      inspector();
    };
    l.append(inp);
    props.append(l);
  }
  function action(label, fn) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    props.append(b);
  }
  function inspector() {
    props.replaceChildren();
    const picker = document.createElement("select");
    picker.setAttribute("aria-label", "Выбрать элемент схемы");
    picker.add(new Option("Вся схема", ""));
    graph.nodes.forEach((n, i) =>
      picker.add(new Option(n.label || n.id, "n" + i)),
    );
    graph.edges.forEach((e, i) =>
      picker.add(
        new Option("Связь · " + (e.label || e.from + " → " + e.to), "e" + i),
      ),
    );
    picker.value = node
      ? "n" + graph.nodes.findIndex((n) => n.id === node)
      : edge
        ? "e" + graph.edges.findIndex((e) => e.id === edge)
        : "";
    picker.onchange = () => {
      const key = picker.value,
        idx = Number(key.slice(1));
      node = key.startsWith("n") ? graph.nodes[idx].id : null;
      edge = key.startsWith("e") ? graph.edges[idx].id : null;
      refresh();
    };
    props.append(picker);
    const head = document.createElement("h3");
    head.textContent = node ? "Фигура" : edge ? "Связь" : "Схема";
    props.append(head);
    if (node) {
      field("Подпись", "label", "textarea", "");
      field("Форма", "shape", "text", "process", shapes);
      for (const [name, k, d] of [
        ["Заливка", "fill", colors.fill],
        ["Обводка", "stroke", colors.stroke],
        ["Цвет текста", "textColor", colors.text],
      ])
        field(name, k, "color", d);
      for (const [name, k, d] of [
        ["Шрифт, px", "fontSize", 15],
        ["Ширина", "width", 140],
        ["Высота", "height", 60],
        ["Скругление", "radius", 7],
        ["Толщина обводки", "weight", 1.6],
      ])
        field(name, k, "number", d);
    } else if (edge) {
      field("Подпись", "label", "text", "");
      field("Цвет линии", "color", "color", colors.edge);
      const sides = {
        auto: "Авто",
        left: "Слева",
        right: "Справа",
        top: "Сверху",
        bottom: "Снизу",
      };
      field("Начало", "fromSide", "text", "auto", sides);
      field("Конец", "toSide", "text", "auto", sides);
      field("Маршрут", "route", "text", "orthogonal", {
        orthogonal: "Ломаная",
        straight: "Прямая",
      });
      field("Наконечник", "arrow", "text", "end", {
        end: "Стрелка",
        none: "Без стрелки",
      });
      field("Толщина", "weight", "number", 1.6);
      field("Сдвиг подписи X", "labelX", "number", 7);
      field("Сдвиг подписи Y", "labelY", "number", -7);
      action(current().dashed ? "Сплошная линия" : "Пунктирная линия", () => {
        checkpoint();
        current().dashed = !current().dashed;
        refresh();
      });
      action("Добавить точку изгиба", () => {
        const e = current(),
          a = graph.nodes.find((n) => n.id === e.from),
          b = graph.nodes.find((n) => n.id === e.to),
          [s, t] = anchors(a, b, e);
        checkpoint();
        const p = e.points?.at(-1) || { x: s[0], y: s[1] };
        (e.points ??= []).push({
          x: (p.x + t[0]) / 2,
          y: (p.y + t[1]) / 2 + 22,
        });
        refresh();
      });
      if (current().points?.length)
        action("Сбросить точки", () => {
          checkpoint();
          delete current().points;
          refresh();
        });
    } else {
      field("Название", "title", "text", "Блок-схема");
      const p = document.createElement("p");
      p.textContent =
        "Выберите фигуру или стрелку, чтобы настроить её свойства.";
      props.append(p);
    }
    if (node || edge)
      action(node ? "Удалить фигуру" : "Удалить связь", () => {
        checkpoint();
        if (node) {
          graph.nodes = graph.nodes.filter((n) => n.id !== node);
          graph.edges = graph.edges.filter(
            (e) => e.from !== node && e.to !== node,
          );
        } else graph.edges = graph.edges.filter((e) => e.id !== edge);
        node = edge = null;
        refresh();
      });
  }
  function refresh() {
    render();
    inspector();
  }
  function close() {
    if (!dirty || confirm("Закрыть схему без сохранения изменений?"))
      modal.close();
  }
  modal.querySelector("[data-close]").onclick = close;
  modal.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  modal.onclick = (e) => {
    const cmd = e.target.closest("[data-cmd]")?.dataset.cmd;
    if (!cmd) return;
    if (cmd === "svg") {
      const content = new XMLSerializer().serializeToString(draw(graph)),
        url = URL.createObjectURL(
          new Blob([content], { type: "image/svg+xml" }),
        );
      const a = document.createElement("a");
      a.href = url;
      a.download = (graph.title || "Схема") + ".svg";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (cmd === "save") {
      onSave(graph);
      modal.close();
      return;
    }
    if (cmd === "add") {
      checkpoint();
      const id = uid("n"),
        shape = modal.querySelector(".graph-tools select").value;
      graph.nodes.push({
        id,
        label: shapes[shape],
        shape,
        x: Math.round(
          stage.scrollLeft / zoom + 45 + (graph.nodes.length % 4) * 30,
        ),
        y: Math.round(
          stage.scrollTop / zoom + 45 + (graph.nodes.length % 5) * 45,
        ),
        width: 140,
        height: 60,
      });
      node = id;
      edge = null;
    }
    if (cmd === "connect") {
      connecting = !connecting;
      link = null;
    }
    if (cmd === "plus") zoom = Math.min(2.5, zoom + 0.15);
    if (cmd === "minus") zoom = Math.max(0.25, zoom - 0.15);
    if (cmd === "undo" && history.length) {
      future.push(clone(graph));
      graph = history.pop();
      node = edge = link = null;
    }
    if (cmd === "redo" && future.length) {
      history.push(clone(graph));
      graph = future.pop();
      node = edge = link = null;
    }
    refresh();
  };
  stage.onpointerdown = (e) => {
    if (e.button !== 0) return;
    const n = e.target.closest("[data-node]")?.dataset.node,
      ed = e.target.closest("[data-edge]")?.dataset.edge;
    if (connecting && n) {
      if (link) {
        checkpoint();
        const id = uid("e");
        graph.edges.push({ id, from: link, to: n });
        edge = id;
        node = link = null;
        connecting = false;
      } else {
        link = node = n;
        edge = null;
      }
      refresh();
      return;
    }
    node = n || null;
    edge = ed || null;
    const obj = current(),
      point = e.target.dataset.point,
      resize = e.target.hasAttribute("data-size");
    if (node || point !== undefined) {
      const p = point !== undefined ? obj.points[Number(point)] : obj;
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        ox: p.x,
        oy: p.y,
        w: obj.width,
        h: obj.height,
        point,
        resize,
        started: false,
      };
      stage.setPointerCapture(e.pointerId);
    }
    refresh();
  };
  stage.onpointermove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.x) / zoom,
      dy = (e.clientY - drag.y) / zoom;
    if (!drag.started) {
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      checkpoint();
      drag.started = true;
    }
    const obj = current();
    if (drag.resize) {
      obj.width = Math.max(45, Math.round(drag.w + dx));
      obj.height = Math.max(28, Math.round(drag.h + dy));
    } else {
      const p = drag.point === undefined ? obj : obj.points[Number(drag.point)];
      p.x = Math.max(0, Math.round(drag.ox + dx));
      p.y = Math.max(0, Math.round(drag.oy + dy));
    }
    render();
  };
  stage.onpointerup = stage.onpointercancel = () => {
    if (drag) {
      drag = null;
      inspector();
    }
  };
  refresh();
  modal.showModal();
}
