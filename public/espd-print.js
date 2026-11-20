import { escapeHtml } from "./graph.js";
import { documentTypes } from "./espd.js";
const mm = (value) => (value * 72) / 25.4;
// Form 1, GOST 19.106-78. Dimensions from the drawing, not screen CSS.
export const pageMargins = [20, 25, 10, 15].map(mm);

export function frontMatter(d, pagination) {
  const name = d.program?.toLocaleUpperCase("ru") || "Наименование программы";
  const kind = documentTypes[d.type][0],
    lu = d.designation ? d.designation + "-ЛУ" : "";
  const heading = () => [
    { text: name, bold: true, fontSize: 16, margin: [0, 0, 0, 10] },
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
  const title = [
    {
      stack: [
        { text: d.marking || "", alignment: "right", fontSize: 9 },
        { text: d.ministry || " ", alignment: "center" },
      ],
    },
    {
      stack: [{ text: "УТВЕРЖДЕН", decoration: "underline" }, { text: lu }],
      fontSize: 11,
      margin: [0, mm(8), 0, mm(35)],
    },
    {
      stack: [
        ...heading(),
        { text: d.designation || "", margin: [0, 15, 0, 2] },
        { text: d.medium || "" },
        {
          text: "Листов " + Math.max(1, pagination.total - pagination.approval),
          margin: [0, 12, 0, 0],
        },
      ],
      alignment: "center",
    },
  ];
  return [
    { section: [{ id: "espd-approval", stack: approval }] },
    { section: [{ id: "espd-title", stack: title }] },
  ];
}
export function pageFurniture(data, pagination) {
  return {
    background(page) {
      if (!data.inventory || (page !== 1 && page !== pagination.approval + 1))
        return null;
      // Field 8 occupies the binding margin of both front sheets.
      const label = escapeHtml(data.inventory);
      return {
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="380" viewBox="0 0 28 380"><text transform="translate(18 374) rotate(-90)" font-family="Serif" font-size="9">' +
          label +
          "</text></svg>",
        width: 28,
        absolutePosition: { x: mm(5), y: mm(145) },
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
            ? data.designation
              ? "\n" + data.designation + "-ЛУ"
              : ""
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
          { text: front ? data.year || "" : "", alignment: "center" },
          {
            columns: [
              { text: "" },
              { text: changed ? data.change || "" : "", alignment: "center" },
              { text: front ? data.letter || "" : "", alignment: "right" },
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
      headerRows: 2,
      dontBreakRows: true,
      heights: (i) => mm(i < 2 ? 11 : 8) - 2.5,
      body: [first, second, ...data],
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
