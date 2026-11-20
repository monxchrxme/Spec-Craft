// Use the same embedded faces for conservative preflight of cell heights.
// The actual page layout and line breaks still come from pdfmake.
const families = new Map();

export function tableMeasurer(fontFiles, font, size, leading) {
  const context = document.createElement("canvas").getContext("2d");

  async function load(family, style) {
    const key = family + style;
    if (!families.has(key)) {
      families.set(
        key,
        (async () => {
          const name = "SpecCraftPDF" + key;
          const face = new FontFace(
            name,
            'url("' + fontFiles(family)[style] + '")',
          );
          try {
            await face.load();
            document.fonts.add(face);
            return name;
          } catch {
            return family === "Mono"
              ? "monospace"
              : family === "Serif"
                ? "serif"
                : "sans-serif";
          }
        })(),
      );
    }
    return families.get(key);
  }

  return async (stack, width, header, budget) => {
    const chunks = [[]];
    let sum = 0;
    let maxHeight = 0;
    const minimum = size * leading * 1.2;
    function write(node, height) {
      if (sum && sum + height > budget) {
        chunks.push([]);
        sum = 0;
      }
      chunks.at(-1).push(node);
      sum += height;
      maxHeight = Math.max(maxHeight, sum);
    }
    for (const node of stack) {
      if (!node.text) {
        write(
          node,
          (node.specMeasuredHeight ||
            node.height ||
            node.fit?.[1] ||
            node.width ||
            minimum) + minimum,
        );
        continue;
      }
      const runs =
        typeof node.text === "string" ? [{ text: node.text }] : node.text;
      const lines = [];
      let row = [],
        used = 0,
        height = minimum;
      const finish = () => {
        if (row.length) lines.push({ runs: row, height });
        row = [];
        used = 0;
        height = minimum;
      };
      for (const run of runs) {
        const bold = run.bold ?? node.bold ?? header;
        const italic = run.italics ?? node.italics;
        const style =
          bold && italic
            ? "bolditalics"
            : bold
              ? "bold"
              : italic
                ? "italics"
                : "normal";
        const family = await load(run.font || node.font || font, style);
        const fontSize = run.fontSize || node.fontSize || size;
        context.font = fontSize + "px " + family;
        for (const word of run.text.match(/\n|[^\S\n]+|\S+/g) || []) {
          if (word === "\n") {
            row.push({ ...run, text: word });
            finish();
            continue;
          }
          const advance =
            run.inlineSvg?._width ?? context.measureText(word).width;
          if (used && used + advance > width && /\S/.test(word)) finish();
          const wrappedHeight = Math.max(
            fontSize * leading * 1.2,
            run.inlineSvg?._height || 0,
          );
          height = Math.max(height, wrappedHeight);
          row.push({ ...run, text: word });
          used += advance;
          // Long unspaced runs can wrap across multiple lines inside the PDF.
          if (advance > width && !run.inlineSvg) {
            const parts = Array.from(word);
            const count = Math.max(
              1,
              Math.floor((parts.length * width) / advance),
            );
            row.pop();
            for (let i = 0; i < parts.length; i += count) {
              row.push({ ...run, text: parts.slice(i, i + count).join("") });
              height = Math.max(height, wrappedHeight);
              if (i + count < parts.length) finish();
            }
            used = Math.min(width, advance);
          }
        }
      }
      finish();
      const total = lines.reduce((value, entry) => value + entry.height, 0);
      if (sum + total <= budget || (total <= budget && chunks.at(-1).length)) {
        write(node, total);
        continue;
      }
      let fragment = [],
        fragmentHeight = 0;
      const emit = () => {
        if (!fragment.length) return;
        write(
          { ...node, text: fragment.flatMap((entry) => entry.runs) },
          fragmentHeight,
        );
        fragment = [];
        fragmentHeight = 0;
      };
      for (const line of lines) {
        if (fragment.length && sum + fragmentHeight + line.height > budget)
          emit();
        fragment.push(line);
        fragmentHeight += line.height;
      }
      emit();
    }
    return { chunks, height: maxHeight };
  };
}
