import { escapeHtml } from "./graph.js";
import { documentTypes } from "./espd.js";
const mm = (value) => (value * 72) / 25.4;
// Form 1, GOST 19.106-78. Dimensions from the drawing, not screen CSS.
export const pageMargins = [20, 25, 10, 15].map(mm);

export function frontMatter(d, pagination) {
  const name = d.program?.toLocaleUpperCase("ru") || "НАИМЕНОВАНИЕ ПРОГРАММЫ";
  const kind = documentTypes[d.type][0],
    lu = d.approvalId || (d.designation ? d.designation + "-ЛУ" : "");
  const heading = () => [
    { text: name, bold: true, fontSize: 14, margin: [0, 0, 0, 10] },
    ...(d.documentName ? [{ text: d.documentName, fontSize: 14 }] : []),
    { text: kind, fontSize: 14 },
  ];
  const small = { fontSize: 10, lineHeight: 1.05 };
  const signature = (label, value) => ({
    stack: [
      { text: label, bold: true },
      { text: value || "________________", margin: [0, 6, 0, 0] },
    ],
  });
  const approval = [
    {
      stack: [
        { text: d.marking || "", alignment: "right", fontSize: 9 },
        { text: d.ministry || " ", alignment: "center" },
      ],
      margin: [0, 0, 0, mm(12)],
    },
    {
      columns: [
        signature("СОГЛАСОВАНО", d.agreed),
        signature("УТВЕРЖДАЮ", d.approved),
      ],
      columnGap: 18,
      ...small,
    },
    {
      stack: [
        ...heading(),
        { text: "ЛИСТ УТВЕРЖДЕНИЯ", margin: [0, 10, 0, 4] },
        { text: lu },
        { text: d.medium || "" },
        {
          text: pagination.approval > 1 ? "Листов " + pagination.approval : "",
        },
      ],
      alignment: "center",
      margin: [0, mm(25), 0, mm(18)],
    },
    {
      columns: [
        { text: "" },
        { ...signature("Разработали", d.authors), ...small },
      ],
    },
  ];
  if (!d.agreed) approval[1].columns[0] = { text: "" };
  // Minimum heights keep empty fields in their zones. Long text can still wrap.
  const zone = (height, stack, alignment = "center") => ({
    layout: "noBorders",
    table: {
      widths: ["*"],
      heights: [mm(height)],
      body: [[{ stack, alignment, margin: [0, 0, 0, 0] }]],
    },
  });
  const title = [
    zone(12, [
      { text: d.marking || "", alignment: "right" },
      { text: d.ministry || "" },
    ]),
    zone(
      54,
      [{ text: "УТВЕРЖДЕН", decoration: "underline" }, { text: lu }],
      "left",
    ),
    zone(49, heading()),
    zone(18, [{ text: d.designation || "" }, { text: d.medium || "" }]),
    {
      text: "Листов " + Math.max(1, pagination.total - pagination.approval),
      alignment: "center",
    },
  ];
  return [
    ...(d.printSet === "document"
      ? []
      : [{ section: [{ id: "espd-approval", stack: approval }] }]),
    { section: [{ id: "espd-title", stack: title }] },
  ];
}

