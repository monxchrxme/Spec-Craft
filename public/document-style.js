const typography = [
  [
    "font",
    "Шрифт текста",
    "sans",
    { sans: "Без засечек", serif: "С засечками", mono: "Моноширинный" },
  ],
  ["size", "Размер текста, px", 16, [14, 15, 16, 17, 18, 20, 22, 24]],
  ["leading", "Межстрочный интервал", 1.65, [1.25, 1.45, 1.65, 1.85, 2]],
  ["gap", "Интервал между абзацами, px", 12, [6, 10, 12, 16, 20, 24]],
  [
    "lineLength",
    "Ширина строки для чтения",
    0,
    {
      0: "Вся ширина",
      55: "Узкая · 55 знаков",
      70: "Средняя · 70 знаков",
      85: "Широкая · 85 знаков",
    },
  ],
  [
    "align",
    "Выравнивание абзацев",
    "left",
    { left: "По левому краю", justify: "По ширине" },
  ],
  [
    "headingAlign",
    "Выравнивание заголовков",
    "left",
    { left: "По левому краю", center: "По центру", right: "По правому краю" },
  ],
  ["tabSize", "Ширина табуляции", 4, [2, 4, 8]],
];
const formulaFields = [
  ["formulaInlineSize", "Размер в строке, %", 100, 50, 250],
  ["formulaDisplaySize", "Размер отдельной формулы, %", 115, 50, 250],
  ["formulaSpaceBefore", "Интервал перед отдельной формулой, px", 12, 0, 64],
  ["formulaSpaceAfter", "Интервал после отдельной формулы, px", 12, 0, 64],
];
export function formulaSettings(input, includeDefaults = true) {
  const settings = {};
  for (const [key, , initial, min, max] of formulaFields) {
    const value = input?.[key];
    if (Number.isInteger(value) && value >= min && value <= max)
      settings[key] = value;
    else if (includeDefaults) settings[key] = initial;
  }
  return settings;
}
export function paintFormulaStyle(paper, style) {
  const f = formulaSettings(style);
  paper.style.setProperty("--formula-inline-size", f.formulaInlineSize + "%");
  paper.style.setProperty("--formula-display-size", f.formulaDisplaySize + "%");
  paper.style.setProperty(
    "--formula-space-before",
    f.formulaSpaceBefore + "px",
  );
  paper.style.setProperty("--formula-space-after", f.formulaSpaceAfter + "px");
}

