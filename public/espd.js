import { escapeHtml } from "./graph.js";

export const standard = "ГОСТ 19.106-78";
export const documentTypes = {
  "19.404-79": [
    "Пояснительная записка",
    "Введение",
    "Назначение и область применения",
    "Технические характеристики",
    "Ожидаемые технико-экономические показатели",
    "Источники, использованные при разработке",
  ],
  "19.201-78": [
    "Техническое задание",
    "Введение",
    "Основания для разработки",
    "Назначение разработки",
    "Требования к программе или программному изделию",
    "Требования к программной документации",
    "Технико-экономические показатели",
    "Стадии и этапы разработки",
    "Порядок контроля и приёмки",
  ],
  "19.402-78": [
    "Описание программы",
    "Общие сведения",
    "Функциональное назначение",
    "Описание логической структуры",
    "Используемые технические средства",
    "Вызов и загрузка",
    "Входные данные",
    "Выходные данные",
  ],
  "19.502-78": [
    "Описание применения",
    "Назначение программы",
    "Условия применения",
    "Описание задачи",
    "Входные и выходные данные",
  ],
  "19.506-79": [
    "Описание языка",
    "Общие сведения",
    "Элементы языка",
    "Способы структурирования программы",
    "Средства обмена данными",
    "Встроенные элементы",
    "Средства отладки программы",
  ],
  "19.503-79": [
    "Руководство системного программиста",
    "Общие сведения о программе",
    "Структура программы",
    "Настройка программы",
    "Проверка программы",
    "Дополнительные возможности",
    "Сообщения системному программисту",
  ],
  "19.504-79": [
    "Руководство программиста",
    "Назначение и условия применения программы",
    "Характеристики программы",
    "Обращение к программе",
    "Входные и выходные данные",
    "Сообщения",
  ],
  "19.505-79": [
    "Руководство оператора",
    "Назначение программы",
    "Условия выполнения программы",
    "Выполнение программы",
    "Сообщения оператору",
  ],
  "19.301-79": [
    "Программа и методика испытаний",
    "Объект испытаний",
    "Цель испытаний",
    "Требования к программе",
    "Требования к программной документации",
    "Средства и порядок испытаний",
    "Методы испытаний",
  ],
};
export const fields = {
  printSet: "Комплект печати",
  approvalId: "Обозначение листа утверждения",
  program: "Наименование программы",
  documentName: "Наименование документа",
  marking: "Особая отметка",
  designation: "Обозначение документа",
  ministry: "Ведомство",
  medium: "Вид носителя",
  year: "Год",
  agreed: "Согласовали",
  approved: "Утвердили",
  authors: "Разработчики и нормоконтроль",
  inventory: "Инвентарный номер подлинника",
  originalSignature: "Подпись и дата подлинника",
  replacedInventory: "Взамен инвентарного номера",
  duplicateInventory: "Инвентарный номер дубликата",
  duplicateSignature: "Подпись и дата дубликата",
  change: "Строка изменений",
  changePages: "Изменённые листы (например, ЛУ, 2, 4–6)",
  letter: "Литера",
};
export function profileData(value = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value.type !== undefined && !Object.hasOwn(documentTypes, value.type)) ||
    Object.keys(value).some(
      (key) =>
        key !== "type" &&
        (!Object.hasOwn(fields, key) || typeof value[key] !== "string"),
    )
  )
    throw Error("Неизвестные или повреждённые реквизиты ЕСПД.");
  return { type: "19.404-79", ...value };
}
const marker = "<!-- speccraft: " + standard;
export function declaration(data) {
  return (
    marker +
    "\n" +
    JSON.stringify(profileData(data), null, 2).replaceAll(">", "\\u003e") +
    "\n-->"
  );
}
export function readProfile(body) {
  const match =
    /^(?:\uFEFF)?<!-- speccraft: ГОСТ 19\.106-78(?:[ \t]*-->|[ \t]*\r?\n([\s\S]*?)\r?\n-->)(?=\r?\n|$)/.exec(
      body,
    );
  if (!match) return null;
  try {
    return {
      data: profileData(match[1] ? JSON.parse(match[1]) : {}),
      end: match[0].length,
    };
  } catch {
    return null;
  }
}
export const changeColumns = [
  "Изм.",
  "Изменённых",
  "Заменённых",
  "Новых",
  "Аннулированных",
  "Всего листов",
  "№ документа",
  "Входящий № и дата",
  "Подп.",
  "Дата",
];
const changeRegister = [
  "# Лист регистрации изменений",
  "",
  ...[
    changeColumns,
    changeColumns.map(() => "---"),
    changeColumns.map(() => ""),
  ].map((row) => "| " + row.join(" | ") + " |"),
].join("\n");
const subsections = {
  "19.201-78": {
    "Требования к программе или программному изделию": [
      "Функциональные характеристики",
      "Надёжность",
      "Условия эксплуатации",
      "Состав и параметры технических средств",
      "Информационная и программная совместимость",
      "Маркировка и упаковка",
      "Транспортирование и хранение",
      "Специальные требования",
    ],
  },
  "19.404-79": {
    "Технические характеристики": [
      "Постановка задачи и математические методы",
      "Алгоритм и взаимодействие программ",
      "Организация входных и выходных данных",
      "Выбор технических и программных средств",
    ],
  },
};
export function templateBody(type) {
  const [, ...sections] = documentTypes[type];
  const info = ["19.201-78", "19.301-79"].includes(type)
    ? []
    : ["# Аннотация", "# Содержание"];
  return (
    [
      declaration({
        type,
        ...(type === "19.404-79" ? { printSet: "document" } : {}),
        year: String(new Date().getFullYear()),
      }),
      ...info,
      ...sections.flatMap((s) => [
        "# " + s,
        ...(subsections[type]?.[s] || []).map((sub) => "## " + sub),
      ]),
      changeRegister,
    ].join("\n\n") + "\n"
  );
}
export function coverHtml(data) {
  const { program, designation, year, ministry, medium } = data;
  return (
    '<section class="espd-cover"><small>' +
    escapeHtml(standard) +
    "</small><p>" +
    escapeHtml(ministry || "") +
    "</p><h2>" +
    escapeHtml(program || "Наименование программы") +
    "</h2><p>" +
    (data.documentName ? escapeHtml(data.documentName) + "</p><p>" : "") +
    escapeHtml(documentTypes[data.type][0]) +
    "</p><p>" +
    escapeHtml(designation || "") +
    "</p><p>" +
    escapeHtml(medium || "") +
    "</p><p>" +
    escapeHtml(year || "") +
    "</p></section>"
  );
}
export function espdBlocks(md) {
  md.block.ruler.before(
    "html_block",
    "espd_title",
    (state, start, end, silent) => {
      if (
        start ||
        state.blkIndent ||
        state.bMarks[start] !== 0 ||
        !state.src.replace(/^\uFEFF/, "").startsWith(marker)
      )
        return false;
      const profile = readProfile(state.src);
      if (!profile) return false;
      if (silent) return true;
      const count = state.src.slice(0, profile.end).split("\n").length;
      const t = state.push("espd_title", "", 0);
      t.map = [0, count];
      t.meta = profile.data;
      state.env.espd = true;
      state.line = count;
      return true;
    },
  );
  md.inline.ruler.before("text", "espd_note", (state, silent) => {
    if (!state.env.espd || !state.src.startsWith("^[", state.pos)) return false;
    const match = /^\^\[((?:\\.|[^\]\n])+?)\]/.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
      const token = state.push("espd_note", "", 0);
      token.content = match[1].replace(/\\([\]\\])/g, "$1");
    }
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.espd_note = (tokens, i) =>
    '<sup data-espd-note="' +
    tokens[i].meta.number +
    '" title="' +
    escapeHtml(tokens[i].content) +
    '">' +
    tokens[i].meta.number +
    ")</sup>";
  md.renderer.rules.espd_title = (tokens, i) => coverHtml(tokens[i].meta);
  md.core.ruler.after("spec_heading_anchors", "espd_headings", ({ tokens }) => {
    if (tokens[0]?.type !== "espd_title") return;
    let noteNumber = 0;
    for (const token of tokens)
      for (const child of token.children || []) {
        if (child.type === "espd_note") child.meta = { number: ++noteNumber };
      }
    const counters = [];
    const appendixPattern = /^приложение(?:\s+\d+)?(?:\s*[.:—–-]\s*|\s+|$)/i;
    const totalAppendices = tokens.filter(
      (t, i) =>
        t.type === "heading_open" &&
        t.tag === "h1" &&
        !t.level &&
        appendixPattern.test(tokens[i + 1].content.trim()),
    ).length;
    let appendix = 0;
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type !== "heading_open" || t.level) continue;
      const label = tokens[i + 1].content.trim(),
        level = Number(t.tag.slice(1));
      const special =
        level === 1 &&
        /^(аннотация|содержание|оглавление|приложение(?:[.:—–-]|\s|$)|лист регистрации изменений|перечень(?:\s|$))/i.test(
          label,
        );
      const isAppendix = level === 1 && appendixPattern.test(label);
      if (isAppendix) {
        appendix++;
        counters.length = 0;
      } else if (level === 1 && special) counters.length = 0;
      let prefix = "";
      if (!special) {
        const depth = appendix && level > 1 ? level - 1 : level;
        counters.length = depth;
        for (let n = 0; n < depth - 1; n++) counters[n] ||= 1;
        counters[depth - 1] = (counters[depth - 1] || 0) + 1;
        prefix = counters.join(".") + ". ";
      }
      const appendixMark = isAppendix
        ? "ПРИЛОЖЕНИЕ" + (totalAppendices > 1 ? " " + appendix : "")
        : "";
      const title = isAppendix
        ? label.replace(appendixPattern, "").replace(/^[. :—–-]+/, "")
        : label;
      t.meta = {
        ...t.meta,
        espd: {
          label,
          title,
          appendixMark,
          prefix,
          level,
          contents: level === 1 && /^(содержание|оглавление)$/i.test(label),
        },
      };
      t.attrSet("data-espd-number", prefix);
    }
    const media = { figure: [], table: [], equation: [] };
    let scope = 0,
      figures = 0,
      tables = 0,
      register = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.level) continue;
      if (t.type === "heading_open")
        register =
          t.tag === "h1" &&
          /^лист регистрации изменений$/i.test(t.meta.espd?.label);
      if (t.type === "table_open" && register) {
        const labels = [];
        let j = i;
        while (
          j < tokens.length &&
          tokens[j].type !== "thead_close" &&
          tokens[j].type !== "table_close"
        ) {
          if (tokens[j].type === "inline") labels.push(tokens[j].content);
          j++;
        }
        if (
          labels.length === changeColumns.length &&
          labels.every((v, k) => v === changeColumns[k])
        ) {
          t.meta = { ...t.meta, changeRegister: true };
          continue;
        }
      }
      if (t.meta?.espd?.appendixMark) {
        scope++;
        figures = 0;
        tables = 0;
      }
      const image =
        t.type === "paragraph_open" &&
        tokens[i + 1]?.children?.filter(
          (c) => c.content !== "" || c.type === "image",
        ).length === 1 &&
        tokens[i + 1].children.find((c) => c.type === "image");
      const kind =
        t.type === "math_block"
          ? "equation"
          : t.type === "table_open"
            ? "table"
            : image ||
                (t.type === "fence" &&
                  ["mermaid", "studio-diagram"].includes(t.info.trim()))
              ? "figure"
              : null;
      if (!kind) continue;
      const group = media[kind];
      const key =
        t.type === "math_block"
          ? t.content.match(/\\label\{([\w:.-]+)\}/)?.[1]
          : undefined;
      const obj = {
        kind,
        key,
        number:
          kind === "figure"
            ? ++figures
            : kind === "table"
              ? ++tables
              : group.length + 1,
        scope,
      };
      t.meta = { ...t.meta, object: obj };
      group.push(obj);
    }
    const refs = new Map(),
      figureCounts = new Map();
    for (const figure of media.figure)
      figureCounts.set(figure.scope, 1 + (figureCounts.get(figure.scope) || 0));
    for (const group of Object.values(media)) {
      for (const item of group) {
        item.numbered =
          item.kind === "table" ||
          (item.kind === "figure"
            ? figureCounts.get(item.scope)
            : group.length) > 1 ||
          !!item.key;
        if (item.key) refs.set(item.key, refs.has(item.key) ? null : item);
      }
    }
    for (const item of media.equation)
      if (item.key && !refs.get(item.key)) delete item.key;
    for (const t of tokens) {
      if (!t.children) continue;
      t.children = t.children.flatMap((c) => {
        if (c.type !== "text" || !c.content.includes("[@")) return [c];
        const result = [];
        let start = 0;
        for (const match of c.content.matchAll(/\[@([\w:.-]+)\]/g)) {
          const obj = refs.get(match[1]);
          if (!obj) continue;
          result.push(
            Object.assign(Object.create(Object.getPrototypeOf(c)), c, {
              content: c.content.slice(start, match.index),
            }),
          );
          const ref = Object.assign(
            Object.create(Object.getPrototypeOf(c)),
            c,
            {
              type: "espd_ref",
              content: String(obj.number),
              meta: { key: match[1] },
            },
          );
          result.push(ref);
          start = match.index + match[0].length;
        }
        return [
          ...result,
          Object.assign(Object.create(Object.getPrototypeOf(c)), c, {
            content: c.content.slice(start),
          }),
        ];
      });
    }
  });
  md.renderer.rules.espd_ref = (tokens, i) =>
    '<a href="#equation-' +
    tokens[i].meta.key +
    '">(' +
    tokens[i].content +
    ")</a>";
}
export function objectLabel(obj) {
  if (!obj?.numbered) return "";
  return obj.kind === "equation"
    ? "(" + obj.number + ")"
    : (obj.kind === "table" ? "Таблица " : "Рис. ") + obj.number;
}
export function markdownCopy(body) {
  const p = readProfile(body);
  if (!p) return body;
  const d = p.data;
  const title = [
    "# " + (d.program || documentTypes[d.type][0]),
    d.program && documentTypes[d.type][0],
    d.documentName,
    d.designation,
    d.ministry,
    d.year,
  ].filter(Boolean);
  return (
    title.join("\n\n") +
    "\n\n" +
    body.slice(p.end).replace(/^(?:\r?\n){1,2}/, "")
  );
}
export function encodeProject(doc) {
  const profile = readProfile(doc.body);
  const content = profile ? doc.body.slice(profile.end) : doc.body;
  let scheme = "speccraft-asset:";
  while (content.includes(scheme)) scheme += "_";
  const assets = {};
  const urls = new Map();
  const originalHeader = profile && doc.body.slice(0, profile.end);
  const markdown = content.replace(
    /data:image\/[\w.+-]+;base64,[a-z\d+/=]+/gi,
    (uri) => {
      if (!urls.has(uri)) {
        const key = scheme + (urls.size + 1);
        urls.set(uri, key);
        assets[key] = uri;
      }
      return urls.get(uri);
    },
  );
  return JSON.stringify(
    {
      format: "speccraft",
      version: 1,
      name: doc.name,
      kind: doc.kind,
      style: doc.style || {},
      profile: profile && {
        standard,
        fields: profile.data,
        ...(originalHeader !== declaration(profile.data)
          ? { source: originalHeader }
          : {}),
      },
      markdown,
      assets,
    },
    null,
    2,
  );
}
export function decodeProject(source) {
  const p = JSON.parse(source);
  if (
    p?.format !== "speccraft" ||
    p.version !== 1 ||
    typeof p.markdown !== "string" ||
    typeof p.name !== "string" ||
    (p.profile && p.profile.standard !== standard)
  )
    throw Error("Неподдерживаемый формат или версия проекта SpecCraft.");
  const assets = p.assets ?? {};
  for (const [key, uri] of Object.entries(assets)) {
    if (
      !/^speccraft-asset:_*\d+$/.test(key) ||
      typeof uri !== "string" ||
      !/^data:image\/[\w.+-]+;base64,[a-z\d+/=]+$/i.test(uri)
    )
      throw Error("Повреждён ресурс проекта.");
  }
  const content = p.markdown.replace(/speccraft-asset:_*\d+/g, (key) =>
    Object.hasOwn(assets, key) ? assets[key] : key,
  );
  let header = "";
  if (p.profile) {
    const fields = profileData(p.profile.fields);
    header = declaration(fields);
    if (p.profile.source !== undefined) {
      const saved =
        typeof p.profile.source === "string" && readProfile(p.profile.source);
      if (
        !saved ||
        saved.end !== p.profile.source.length ||
        Object.keys(fields).length !== Object.keys(saved.data).length ||
        Object.entries(fields).some(([k, v]) => saved.data[k] !== v)
      )
        throw Error("Реквизиты проекта расходятся с исходником.");
      header = p.profile.source;
    }
  }
  return {
    name: p.name,
    kind: typeof p.kind === "string" ? p.kind : "Markdown",
    style:
      p.style && typeof p.style === "object" && !Array.isArray(p.style)
        ? p.style
        : {},
    body: header + content,
  };
}
