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
  database: "База данных",
  component: "Компонент",
  umlClass: "UML · Класс",
};
export const colors = {
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
export const uid = (prefix) => prefix + crypto.randomUUID().slice(0, 8);
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
  if (
    g.layout !== undefined &&
    (!g.layout || typeof g.layout !== "object" || Array.isArray(g.layout))
  )
    throw Error("layout должен быть объектом с настройками блока.");
  if (g.modules !== undefined) {
    if (!Array.isArray(g.modules)) throw Error("modules должен быть массивом.");
    const moduleIds = new Set();
    for (const m of g.modules) {
      if (
        !m ||
        typeof m.id !== "string" ||
        !m.id ||
        moduleIds.has(m.id) ||
        typeof m.title !== "string"
      )
        throw Error("Проверьте название и уникальный ID модуля.");
      moduleIds.add(m.id);
    }
    if (g.nodes.some((n) => n.moduleId && !moduleIds.has(n.moduleId)))
      throw Error("Фигура ссылается на отсутствующий модуль.");
  }
  for (const n of g.nodes) {
    if (n.shape === "umlClass") {
      for (const key of ["attributes", "methods"])
        if (n[key] !== undefined && typeof n[key] !== "string")
          throw Error("Поля и методы UML-класса задаются текстом.");
      n.height = Math.min(1500, Math.max(n.height, classRows(n).minHeight));
    }
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
export function anchors(a, b, e) {
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
function classRows(n) {
  const size = num(n.fontSize, 15, 9, 64),
    spacing = Math.ceil(size * 1.3);
  const attrs = (n.attributes || "").split("\n"),
    methods = (n.methods || "").split("\n");
  const header = spacing + 12,
    divider = header + attrs.length * spacing + 8;
  return {
    size,
    spacing,
    attrs,
    methods,
    header,
    divider,
    minHeight: divider + methods.length * spacing + 8,
  };
}
export function frameLayout(g) {
  const l = g.layout || {};
  return {
    width: num(l.width, 100, 25, 100),
    height: num(l.height, 0, 0, 1400),
    align: ["center", "right"].includes(l.align) ? l.align : "left",
    fit: ["contain", "width"].includes(l.fit) ? l.fit : "actual",
  };
}
export function styleFrame(card, g) {
  const layout = frameLayout(g);
  card.classList.toggle("auto-frame", !layout.height);
  card.dataset.align = layout.align;
  card.style.width = layout.width + "%";
  card.style.marginInlineStart = layout.align === "left" ? "0" : "auto";
  card.style.marginInlineEnd = layout.align === "right" ? "0" : "auto";
  card.style.setProperty(
    "--frame-height",
    layout.height ? Math.max(150, layout.height) + "px" : "auto",
  );
  if (layout.height)
    card.style.setProperty(
      "--view-height",
      Math.max(150, layout.height) + "px",
    );
  else card.style.removeProperty("--view-height");
}
// Each control point is on the curve, so existing hand-routed paths stay editable.
function curvePath(points) {
  const pair = (p) => p.join(" ");
  let d = "M " + pair(points[0]);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      before = points[i - 1] || a,
      after = points[i + 2] || b;
    const c1 = a.map((v, j) => v + (b[j] - before[j]) / 6);
    const c2 = b.map((v, j) => v - (after[j] - a[j]) / 6);
    d += " C " + pair(c1) + " " + pair(c2) + " " + pair(b);
  }
  return d;
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
      ? "-20 -36 " + w + " " + h
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
  }
  const defs = el("defs");
  svg.append(defs);
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  for (const module of g.modules || []) {
    const members = g.nodes.filter((n) => n.moduleId === module.id);
    if (!members.length) continue;
    const b = bounds({ nodes: members, edges: [] }),
      color = safeColor(module.color, "#7b72bc");
    const x = b.x - 16,
      y = b.y - 32;
    const layer = el("g", {
      "data-module": module.id,
      style: editor ? "cursor:move" : "",
    });
    layer.append(
      el("rect", {
        x,
        y,
        width: b.r - x + 16,
        height: b.b - y + 16,
        rx: 12,
        fill: color,
        "fill-opacity": 0.09,
        stroke: color,
        "stroke-width": options.module === module.id ? 3 : 1.3,
      }),
      el(
        "text",
        {
          x: x + 10,
          y: y + 17,
          fill: color,
          "font-family": "system-ui",
          "font-weight": "600",
          "font-size": 13,
        },
        module.title,
      ),
    );
    svg.append(layer);
  }
  for (const e of g.edges) {
    const a = nodes.get(e.from),
      b = nodes.get(e.to),
      [start, end] = anchors(a, b, e);
    const col = safeColor(e.color, colors.edge),
      marker = uid("arrow");
    const arrow = el("marker", {
      id: marker,
      viewBox: "-1 -1 12 12",
      refX: 10,
      refY: 5,
      markerWidth: 9,
      markerHeight: 9,
      orient: "auto-start-reverse",
    });
    const diamond = ["composition", "aggregation"].includes(e.arrow);
    arrow.append(
      el("path", {
        d: diamond ? "M0 5 L5 1 L10 5 L5 9 Z" : "M0 0 L10 5 L0 10 Z",
        fill: ["inheritance", "aggregation"].includes(e.arrow) ? "white" : col,
        stroke: col,
        "stroke-width": 1,
      }),
    );
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
    } else if (!mid.length && !["straight", "curve"].includes(e.route)) {
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
      group = el("g", {
        "data-edge": e.id,
        style: editor ? "cursor:pointer" : "",
      });
    let path = "M " + pts.map((p) => p.join(" ")).join(" L ");
    if (e.route === "curve") {
      if (pts.length > 2) path = curvePath(pts);
      else {
        const bend = Math.max(
          35,
          Math.hypot(end[0] - start[0], end[1] - start[1]) * 0.35,
        );
        function control(n, p) {
          if (p[0] === n.x) return [p[0] - bend, p[1]];
          if (p[0] === n.x + n.width) return [p[0] + bend, p[1]];
          return [p[0], p[1] + (p[1] === n.y ? -bend : bend)];
        }
        path =
          "M " +
          start.join(" ") +
          " C " +
          [control(a, start), control(b, end), end]
            .map((p) => p.join(" "))
            .join(" ");
      }
    }
    group.append(
      el("path", {
        d: path,
        fill: "none",
        stroke: "transparent",
        "stroke-width": 16,
      }),
    );
    const line = el("path", {
      d: path,
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
    else if (n.shape === "database") {
      const ry = Math.min(10, h / 6);
      shape = el("g");
      shape.append(
        el("path", {
          d: `M 0 ${ry} A ${w / 2} ${ry} 0 0 1 ${w} ${ry} V ${h - ry} A ${w / 2} ${ry} 0 0 1 0 ${h - ry} Z`,
          ...attrs,
        }),
        el("path", {
          ...attrs,
          fill: "none",
          d: `M 0 ${ry} A ${w / 2} ${ry} 0 0 0 ${w} ${ry}`,
        }),
      );
    } else if (n.shape === "component") {
      shape = el("g");
      shape.append(
        el("rect", {
          x: 5,
          width: w - 5,
          height: h,
          rx: num(n.radius, 5, 0, 100),
          ...attrs,
        }),
      );
      for (const y of [h * 0.25, h * 0.65])
        shape.append(el("rect", { x: 0, y, width: 12, height: 7, ...attrs }));
    } else
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
    if (n.shape === "umlClass") {
      const c = classRows(n);
      text.setAttribute("y", c.header / 2);
      for (const [y, lines] of [
        [c.header, c.attrs],
        [c.divider, c.methods],
      ]) {
        group.append(
          el("line", { x1: 0, x2: w, y1: y, y2: y, stroke: attrs.stroke }),
        );
        lines.forEach((v, i) =>
          group.append(
            el(
              "text",
              {
                x: 8,
                y: y + 4 + (i + 0.78) * c.spacing,
                fill: safeColor(n.textColor, colors.text),
                "font-size": c.size,
                "font-family": "system-ui",
              },
              v,
            ),
          ),
        );
      }
    }
    group.append(text);
    if (editor && options.selected?.has(n.id)) {
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
  if (!editor && g.nodes.length) {
    // Include offset edge labels, long captions and self-loops in exports and previews.
    svg.style.cssText = "position:fixed;visibility:hidden;pointer-events:none";
    document.body.append(svg);
    const ink = svg.getBBox();
    svg.remove();
    svg.removeAttribute("style");
    if (ink.width && ink.height)
      svg.setAttribute(
        "viewBox",
        [
          ink.x - pad,
          ink.y - pad,
          ink.width + 2 * pad,
          ink.height + 2 * pad,
        ].join(" "),
      );
  }
  return svg;
}
