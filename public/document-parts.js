export function documentParts(md, body) {
  const starts = [0];
  for (const m of body.matchAll(/\r\n|\r|\n/g))
    starts.push(m.index + m[0].length);
  const tokens = md.parse(body, {}),
    res = [];
  let options = [],
    pdfFormat = {},
    pdfMetadata = { rules: [], format: [] },
    fullStart;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.level || !t.map) continue;
    if (t.type === "spec_heading_id") {
      if (t.attached) fullStart ??= starts[t.map[0]];
      continue;
    }
    if (t.type === "spec_pdf" || t.type === "spec_pdf_block") {
      const from = starts[t.map[0]];
      const to = starts[t.map[1]] ?? body.length;
      fullStart ??= from;
      if (t.type === "spec_pdf") {
        options.push(...t.meta);
        pdfMetadata.rules.push([from, to]);
      } else {
        Object.assign(pdfFormat, t.meta);
        pdfMetadata.format.push([from, to]);
      }
      continue;
    }
    let j = i;
    if (t.nesting === 1)
      while (
        j + 1 < tokens.length &&
        !(tokens[++j].level === 0 && tokens[j].nesting === -1)
      ) {}
    const start = starts[t.map[0]],
      rawEnd = starts[t.map[1]] ?? body.length;
    let end = rawEnd;
    const tail = body.slice(start, end).match(/(?:\r\n|\n|\r)$/);
    if (tail) end -= tail[0].length;
    res.push({
      t,
      tokens: tokens.slice(i, j + 1),
      start,
      fullStart: fullStart ?? start,
      pdfRules: [...new Set(options)],
      pdfFormat,
      pdfMetadata,
      end,
      text: body.slice(start, end),
    });
    fullStart = undefined;
    options = [];
    pdfFormat = {};
    pdfMetadata = { rules: [], format: [] };
    i = j;
  }
  return res;
}
