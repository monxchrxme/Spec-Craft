import { checkDiagram } from "./graph-check.js";
import { layoutProposals, routeEdges } from "./auto-layout.js";
import { downloadSvg } from "./diagram-download.js";
import {
  normalize,
  draw,
  shapes,
  colors,
  uid,
  anchors,
  routePoints,
  editableSegments,
  sameSegment,
  samePoint,
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
  { expanded = false, zoom: initialZoom } = {},
) {
  let graph = normalize(raw),
    node = null,
    link = null,
    connecting = false,
    zoom = initialZoom ? Math.max(0.05, Math.min(2.5, initialZoom)) : 0.9,
    snap = false,
    drag = null,
    activeSegment = null,
    showChecks = false,
    dirty = false,
    multi = false,
    activeModule = null;
  let selected = new Set(),
    selectedEdges = new Set(),
    panMode = false;
  const history = [],
    future = [];
  let layoutPreview = null;
  panel.className = "diagram-card inline-graph";
  panel.classList.toggle("diagram-expanded", expanded);
  panel.innerHTML = `
    <header class="diagram-title">
      <strong></strong><span class="spacer"></span>
      <button type="button" data-view-expand><i data-lucide="maximize-2" aria-hidden="true"></i><span></span></button>
      <button data-cmd="save">Готово</button>
    </header>
    <div class="graph-tools" role="group" aria-label="Инструменты схемы">
      <select aria-label="Фигура"></select>
      <button data-cmd="add">+ Фигура</button>
      <button data-cmd="multi" aria-pressed="false">Выделение</button>
      <button data-cmd="pin" aria-pressed="false" aria-label="Закрепить позиции" title="Закрепить позиции для авторасстановки" disabled><i data-lucide="pin" aria-hidden="true"></i></button>
      <button data-cmd="pan" title="Перетаскивать видимую область холста мышью или пальцем" aria-pressed="false">Перемещать холст</button>
      <button data-cmd="connect">Связать</button>
      <button data-cmd="route" title="Перестроить связи в выделении или на всей схеме">Проложить стрелки</button>
      <button data-cmd="check" aria-pressed="false">Проверить схему</button>
      <button data-cmd="snap" aria-pressed="false">По сетке</button>
      <button data-cmd="undo" aria-label="Отменить действие">↶</button>
      <button data-cmd="redo" aria-label="Повторить действие">↷</button>
      <span class="spacer"></span>
      <button data-cmd="svg" title="Скачать схему как SVG">SVG</button>
      <button data-cmd="minus" aria-label="Уменьшить">−</button>
      <output></output><button data-cmd="plus" aria-label="Увеличить">+</button>
    </div>
    <div class="graph-layout-tools" role="group" aria-label="Авторасстановка схемы">
      <label>Раскладка
        <select aria-label="Вариант авторасстановки" data-layout-variant>
          <option value="explore">Разные варианты</option>
          <option value="horizontal">Поток слева направо</option>
          <option value="vertical">Поток сверху вниз</option>
          <option value="grid">Компактная сетка</option>
          <option value="radial">От центра</option>
        </select>
      </label>
      <button data-cmd="layout" aria-expanded="false" title="Предпросмотр позиций фигур и маршрутов стрелок">Авторасстановка</button>
    </div>
    <section class="graph-layout-preview" aria-label="Предпросмотр авторасстановки" hidden>
      <div class="layout-preview-controls">
        <button data-cmd="layout-previous" aria-label="Предыдущий вариант">←</button>
        <span data-layout-label></span>
        <button data-cmd="layout-next" aria-label="Следующий вариант">→</button>
        <button data-cmd="layout-original" aria-pressed="false">Исходная схема</button>
        <span class="spacer"></span>
        <button data-cmd="layout-cancel">Отменить</button>
        <button data-cmd="layout-apply" class="primary">Применить</button>
      </div>
      <p data-layout-status role="status"></p>
    </section>
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
    hint = panel.querySelector(".graph-foot [role=status]");
  const layoutPicker = panel.querySelector("[data-layout-variant]");
  const previewControls = panel.querySelector(".graph-layout-preview");
  const command = (name) => panel.querySelector('[data-cmd="' + name + '"]');
  const editingControls = [
    ...panel.querySelectorAll(
      '.graph-tools :is(button, select):not([data-cmd="plus"], [data-cmd="minus"], [data-cmd="undo"], [data-cmd="redo"])',
    ),
    panel.querySelector(".frame-grip"),
  ];
  const singleEdge = () =>
    selectedEdges.size === 1 ? selectedEdges.values().next().value : null;
  const current = () =>
    graph.nodes.find((n) => n.id === node) ||
    graph.edges.find((e) => e.id === singleEdge()) ||
    graph.modules?.find((m) => m.id === activeModule) ||
    graph;
  function select(ids, moduleId = null) {
    selected = new Set(ids);
    node = selected.size === 1 && !moduleId ? [...selected][0] : null;
    activeModule = moduleId;
    selectedEdges.clear();
    activeSegment = null;
  }
  function togglePinned() {
    const nodes = graph.nodes.filter(({ id }) => selected.has(id));
    if (!nodes.length) return;
    const pinned = !nodes.some((node) => node.pinned);
    checkpoint();
    for (const node of nodes)
      if (Boolean(node.pinned) !== pinned) node.pinned = pinned;
    refresh();
  }
  function selectEdge(id, additive = false) {
    const ids = additive ? new Set(selectedEdges) : new Set();
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    select([]);
    selectedEdges = ids;
  }
  function tidyModules() {
    if (graph.modules)
      graph.modules = graph.modules.filter((m) =>
        graph.nodes.some((n) => n.moduleId === m.id),
      );
  }
  function deleteSelection() {
    if (drag || (!selected.size && !selectedEdges.size)) return;
    checkpoint();
    if (selected.size) {
      graph.nodes = graph.nodes.filter((n) => !selected.has(n.id));
      graph.edges = graph.edges.filter(
        (e) => !selected.has(e.from) && !selected.has(e.to),
      );
    } else graph.edges = graph.edges.filter((e) => !selectedEdges.has(e.id));
    if (selected.has(link)) link = null;
    tidyModules();
    select([]);
    refresh();
  }
  function handleDelete(e) {
    if (layoutPreview) return;
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
    if (!selected.size && !selectedEdges.size) return;
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
    const proposed =
      layoutPreview && !layoutPreview.original
        ? layoutPreview.candidates[layoutPreview.index]?.graph
        : null;
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
      draw(proposed || graph, {
        editor: true,
        zoom,
        selected: layoutPreview ? null : selected,
        edges: layoutPreview ? null : selectedEdges,
        edge: layoutPreview ? null : singleEdge(),
        module: layoutPreview ? null : activeModule,
        segment: layoutPreview ? null : activeSegment,
      }),
    );
    panel
      .querySelector("[data-cmd=check]")
      .setAttribute("aria-pressed", String(showChecks));
    if (!drag) publish();
    panel.querySelector("output").textContent = Math.round(zoom * 100) + "%";
    command("undo").disabled = !!layoutPreview || !history.length;
    command("redo").disabled = !!layoutPreview || !future.length;
    const pin = command("pin");
    const pinned = graph.nodes.filter(
      (node) => selected.has(node.id) && node.pinned,
    ).length;
    const pinLabel = pinned ? "Открепить позиции" : "Закрепить позиции";
    pin.disabled = !!layoutPreview || !selected.size;
    pin.title = pinLabel + " выбранных фигур";
    pin.setAttribute("aria-label", pinLabel);
    pin.setAttribute(
      "aria-pressed",
      pinned && pinned < selected.size ? "mixed" : String(!!pinned),
    );
    panel
      .querySelector("[data-cmd=connect]")
      .setAttribute("aria-pressed", connecting);
    stage.classList.toggle("is-panning", panMode || !!layoutPreview);
    hint.textContent = panMode
      ? "Перетащите холст мышью или пальцем, чтобы увидеть другую часть схемы."
      : connecting
        ? link
          ? "Выберите конечную фигуру"
          : "Выберите начальную фигуру"
        : selectedEdges.size
          ? "Выбрано стрелок: " + selectedEdges.size
          : selected.size > 1
            ? "Выбрано фигур: " + selected.size
            : "Shift + щелчок по стрелкам или фигурам · рамка для фигур";
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
      const record = current();
      record[key] = v;
      if (key === "route" && v !== "orthogonal") delete record.lockedSegments;
      graph = normalize(graph);
      if (node && ["width", "height", "shape"].includes(key))
        reroutePinned(new Set([node]));
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
  function connectionPoints(connection) {
    const a = graph.nodes.find((n) => n.id === connection.from),
      b = graph.nodes.find((n) => n.id === connection.to);
    return routePoints(a, b, connection);
  }
  function segmentsOf(connection) {
    return editableSegments(connectionPoints(connection), connection);
  }
  function reroutePinned(ids) {
    const pinned = graph.edges.filter(
      (connection) => connection.lockedSegments?.length,
    );
    return pinned.length ? routeEdges({ ...graph, edges: pinned }, ids) : 0;
  }
  function reshapeSegment(connection, segment, replacement, pin) {
    const locks = [...(connection.lockedSegments || [])];
    const original = locks.findIndex((item) => sameSegment(item, segment));
    const route = connectionPoints(connection);
    const position =
      original >= 0
        ? original
        : locks.filter((item) => {
            const i = route.findIndex(([x, y]) =>
              samePoint({ x, y }, item.from),
            );
            return i >= 0 && i < segment.index;
          }).length;
    locks.splice(position, original >= 0 ? 1 : 0, replacement);
    const next = { ...connection, lockedSegments: locks };
    if (routeEdges({ ...graph, edges: [next] }, new Set(), new Set([next.id])))
      return null;
    if (!pin && original < 0) {
      locks.splice(position, 1);
      if (!locks.length) delete next.lockedSegments;
    }
    return next;
  }
  function replaceEdge(connection) {
    graph.edges[graph.edges.findIndex((item) => item.id === connection.id)] =
      connection;
  }
  function focusIssue(issue) {
    select(issue.node ? [issue.node] : []);
    if (!issue.node && issue.edge !== undefined) selectEdge(issue.edge);
    refresh();
    const svg = stage.querySelector("svg"),
      rect = stage.getBoundingClientRect();
    const [x, y] = issue.point;
    const screen = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    stage.scrollLeft += screen.x - rect.left - stage.clientWidth / 2;
    stage.scrollTop += screen.y - rect.top - stage.clientHeight / 2;
    stage.scrollIntoView({ block: "nearest" });
    stage.focus({ preventScroll: true });
  }
  function renderChecks() {
    if (!showChecks) return;
    const box = document.createElement("section");
    box.className = "diagram-checks";
    const results = checkDiagram(graph, stage.querySelector("svg"));
    const title = document.createElement("h3");
    title.textContent = results.length
      ? "Замечания · " + results.length
      : "Замечаний по схеме нет";
    box.append(title);
    for (const issue of results) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = issue.type + " · " + issue.text;
      item.onclick = () => focusIssue(issue);
      box.append(item);
    }
    props.append(box);
  }
  function inspector() {
    const frameSettingsOpen = props.querySelector("details")?.open || false;
    props.replaceChildren();
    renderChecks();
    const picker = document.createElement("select");
    const edge = singleEdge();
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
    if ((selected.size > 1 && !activeModule) || selectedEdges.size > 1) {
      const summary = new Option(
        selectedEdges.size
          ? "Выделено стрелок: " + selectedEdges.size
          : "Выделено фигур: " + selected.size,
        "selection",
      );
      summary.disabled = true;
      picker.add(summary);
    }
    picker.value = activeModule
      ? "m" + graph.modules.findIndex((m) => m.id === activeModule)
      : node
        ? "n" + graph.nodes.findIndex((n) => n.id === node)
        : edge !== null
          ? "e" + graph.edges.findIndex((e) => e.id === edge)
          : selected.size > 1 || selectedEdges.size > 1
            ? "selection"
            : "";
    picker.onchange = () => {
      const key = picker.value,
        idx = Number(key.slice(1));
      if (key.startsWith("e")) selectEdge(graph.edges[idx].id, multi);
      else if (key.startsWith("m")) {
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
          : selectedEdges.size > 1
            ? "Выделено стрелок: " + selectedEdges.size
            : edge !== null
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
        togglePinned,
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
    } else if (edge !== null) {
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
      const connection = current();
      const segments = segmentsOf(connection);
      if (segments.length) {
        const selectSegment = document.createElement("select");
        selectSegment.setAttribute("aria-label", "Участок маршрута");
        selectSegment.add(new Option("Выберите участок маршрута", ""));
        segments.forEach((part, i) =>
          selectSegment.add(
            new Option(
              "Участок " + (i + 1) + (part.locked >= 0 ? " · закреплён" : ""),
              String(i),
            ),
          ),
        );
        const selectedIndex = segments.findIndex((part) =>
          sameSegment(part, activeSegment),
        );
        selectSegment.value = selectedIndex < 0 ? "" : String(selectedIndex);
        selectSegment.onchange = () => {
          activeSegment =
            selectSegment.value === ""
              ? null
              : segments[Number(selectSegment.value)];
          refresh();
        };
        props.append(selectSegment);
        if (selectedIndex >= 0) {
          const part = segments[selectedIndex];
          action(
            part.locked >= 0 ? "Открепить участок" : "Закрепить участок",
            () => {
              if (part.locked >= 0) {
                checkpoint();
                connection.lockedSegments.splice(part.locked, 1);
                if (!connection.lockedSegments.length)
                  delete connection.lockedSegments;
              } else {
                const replacement = { from: part.from, to: part.to };
                const next = reshapeSegment(
                  connection,
                  part,
                  replacement,
                  true,
                );
                if (!next) {
                  hint.textContent =
                    "Не удалось проложить маршрут через участок.";
                  return;
                }
                checkpoint();
                replaceEdge(next);
                activeSegment = replacement;
              }
              refresh();
            },
          );
        }
      }
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
          delete current().lockedSegments;
          activeSegment = null;
          refresh();
        });
    } else if (selectedEdges.size) {
      const description = document.createElement("p");
      description.textContent =
        "«Проложить стрелки» перестроит только эти связи.";
      props.append(description);
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
    if (selected.size || selectedEdges.size)
      action(
        selected.size > 1
          ? "Удалить выделенные фигуры"
          : node || activeModule
            ? "Удалить фигуру"
            : selectedEdges.size > 1
              ? "Удалить выделенные связи"
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
  function layoutMode(enabled) {
    previewControls.hidden = !enabled;
    command("layout").setAttribute("aria-expanded", String(enabled));
    props.inert = enabled;
    for (const control of editingControls) control.disabled = enabled;
    const remove = panel.querySelector(".diagram-remove");
    if (remove) remove.disabled = enabled;
  }
  function showLayout() {
    const { candidates, index, original, scope, error, exhausted } =
      layoutPreview;
    const choice = candidates[index];
    previewControls.querySelector("[data-layout-label]").textContent = choice
      ? "Вариант " + (index + 1)
      : "Предпросмотр";
    previewControls.querySelector("[data-layout-status]").textContent = original
      ? "Показана исходная схема. Нажмите ещё раз, чтобы вернуться к варианту."
      : error ||
        (choice
          ? "Перемещено фигур: " +
            choice.moved +
            "." +
            (choice.missed
              ? " Связей без нового маршрута: " + choice.missed + "."
              : "") +
            (exhausted ? " Выберите другую раскладку для новых вариантов." : "")
          : "В этом режиме нет другой расстановки для выбранных фигур. Попробуйте изменить выделение или раскладку.");
    command("layout-original").setAttribute("aria-pressed", String(original));
    command("layout-original").disabled = !choice;
    command("layout-apply").disabled = !choice || original;
    command("layout-previous").disabled = index < 1;
    command("layout-next").disabled =
      exhausted && index >= candidates.length - 1;
    const nodes = (original ? graph : choice?.graph)?.nodes.filter(({ id }) =>
      scope.has(id),
    );
    if (!nodes?.length) {
      render();
      return;
    }
    const left = Math.min(...nodes.map(({ x }) => x));
    const top = Math.min(...nodes.map(({ y }) => y));
    const width = Math.max(...nodes.map(({ x, width }) => x + width)) - left;
    const height = Math.max(...nodes.map(({ y, height }) => y + height)) - top;
    zoom = Math.max(
      0.04,
      Math.min(
        1.2,
        (stage.clientWidth - 36) / width,
        (stage.clientHeight - 36) / height,
      ),
    );
    render();
    const view = stage.querySelector("svg").viewBox.baseVal;
    stage.scrollLeft = (left - view.x) * zoom - 16;
    stage.scrollTop = (top - view.y) * zoom - 16;
  }
  function moveLayout(delta) {
    const state = layoutPreview;
    const index = state.index + delta;
    if (index < 0) return;
    if (index === state.candidates.length && !state.exhausted) {
      try {
        const choice = state.propose();
        if (choice) state.candidates.push(choice);
        else state.exhausted = true;
      } catch (error) {
        state.exhausted = true;
        state.error = error.message;
      }
    }
    if (state.candidates[index]) state.index = index;
    state.original = false;
    showLayout();
  }
  function beginLayout() {
    const scope =
      selected.size > 1 || activeModule
        ? new Set(selected)
        : new Set(graph.nodes.map(({ id }) => id));
    const error =
      graph.nodes.length < 2
        ? "Добавьте хотя бы две фигуры для авторасстановки."
        : graph.nodes.some((node) => scope.has(node.id) && !node.pinned)
          ? ""
          : "В выбранной области все фигуры закреплены. Снимите закрепление или измените выделение.";
    const view = layoutPreview?.view || {
      zoom,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    layoutPreview = {
      scope,
      view,
      index: -1,
      candidates: [],
      propose: layoutProposals(graph, scope, layoutPicker.value),
      original: false,
      exhausted: !!error,
      error,
    };
    layoutMode(true);
    moveLayout(1);
  }
  function endLayout(apply) {
    const state = layoutPreview;
    const result = apply && !state.original && state.candidates[state.index];
    layoutPreview = null;
    layoutMode(false);
    if (result) {
      checkpoint();
      graph = result.graph;
      activeSegment = null;
    } else zoom = state.view.zoom;
    refresh();
    if (!result) {
      stage.scrollLeft = state.view.left;
      stage.scrollTop = state.view.top;
    }
    command("layout").focus({ preventScroll: true });
    hint.textContent = result
      ? "Раскладка применена. Перемещено фигур: " + result.moved + "."
      : "Предпросмотр закрыт.";
  }
  layoutPicker.onchange = beginLayout;
  panel.onclick = (e) => {
    const cmd = e.target.closest("[data-cmd]")?.dataset.cmd;
    if (!cmd) return;
    if (cmd === "layout") {
      if (layoutPreview) moveLayout(1);
      else beginLayout();
      return;
    }
    if (layoutPreview) {
      if (cmd === "layout-next") moveLayout(1);
      else if (cmd === "layout-previous") moveLayout(-1);
      else if (cmd === "layout-original") {
        layoutPreview.original = !layoutPreview.original;
        showLayout();
      } else if (cmd === "layout-apply" || cmd === "layout-cancel")
        endLayout(cmd === "layout-apply");
      else if (cmd === "plus" || cmd === "minus") {
        zoom = Math.max(
          0.04,
          Math.min(2.5, zoom + (cmd === "plus" ? 0.15 : -0.15)),
        );
        render();
      } else if (cmd === "save") onDone();
      return;
    }
    if (cmd === "svg") {
      downloadSvg(
        new XMLSerializer().serializeToString(draw(graph)),
        graph.title || "Схема",
      );
      return;
    }
    if (cmd === "pin") {
      togglePinned();
      return;
    }
    if (cmd === "save") {
      publish();
      onDone();
      return;
    }
    if (cmd === "check") {
      showChecks = !showChecks;
      refresh();
      if (showChecks)
        props
          .querySelector(".diagram-checks")
          ?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (cmd === "route") {
      const onlyEdges = selectedEdges.size ? selectedEdges : null;
      const scope =
        selected.size || activeModule
          ? selected
          : new Set(graph.nodes.map(({ id }) => id));
      const next = clone(graph);
      const missed = routeEdges(next, scope, onlyEdges);
      if (JSON.stringify(next) !== JSON.stringify(graph)) {
        checkpoint();
        graph = next;
        activeSegment = null;
      }
      refresh();
      hint.textContent = missed
        ? "Не удалось обойти фигуры для связей: " + missed + "."
        : "Маршруты обновлены" +
          (onlyEdges ? " · выделено стрелок: " + onlyEdges.size : ".");
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
    if (cmd === "minus") zoom = Math.max(Math.min(0.25, zoom), zoom - 0.15);
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
    const expanded = panel.classList.contains("diagram-expanded");
    const dx = expanded ? 0 : e.clientX - frameDrag.x,
      dy = e.clientY - frameDrag.y;
    if (!frameDrag.started && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!frameDrag.started) {
      checkpoint();
      frameDrag.started = true;
    }
    const layout = (graph.layout ??= {});
    if (!expanded)
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
      .filter(
        (e) =>
          !e.lockedSegments?.length &&
          selected.has(e.from) &&
          selected.has(e.to),
      )
      .flatMap((e) => e.points || []);
  }
  stage.onpointerdown = (e) => {
    if (e.button !== 0 || drag || !e.target.closest("svg")) return;
    // Redrawing replaces the pressed SVG node. Keep keyboard focus on the canvas.
    e.preventDefault();
    stage.focus({ preventScroll: true });
    if (panMode || layoutPreview) {
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
        selectEdge(id);
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
    const point = e.target.dataset.point;
    const segment = e.target.dataset.segment;
    if (n) {
      if (!alreadySelected) select(additive ? [...selected, n] : [n]);
    } else if (m) {
      select(
        graph.nodes.filter((n) => n.moduleId === m).map((n) => n.id),
        m,
      );
    } else if (ed !== undefined) {
      if (point === undefined && segment === undefined)
        selectEdge(ed, additive);
    } else if (!additive) select([]);
    if (ed !== undefined && segment !== undefined) {
      const connection = current();
      activeSegment = segmentsOf(connection)[Number(segment)];
      if (activeSegment)
        drag = {
          type: "segment",
          start,
          segment: activeSegment,
          connection: clone(connection),
        };
    } else if (n || m) {
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
        moved: new Set(targets.map((n) => n.id)),
        w: targets[0].width,
        h: targets[0].height,
      };
    } else if (point !== undefined) {
      const connection = current();
      const p = connection.points[Number(point)];
      drag = {
        type: "move",
        start,
        connection,
        targets: [{ p, x: p.x, y: p.y }],
      };
    } else if (ed === undefined) {
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
    if (!drag.started && drag.type !== "segment") {
      if (drag.type !== "box") checkpoint();
      if (drag.connection && drag.connection.route !== "curve") {
        const { p } = drag.targets[0];
        const points = connectionPoints(drag.connection).slice(1, -1);
        if (points.length < drag.connection.points.length)
          drag.connection.points = points.map(([x, y]) =>
            samePoint({ x, y }, p) ? p : { x, y },
          );
      }
      drag.started = true;
    }
    const round = (v) => (snap ? Math.round(v / 14) * 14 : Math.round(v));
    if (drag.type === "segment") {
      const { from, to } = drag.segment;
      const horizontal = from.y === to.y;
      const shift = (point) => ({
        x: horizontal ? point.x : round(point.x + dx),
        y: horizontal ? round(point.y + dy) : point.y,
      });
      const replacement = { from: shift(from), to: shift(to) };
      if (!drag.started && sameSegment(replacement, drag.segment)) return;
      const next = reshapeSegment(
        drag.connection,
        drag.segment,
        replacement,
        false,
      );
      drag.blocked = !next;
      if (next) {
        if (!drag.started) checkpoint();
        drag.started = true;
        replaceEdge(next);
        activeSegment = replacement;
        render();
      } else hint.textContent = "На этом месте участок перекрыт фигурой.";
    } else if (drag.type === "box") {
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
    const moved = drag.started && drag.moved;
    const blocked = drag.blocked;
    drag = null;
    if (dirty) graph = normalize(graph);
    const missed = moved ? reroutePinned(moved) : 0;
    refresh();
    if (missed)
      hint.textContent =
        "Часть закреплённых маршрутов перекрыта. Переместите фигуру или открепите участок.";
    else if (blocked)
      hint.textContent = "На этом месте участок перекрыт фигурой.";
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
  return {
    publish,
    cancelPreview() {
      if (!layoutPreview) return false;
      endLayout(false);
      return true;
    },
  };
}