const printOptions = [
  [
    "pdfProfile",
    "Профиль PDF",
    "screen",
    { screen: "PDF для экрана", a4: "Строго A4" },
  ],
  [
    "pdfOrientation",
    "Ориентация основных страниц",
    "portrait",
    { portrait: "Книжная", landscape: "Альбомная" },
  ],
  [
    "pdfSectionLevel",
    "Начинать с новой страницы",
    0,
    {
      0: "Только по правилам блоков",
      1: "Разделы первого уровня",
      2: "Разделы первого и второго уровней",
    },
  ],
];
const margins = [
  ["pdfMarginLeft", "Слева"],
  ["pdfMarginTop", "Сверху"],
  ["pdfMarginRight", "Справа"],
  ["pdfMarginBottom", "Снизу"],
];
const checks = [
  ["accentHeadings", "Заголовки цветом акцента", false],
  ["wrap", "Перенос строк в исходнике", true],
  ["spellcheck", "Проверка орфографии при вводе", false],
  ["pdfPageNumbers", "Номера страниц", false],
];
function choices(values) {
  return Array.isArray(values)
    ? values.map((n) => [String(n), String(n)])
    : Object.entries(values);
}
export function templateStyle(input = {}) {
  const style = formulaSettings(input, false);
  for (const [key, , initial, values] of [...typography, ...printOptions]) {
    const value = input?.[key];
    if (
      (typeof value === "number" || typeof value === "string") &&
      choices(values).some(([v]) => v === String(value))
    )
      style[key] = typeof initial === "number" ? Number(value) : value;
  }
  for (const [key] of checks)
    if (typeof input?.[key] === "boolean") style[key] = input[key];
  if (/^#[0-9a-f]{6}$/i.test(input?.accent)) style.accent = input.accent;
  for (const [key] of margins) {
    const v = input?.[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 5 && v <= 45)
      style[key] = v;
  }
  return style;
}
export function pageMargins(style) {
  return margins.map(([key]) => {
    const mm = style[key];
    return typeof mm === "number" && mm >= 5 && mm <= 45
      ? (mm * 72) / 25.4
      : 38;
  });
}
export function paintDocumentStyle(p, s) {
  paintFormulaStyle(p, s);
  p.style.setProperty(
    "--doc-font",
    s.font === "serif"
      ? 'Georgia,"Times New Roman",serif'
      : s.font === "mono"
        ? "ui-monospace, Menlo, Consolas, monospace"
        : 'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  );
  p.style.setProperty("--doc-size", (Number(s.size) || 16) + "px");
  p.style.setProperty(
    "--doc-accent",
    /^#[a-f\d]{6}$/i.test(s.accent) ? s.accent : "#6353bb",
  );
  p.style.setProperty("--doc-leading", Number(s.leading) || 1.65);
  p.style.setProperty("--paragraph-gap", (Number(s.gap) || 12) + "px");
  p.style.setProperty(
    "--reading-width",
    s.lineLength ? Number(s.lineLength) + "ch" : "none",
  );
  p.style.setProperty(
    "--prose-align",
    s.align === "justify" ? "justify" : "left",
  );
  p.style.setProperty(
    "--heading-align",
    ["center", "right"].includes(s.headingAlign) ? s.headingAlign : "left",
  );
  p.style.setProperty(
    "--heading-color",
    s.accentHeadings ? "var(--display-accent, var(--doc-accent))" : "inherit",
  );
  p.style.tabSize = Number(s.tabSize) || 4;
}

// The library and the document editor use the same controls and allowed values.
export function styleControls(container, style = {}, openGroup = "text") {
  const fields = [];
  function group(name, open) {
    const details = document.createElement("details"),
      summary = document.createElement("summary");
    details.open = open;
    summary.textContent = name;
    const body = document.createElement("div");
    body.className = "style-fields";
    details.append(summary, body);
    container.append(details);
    return body;
  }
  const text = group("Текст и интервалы", openGroup === "text"),
    formulas = group("Формулы", false),
    print = group("Параметры страниц PDF", openGroup === "print");
  function field(group, key, title, input, read) {
    const label = document.createElement("label");
    label.textContent = title;
    input.name = key;
    if (input.type === "checkbox") label.className = "style-check";
    label.append(input);
    group.append(label);
    fields.push([key, read]);
  }
  for (const [key, title, initial, values] of [
    ...typography,
    ...printOptions,
  ]) {
    const el = document.createElement("select");
    for (const [v, name] of choices(values)) el.add(new Option(name, v));
    el.value = style[key] ?? initial;
    if (el.selectedIndex < 0) el.value = initial;
    field(key.startsWith("pdf") ? print : text, key, title, el, () =>
      typeof initial === "number" ? Number(el.value) : el.value,
    );
  }
  const math = formulaSettings(style);
  for (const [key, title, initial, min, max] of formulaFields) {
    const el = document.createElement("input");
    el.type = "number";
    el.min = min;
    el.max = max;
    el.placeholder = String(initial);
    el.value = math[key];
    field(formulas, key, title, el, () =>
      el.value === "" ? undefined : el.valueAsNumber,
    );
  }
  const color = document.createElement("input");
  color.type = "color";
  color.value = style.accent || "#6353bb";
  field(text, "accent", "Цвет акцента", color, () => color.value);
  const box = document.createElement("fieldset"),
    legend = document.createElement("legend");
  legend.textContent = "Поля страницы, мм";
  box.className = "page-margins";
  box.append(legend);
  print.append(box);
  for (const [key, title] of margins) {
    const el = document.createElement("input");
    el.type = "number";
    el.min = "5";
    el.max = "45";
    el.step = "0.1";
    el.placeholder = "13,4";
    el.value = style[key] ?? "";
    field(box, key, title, el, () => (el.value ? el.valueAsNumber : undefined));
  }
  for (const [key, title, fallback] of checks) {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.checked = style[key] ?? fallback;
    field(
      key.startsWith("pdf") ? print : text,
      key,
      title,
      el,
      () => el.checked,
    );
  }
  return () => Object.fromEntries(fields.map(([key, read]) => [key, read()]));
}