// Account stamp on the binding edge, GOST 19.601-78.
function inventoryStamp(d) {
  const widths = [25, 35, 25, 25, 35],
    labels = [
      "Инв. № подл.",
      "Подп. и дата",
      "Взам. инв. №",
      "Инв. № дубл.",
      "Подп. и дата",
    ];
  const values = [
    d.inventory,
    d.originalSignature,
    d.replacedInventory,
    d.duplicateInventory,
    d.duplicateSignature,
  ];
  let left = 0;
  const cells = widths.map((width, i) => {
    const center = left + width / 2;
    const val = values[i] || "";
    const size = Math.min(2.8, (width - 1.5) / Math.max(1, val.length * 0.64));
    const result =
      '<path fill="none" stroke="black" stroke-width=".22" d="M ' +
      left +
      ' 0 V 12"/><text x="' +
      center +
      '" y="3.6">' +
      labels[i] +
      '</text><text x="' +
      center +
      '" y="9.6" font-size="' +
      size +
      '">' +
      escapeHtml(val) +
      "</text>";
    left += width;
    return result;
  });
  return {
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="145" viewBox="0 0 12 145"><g transform="translate(0 145) rotate(-90)" font-family="Serif" font-size="2.7" text-anchor="middle"><g fill="none" stroke="black" stroke-width=".22"><rect x=".12" y=".12" width="144.76" height="11.76"/><path d="M 0 5 H 145"/></g>' +
      cells.join("") +
      "</g></svg>",
    width: mm(12),
    absolutePosition: { x: mm(5), y: mm(147) },
  };
}
export function pageFurniture(data, pagination) {
  return {
    background(page) {
      if (page !== 1 && page !== pagination.approval + 1) return null;
      return {
        stack: [
          inventoryStamp(data),
          {
            absolutePosition: { x: pageMargins[0], y: mm(258) },
            columns: [
              {
                width: mm(180),
                alignment: "center",
                fontSize: 12,
                text: data.year || "",
              },
            ],
          },
        ],
      };
    },
    header(page) {
      if (
        (page === 1 && pagination.approval === 1) ||
        page === pagination.approval + 1
      )
        return { text: "" };
      return {
        text: [
          String(
            page <= pagination.approval ? page : page - pagination.approval,
          ),
          page <= pagination.approval
            ? "\n" +
              (data.approvalId ||
                (data.designation ? data.designation + "-ЛУ" : ""))
            : data.type === "19.201-78"
              ? ""
              : "\n" + (data.designation || ""),
        ],
        alignment: "center",
        fontSize: 10,
        margin: [pageMargins[0], 12, pageMargins[2], 0],
      };
    },
    footer(page) {
      const front = page === 1 || page === pagination.approval + 1;
      const number = page - pagination.approval;
      const changed = (data.changePages || "").split(/[,;]/).some((entry) => {
        const range = /^\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*$/.exec(entry);
        return range
          ? number >= Number(range[1]) && number <= Number(range[2] || range[1])
          : number <= 0 && entry.trim().toUpperCase() === "ЛУ";
      });
      return {
        stack: [
          ...(pagination.notes?.[page]?.length
            ? [
                {
                  canvas: [
                    {
                      type: "line",
                      x1: 0,
                      y1: 0,
                      x2: mm(30),
                      y2: 0,
                      lineWidth: 0.6,
                    },
                  ],
                  margin: [0, 2, 0, 3],
                },
                ...pagination.notes[page].map((text) => ({
                  text,
                  fontSize: 9,
                  lineHeight: 1,
                  margin: [0, 0, 0, 1],
                })),
              ]
            : []),

          {
            columns: [
              { text: "" },
              { text: changed ? data.change || "" : "", alignment: "center" },
              {
                text:
                  front && data.letter ? "Литера «" + data.letter + "»" : "",
                alignment: "right",
              },
            ],
            fontSize: 8,
          },
        ],
        margin: [pageMargins[0], 0, pageMargins[2], 0],
        fontSize: 11,
      };
    },
  };
}

// Form 1 of GOST 19.604-78. Keep the user's editable Markdown rows.
export function registrationTable(rows) {
  const widths = [8, 20, 20, 20, 20, 20, 25, 25, 15, 12];
  const headers = [
    "Изм.",
    "Номера листов (страниц)",
    "",
    "",
    "",
    "Всего листов (страниц) в докум.",
    "№ документа",
    "Входящий № сопроводительного докум. и дата",
    "Подп.",
    "Дата",
  ];
  const first = headers.map((text, i) =>
    i === 1
      ? { text, colSpan: 4 }
      : i >= 2 && i <= 4
        ? {}
        : { text, rowSpan: 2 },
  );
  const second = [
    "",
    "изменённых",
    "заменённых",
    "новых",
    "аннулиро-\nванных",
    "",
    "",
    "",
    "",
    "",
  ];
  const data = rows.map((row) => row.map((cell) => ({ text: cell })));
  while (data.length < 25) data.push(widths.map(() => ""));
  return {
    fontSize: 8,
    lineHeight: 1,
    alignment: "center",
    margin: [0, 0, -mm(5), 0],
    table: {
      widths: widths.map((n) => mm(n) - 2.5),
      headerRows: 3,
      dontBreakRows: true,
      heights: (i) => mm(i === 0 ? 10 : i < 3 ? 11 : 8) - 2.5,
      body: [
        [
          {
            text: "Лист регистрации изменений",
            colSpan: 10,
            fontSize: 14,
            italics: true,
          },
          ...widths.slice(1).map(() => ({})),
        ],
        first.map((cell) => (cell.text ? { ...cell, italics: true } : cell)),
        second.map((text) => ({ text, italics: true })),
        ...data,
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      paddingLeft: () => 1,
      paddingRight: () => 1,
      paddingTop: () => 1,
      paddingBottom: () => 1,
    },
  };
}
