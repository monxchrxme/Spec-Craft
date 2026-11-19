import { arrangeNodes, routeEdges } from "./auto-layout.js";
import {
  normalize,
  draw,
  shapes,
  colors,
  uid,
  anchors,
  styleFrame,
} from "./graph.js";
const clone = (value) => structuredClone(value);
export function graphEditor(
  raw,
  panel,
  props,
  onChange,
  onDone,
  initialNode,
  trace,
) {
  let graph = normalize(raw),
    node = null,
    edge = null,
    link = null,
    connecting = false,
    zoom = 0.9,
    snap = false,
    drag = null,
    dirty = false,
    multi = false,
    activeModule = null;
  let selected = new Set(),
    panMode = false;
  const history = [],
    future = [];
  panel.className = "diagram-card inline-graph";
  panel.innerHTML = `
    <header class="diagram-title">
      <strong></strong><span class="spacer"></span><button data-cmd="save">Готово</button>
    </header>
    <div class="graph-tools" role="group" aria-label="Инструменты схемы">
      <select aria-label="Фигура"></select>
      <button data-cmd="add">+ Фигура</button>
      <button data-cmd="multi" aria-pressed="false">Выделение</button>
      <button data-cmd="pan" aria-pressed="false">Панорама</button>
      <button data-cmd="connect">Связать</button>
      <button data-cmd="layout" title="Расставить фигуры и проложить стрелки в выделении или на всей схеме">Авторасстановка</button>
      <button data-cmd="route" title="Перестроить связи в выделении или на всей схеме">Проложить стрелки</button>
      <button data-cmd="snap" aria-pressed="false">По сетке</button>
      <button data-cmd="undo" aria-label="Отменить действие">↶</button>
      <button data-cmd="redo" aria-label="Повторить действие">↷</button>
      <span class="spacer"></span>
      <button data-cmd="svg" title="Скачать схему как SVG">SVG</button>
      <button data-cmd="minus" aria-label="Уменьшить">−</button>
      <output></output><button data-cmd="plus" aria-label="Увеличить">+</button>
    </div>
    <div class="graph-placement">
      <div class="graph-stage graph-bg" tabindex="0" aria-label="Холст схемы"></div>
      <div class="graph-foot">
        <span role="status"></span><span class="spacer"></span>
        <button class="frame-grip" title="Потяните для изменения ширины и высоты" aria-label="Размер блока">Размер блока ◢</button>
      </div>
    </div>`;
  const shapePicker = panel.querySelector(".graph-tools select");
  for (const [shape, label] of Object.entries(shapes))
    shapePicker.add(new Option(label, shape));
  const placement = panel.querySelector(".graph-placement");
  const stage = panel.querySelector(".graph-stage"),
    hint = panel.querySelector("[role=status]");
  const current = () =>
    graph.nodes.find((n) => n.id === node) ||
    graph.edges.find((e) => e.id === edge) ||
    graph.modules?.find((m) => m.id === activeModule) ||
    graph;
  function select(ids, moduleId = null) {
    selected = new Set(ids);
    node = selected.size === 1 && !moduleId ? [...selected][0] : null;
    activeModule = moduleId;
    edge = null;
  }
  function tidyModules() {
    if (graph.modules)
      graph.modules = graph.modules.filter((m) =>
        graph.nodes.some((n) => n.moduleId === m.id),
      );
  }
  function deleteSelection() {
    if (drag || (!selected.size && !edge)) return;
    checkpoint();
    if (selected.size) {
      graph.nodes = graph.nodes.filter((n) => !selected.has(n.id));
      graph.edges = graph.edges.filter(
        (e) => !selected.has(e.from) && !selected.has(e.to),
      );
    } else graph.edges = graph.edges.filter((e) => e.id !== edge);
    if (selected.has(link)) link = null;
    tidyModules();
    select([]);
    refresh();
  }
  function handleDelete(e) {
    if (
      !["Backspace", "Delete"].includes(e.key) ||
      e.isComposing ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey ||
      e.target.closest("input,textarea,select,[contenteditable]")
    )
      return;
    if (!selected.size && !edge) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) deleteSelection();
  }
  panel.onkeydown = props.onkeydown = handleDelete;
  function publish() {
    if (!dirty) return;
    dirty = false;
    onChange(graph);
  }
  function checkpoint() {
    history.push(clone(graph));
    if (history.length > 80) history.shift();
    future.length = 0;
    dirty = true;
  }
  function render() {
    styleFrame(placement, graph);
    panel.querySelector(".diagram-title strong").textContent =
      graph.title || "Блок-схема";
    panel
      .querySelector("[data-cmd=multi]")
      .setAttribute("aria-pressed", String(multi));
    panel
      .querySelector("[data-cmd=pan]")
      .setAttribute("aria-pressed", String(panMode));
    stage.replaceChildren(
      draw(graph, { editor: true, zoom, selected, edge, module: activeModule }),
    );
    if (!drag) publish();
    panel.querySelector("output").textContent = Math.round(zoom * 100) + "%";
    panel.querySelector("[data-cmd=undo]").disabled = !history.length;
    panel.querySelector("[data-cmd=redo]").disabled = !future.length;
    panel
      .querySelector("[data-cmd=connect]")
      .setAttribute("aria-pressed", connecting);
    hint.textContent = connecting
      ? link
        ? "Выберите конечную фигуру"
        : "Выберите начальную фигуру"
      : selected.size > 1
        ? "Выбрано фигур: " + selected.size
        : "Shift + щелчок или рамка для выделения";
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
    if (!opts && ["textarea", "text"].includes(kind)) {
      let started = false;
      inp.onfocus = () => (started = false);
      inp.oninput = () => {
        if (!started) {
          checkpoint();
          started = true;
        } else dirty = true;
        current()[key] = inp.value;
        graph = normalize(graph);
        render();
      };
      l.append(inp);
      props.append(l);
      return;
    }
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
    const frameSettingsOpen = props.querySelector("details")?.open || false;
    props.replaceChildren();
    const picker = document.createElement("select");
    picker.setAttribute("aria-label", "Выбрать элемент схемы");
    picker.add(new Option("Вся схема", ""));
    graph.nodes.forEach((n, i) =>
      picker.add(new Option(n.label || n.id, "n" + i)),
    );
    (graph.modules || []).forEach((m, i) =>
      picker.add(new Option("Модуль · " + m.title, "m" + i)),
    );
    graph.edges.forEach((e, i) =>
      picker.add(
        new Option("Связь · " + (e.label || e.from + " → " + e.to), "e" + i),
      ),
    );
    if (selected.size > 1 && !activeModule) {
      const summary = new Option(
        "Выделено фигур: " + selected.size,
        "selection",
      );
      summary.disabled = true;
      picker.add(summary);
    }
    picker.value = activeModule
      ? "m" + graph.modules.findIndex((m) => m.id === activeModule)
      : node
        ? "n" + graph.nodes.findIndex((n) => n.id === node)
        : edge
          ? "e" + graph.edges.findIndex((e) => e.id === edge)
          : selected.size > 1
            ? "selection"
            : "";
    picker.onchange = () => {
      const key = picker.value,
        idx = Number(key.slice(1));
      if (key.startsWith("m")) {
        const id = graph.modules[idx].id;
        select(
          graph.nodes.filter((n) => n.moduleId === id).map((n) => n.id),
          id,
        );
      } else if (key.startsWith("n") && multi) {
        const id = graph.nodes[idx].id,
          ids = new Set(selected);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        select(ids);
      } else select(key.startsWith("n") ? [graph.nodes[idx].id] : []);
      edge = key.startsWith("e") ? graph.edges[idx].id : null;
      refresh();
      stage.focus({ preventScroll: true });
    };
    props.append(picker);
    const head = document.createElement("h3");
    head.textContent = activeModule
      ? "Модуль"
      : selected.size > 1
        ? "Выделено: " + selected.size
        : node
          ? "Фигура"
          : edge
            ? "Связь"
            : "Схема";
    props.append(head);
    if (selected.size > 1 || activeModule) {
      if (activeModule) {
        field("Название модуля", "title", "text", "Модуль");
        field("Цвет модуля", "color", "color", "#7b72bc");
        action("Разгруппировать", () => {
          checkpoint();
          for (const n of graph.nodes)
            if (n.moduleId === activeModule) delete n.moduleId;
          tidyModules();
          select(selected);
          refresh();
        });
      } else
        action("Объединить в модуль", () => {
          checkpoint();
          const id = uid("m");
          (graph.modules ??= []).push({
            id,
            title: "Модуль " + (graph.modules.length + 1),
            color: "#7b72bc",
          });
          for (const n of graph.nodes) if (selected.has(n.id)) n.moduleId = id;
          tidyModules();
          select(selected, id);
          refresh();
        });
      if (selected.size > 1) {
        const align = document.createElement("select");
        align.setAttribute("aria-label", "Способ выравнивания");
        for (const [v, name] of [
          ["left", "По левому краю"],
          ["cx", "По центру по горизонтали"],
          ["right", "По правому краю"],
          ["top", "По верхнему краю"],
          ["cy", "По центру по вертикали"],
          ["bottom", "По нижнему краю"],
        ])
          align.add(new Option(name, v));
        props.append(align);
        action("Выровнять", () => {
          checkpoint();
          const members = graph.nodes.filter((n) => selected.has(n.id));
          const xs = members.map((n) => n.x),
            ys = members.map((n) => n.y);
          const left = Math.min(...xs),
            top = Math.min(...ys),
            right = Math.max(...members.map((n) => n.x + n.width)),
            bottom = Math.max(...members.map((n) => n.y + n.height));
          for (const n of members)
            switch (align.value) {
              case "left":
                n.x = left;
                break;
              case "right":
                n.x = right - n.width;
                break;
              case "cx":
                n.x = (left + right - n.width) / 2;
                break;
              case "top":
                n.y = top;
                break;
              case "bottom":
                n.y = bottom - n.height;
                break;
              case "cy":
                n.y = (top + bottom - n.height) / 2;
                break;
            }
          refresh();
        });
      }
    } else if (node) {
      action(
        current().pinned ? "Открепить позицию" : "Закрепить позицию",
        () => {
          checkpoint();
          current().pinned = !current().pinned;
          refresh();
        },
      );
      field("Подпись", "label", "textarea", "");
      field("Форма", "shape", "text", "process", shapes);
      if (current().shape === "umlClass") {
        field("Атрибуты класса", "attributes", "textarea", "");
        field("Методы класса", "methods", "textarea", "");
      }
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
      const attached = Array.isArray(current().requirements)
        ? current().requirements.filter((s) => typeof s === "string")
        : [];
      if (trace) {
        const title = document.createElement("h3");
        title.textContent = "Требования фигуры";
        props.append(title);
        for (const id of attached) {
          const row = document.createElement("div");
          row.className = "node-requirement";
          const jump = document.createElement("button");
          jump.textContent = id;
          jump.onclick = () => trace.open(id);
          const detach = document.createElement("button");
          detach.textContent = "×";
          detach.setAttribute("aria-label", "Отвязать " + id);
          detach.onclick = () => {
            checkpoint();
            current().requirements = attached.filter((s) => s !== id);
            refresh();
          };
          row.append(jump, detach);
          props.append(row);
        }
        const add = document.createElement("select");
        add.setAttribute("aria-label", "Связать с требованием");
        add.add(new Option("Связать с требованием…", ""));
        for (const r of trace.requirements)
          if (!attached.some((s) => s.toUpperCase() === r.id))
            add.add(new Option(r.label, r.id));
        add.disabled = add.options.length === 1;
        add.onchange = () => {
          if (!add.value) return;
          checkpoint();
          current().requirements = [...attached, add.value];
          refresh();
        };
        props.append(add);
      }
      action("Дублировать фигуру", () => {
        checkpoint();
        const original = current();
        const copy = {
          ...clone(original),
          id: uid("n"),
          x: original.x + 30,
          y: original.y + 30,
        };
        graph.nodes.push(copy);
        select([copy.id]);
        refresh();
      });
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
        curve: "Кривая",
      });
      field("Наконечник", "arrow", "text", "end", {
        end: "Стрелка",
        none: "Без стрелки",
        inheritance: "Наследование",
        aggregation: "Агрегация",
        composition: "Композиция",
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
    if (selected.size && !activeModule && graph.modules?.length) {
      const wrap = document.createElement("label");
      wrap.textContent = "Принадлежность к модулю";
      const assignment = document.createElement("select");
      assignment.add(new Option("Без модуля", ""));
      graph.modules.forEach((m) => assignment.add(new Option(m.title, m.id)));
      const memberships = new Set(
        graph.nodes
          .filter((n) => selected.has(n.id))
          .map((n) => n.moduleId || ""),
      );
      if (memberships.size > 1) {
        const mixed = new Option("Разные модули", "__mixed");
        mixed.disabled = true;
        assignment.add(mixed);
        assignment.value = mixed.value;
      } else assignment.value = [...memberships][0];
      assignment.onchange = () => {
        checkpoint();
        for (const n of graph.nodes)
          if (selected.has(n.id)) {
            if (assignment.value) n.moduleId = assignment.value;
            else delete n.moduleId;
          }
        tidyModules();
        refresh();
      };
      wrap.append(assignment);
      props.append(wrap);
    }
    if (selected.size || edge)
      action(
        selected.size > 1
          ? "Удалить выделенные фигуры"
          : node || activeModule
            ? "Удалить фигуру"
            : "Удалить связь",
        deleteSelection,
      );
    const details = document.createElement("details");
    details.open = frameSettingsOpen;
    const summary = document.createElement("summary");
    summary.textContent = "Размещение в документе";
    details.append(summary);
    props.append(details);
    const layout = graph.layout || {};
    function layoutField(label, key, def, options, min, max) {
      const wrap = document.createElement("label");
      wrap.textContent = label;
      const input = document.createElement(options ? "select" : "input");
      if (options)
        Object.entries(options).forEach(([v, t]) =>
          input.add(new Option(t, v)),
        );
      else {
        input.type = "number";
        input.min = min;
        input.max = max;
      }
      input.value = layout[key] ?? def;
      input.onchange = () => {
        checkpoint();
        (graph.layout ??= {})[key] = options
          ? input.value
          : Math.min(max, Math.max(min, Number(input.value) || 0));
        if (key === "height" && graph.layout.height > 0)
          graph.layout.height = Math.max(150, graph.layout.height);
        input.value = graph.layout[key];
        render();
      };
      wrap.append(input);
      details.append(wrap);
    }
    layoutField("Ширина блока, %", "width", 100, null, 25, 100);
    layoutField("Высота, px (0 — авто)", "height", 0, null, 0, 1400);
    layoutField("Положение", "align", "left", {
      left: "Слева",
      center: "По центру",
      right: "Справа",
    });
    layoutField("Вписывание", "fit", "actual", {
      actual: "Натуральный размер",
      contain: "Целиком",
      width: "По ширине",
    });
  }
  function refresh() {
    render();
    inspector();
  }
  panel.onclick = (e) => {
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
      publish();
      onDone();
      return;
    }
    if (cmd === "layout" || cmd === "route") {
      const scope =
        selected.size > 1 || activeModule || (cmd === "route" && selected.size)
          ? selected
          : new Set(graph.nodes.map((n) => n.id));
      const next = clone(graph);
      try {
        if (cmd === "layout") arrangeNodes(next, scope);
        const missed = routeEdges(next, scope, cmd === "route" ? edge : null);
        if (JSON.stringify(next) !== JSON.stringify(graph)) {
          checkpoint();
          graph = next;
        }
        refresh();
        hint.textContent = missed
          ? "Не удалось обойти фигуры для связей: " +
            missed +
            ". Раздвиньте соседние фигуры."
          : "Готово · " +
            (cmd === "route" && edge
              ? "выбранная связь"
              : scope.size === graph.nodes.length
                ? "вся схема"
                : "выделенные фигуры");
      } catch (error) {
        hint.textContent = error.message;
      }
      return;
    }
    if (cmd === "add") {
      checkpoint();
      const id = uid("n"),
        shape = shapePicker.value;
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
        width: shape === "umlClass" ? 190 : 140,
        height: shape === "umlClass" ? 110 : 60,
        ...(shape === "umlClass"
          ? { attributes: "+ id", methods: "+ выполнить()" }
          : {}),
      });
      select([id]);
    }
    if (cmd === "multi") {
      multi = !multi;
      connecting = false;
      panMode = false;
      link = null;
    }
    if (cmd === "pan") {
      panMode = !panMode;
      multi = connecting = false;
      link = null;
    }
    if (cmd === "snap") {
      snap = !snap;
      panel
        .querySelector('[data-cmd="snap"]')
        .setAttribute("aria-pressed", String(snap));
    }
    if (cmd === "connect") {
      connecting = !connecting;
      panMode = multi = false;
      link = null;
    }
    if (cmd === "plus") zoom = Math.min(2.5, zoom + 0.15);
    if (cmd === "minus") zoom = Math.max(0.25, zoom - 0.15);
    if (cmd === "undo" && history.length) {
      future.push(clone(graph));
      graph = history.pop();
      select([]);
      link = null;
      dirty = true;
    }
    if (cmd === "redo" && future.length) {
      history.push(clone(graph));
      graph = future.pop();
      select([]);
      link = null;
      dirty = true;
    }
    refresh();
  };
  const grip = panel.querySelector(".frame-grip");
  grip.onclick = () => {
    props.querySelector("details").open = true;
    props.querySelector("details").scrollIntoView({ block: "nearest" });
  };
  let frameDrag = null;
  grip.onpointerdown = (e) => {
    if (e.button !== 0) return;
    frameDrag = {
      x: e.clientX,
      y: e.clientY,
      width: placement.offsetWidth,
      height: stage.clientHeight,
      available: panel.clientWidth,
      multiplier:
        graph.layout?.align === "right"
          ? -1
          : graph.layout?.align === "center"
            ? 2
            : 1,
    };
    grip.setPointerCapture(e.pointerId);
  };
  grip.onpointermove = (e) => {
    if (!frameDrag) return;
    const dx = e.clientX - frameDrag.x,
      dy = e.clientY - frameDrag.y;
    if (!frameDrag.started && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!frameDrag.started) {
      checkpoint();
      frameDrag.started = true;
    }
    const layout = (graph.layout ??= {});
    layout.width = Math.max(
      25,
      Math.min(
        100,
        Math.round(
          ((frameDrag.width + dx * frameDrag.multiplier) * 100) /
            frameDrag.available,
        ),
      ),
    );
    layout.height = Math.max(
      150,
      Math.min(1400, Math.round(frameDrag.height + dy)),
    );
    styleFrame(placement, graph);
  };
  grip.onpointerup = grip.onpointercancel = () => {
    if (frameDrag?.started) {
      publish();
      inspector();
    }
    frameDrag = null;
  };
  function position(e) {
    const rect = stage.querySelector("svg").getBoundingClientRect();
    const origin = stage.querySelector("svg").viewBox.baseVal;
    return {
      x: origin.x + (e.clientX - rect.left) / zoom,
      y: origin.y + (e.clientY - rect.top) / zoom,
    };
  }
  function internalPoints() {
    return graph.edges
      .filter((e) => selected.has(e.from) && selected.has(e.to))
      .flatMap((e) => e.points || []);
  }
  stage.onpointerdown = (e) => {
    if (e.button !== 0 || drag || !e.target.closest("svg")) return;
    // Redrawing replaces the pressed SVG node. Keep keyboard focus on the canvas.
    e.preventDefault();
    stage.focus({ preventScroll: true });
    if (panMode) {
      drag = {
        type: "pan",
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: stage.scrollLeft,
        top: stage.scrollTop,
      };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    const n = e.target.closest("[data-node]")?.dataset.node,
      ed = e.target.closest("[data-edge]")?.dataset.edge,
      m = e.target.closest("[data-module]")?.dataset.module;
    if (connecting && n) {
      if (link) {
        checkpoint();
        const id = uid("e");
        graph.edges.push({ id, from: link, to: n });
        select([]);
        edge = id;
        link = null;
        connecting = false;
      } else {
        select([n]);
        link = n;
      }
      refresh();
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey || multi;
    const start = position(e);
    const alreadySelected = selected.has(n);
    if (n) {
      if (!alreadySelected) select(additive ? [...selected, n] : [n]);
    } else if (m) {
      select(
        graph.nodes.filter((n) => n.moduleId === m).map((n) => n.id),
        m,
      );
    } else {
      if (!additive || ed) select([]);
      edge = ed || null;
    }
    const point = e.target.dataset.point;
    if (n || m) {
      const resize = e.target.hasAttribute("data-size") && selected.size === 1;
      const targets = graph.nodes.filter((n) => selected.has(n.id));
      drag = {
        type: resize ? "size" : "move",
        tapSelection:
          n && alreadySelected && !resize
            ? additive
              ? [...selected].filter((id) => id !== n)
              : [n]
            : null,
        start,
        targets: [...targets, ...internalPoints()].map((p) => ({
          p,
          x: p.x,
          y: p.y,
        })),
        node: targets[0],
        w: targets[0].width,
        h: targets[0].height,
      };
    } else if (point !== undefined) {
      const p = current().points[Number(point)];
      drag = { type: "move", start, targets: [{ p, x: p.x, y: p.y }] };
    } else if (!ed) {
      drag = { type: "box", start, base: new Set(selected) };
    }
    if (drag) {
      drag.id = e.pointerId;
      stage.setPointerCapture(e.pointerId);
    }
    refresh();
  };
  stage.onpointermove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.type === "pan") {
      stage.scrollLeft = drag.left + drag.x - e.clientX;
      stage.scrollTop = drag.top + drag.y - e.clientY;
      return;
    }
    const end = position(e),
      dx = end.x - drag.start.x,
      dy = end.y - drag.start.y;
    if (!drag.started && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!drag.started) {
      if (drag.type !== "box") checkpoint();
      drag.started = true;
    }
    const round = (v) => (snap ? Math.round(v / 14) * 14 : Math.round(v));
    if (drag.type === "box") {
      const left = Math.min(end.x, drag.start.x),
        top = Math.min(end.y, drag.start.y),
        right = Math.max(end.x, drag.start.x),
        bottom = Math.max(end.y, drag.start.y);
      const hits = graph.nodes.filter(
        (n) =>
          n.x + n.width >= left &&
          n.x <= right &&
          n.y + n.height >= top &&
          n.y <= bottom,
      );
      select([...drag.base, ...hits.map((n) => n.id)]);
      render();
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      for (const [k, v] of Object.entries({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        fill: "#7960d6",
        "fill-opacity": 0.12,
        stroke: "#6954bc",
        "pointer-events": "none",
      }))
        rect.setAttribute(k, v);
      stage.querySelector("svg").append(rect);
    } else if (drag.type === "size") {
      drag.node.width = Math.max(45, Math.min(2000, round(drag.w + dx)));
      drag.node.height = Math.max(28, Math.min(1500, round(drag.h + dy)));
      render();
    } else {
      const first = drag.targets[0],
        xDelta = round(first.x + dx) - first.x,
        yDelta = round(first.y + dy) - first.y;
      const minX = Math.min(...drag.targets.map((t) => t.x)),
        minY = Math.min(...drag.targets.map((t) => t.y));
      for (const t of drag.targets) {
        t.p.x = t.x + Math.max(-minX, xDelta);
        t.p.y = t.y + Math.max(-minY, yDelta);
      }
      render();
    }
  };
  stage.onpointerup = stage.onpointercancel = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (e.type === "pointerup" && !drag.started && drag.tapSelection)
      select(drag.tapSelection);
    drag = null;
    if (dirty) graph = normalize(graph);
    refresh();
  };
  if (initialNode && graph.nodes.some((n) => n.id === initialNode))
    select([initialNode]);
  refresh();
  if (node) {
    stage
      .querySelector('[data-node="' + CSS.escape(node) + '"]')
      ?.scrollIntoView({ block: "center", inline: "center" });
    stage.focus({ preventScroll: true });
  }
  return publish;
}
