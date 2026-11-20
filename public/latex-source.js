// Only edited spans pass through the converter. Everything outside them keeps its
// original Markdown spelling, including reference definitions and line endings.
import { isHeadingIdentity } from "./portable-blocks.js";

const sections = [
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
  "SpecHeadingSix",
];
const normalized = (text) => text.replace(/\r\n?/g, "\n");
function literal(tex) {
  const ticks = "~".repeat(
    Math.max(3, ...Array.from(tex.matchAll(/^~+/gm), (m) => m[0].length + 1)),
  );
  return ticks + "speccraft-latex\n" + tex + "\n" + ticks;
}
const escapeTex = (text) =>
  text.replace(
    /[\\{}%&#_$^~]/g,
    (c) =>
      ({
        "\\": "\\textbackslash{}",
        "^": "\\textasciicircum{}",
        "~": "\\textasciitilde{}",
      })[c] || "\\" + c,
  );
function inlineTex(tokens) {
  let value = "";
  for (const t of tokens) {
    if (t.type === "text") value += escapeTex(t.content);
    else if (t.type === "softbreak") value += "\n";
    else if (t.type === "link_open")
      value += "\\href{" + escapeTex(t.attrGet("href")) + "}{";
    else if (t.type === "link_close") value += "}";
    else if (t.type === "math_inline") value += "$" + t.content + "$";
    else if (t.type === "strong_open") value += "\\textbf{";
    else if (t.type === "em_open") value += "\\emph{";
    else if (["strong_close", "em_close"].includes(t.type)) value += "}";
    else if (t.type === "code_inline")
      value += "\\texttt{" + escapeTex(t.content) + "}";
    else return null;
  }
  return value;
}
function inlineMarkdown(tex) {
  let pos = 0;
  function read(nested) {
    let result = "";
    while (pos < tex.length) {
      const character = tex[pos++];
      if (character === "}" && nested) return result;
      if (character === "{" || character === "}") throw Error();
      if (character === "$") {
        const math = /^(?:\\.|[^$\n])+\$/.exec(tex.slice(pos));
        if (!math) throw Error();
        result += "$" + math[0];
        pos += math[0].length;
        continue;
      }
      if (character !== "\\") {
        result += /[*\[\]`~]/.test(character) ? "\\" + character : character;
        continue;
      }
      const special =
        /^(?:textbackslash\{\}|textasciicircum\{\}|textasciitilde\{\}|[{}%&#_$])/.exec(
          tex.slice(pos),
        );
      if (special) {
        const s = special[0];
        pos += s.length;
        result +=
          {
            "textbackslash{}": "\\\\",
            "textasciicircum{}": "^",
            "textasciitilde{}": "\\~",
            _: "\\_",
            $: "\\$",
          }[s] ?? s;
        continue;
      }
      const field =
        /^(href|texttt)\{((?:\\(?:textbackslash|textasciicircum|textasciitilde)\{\}|\\.|[^{}])*)\}/.exec(
          tex.slice(pos),
        );
      if (field) {
        pos += field[0].length;
        const content = decodeField(field[2]);
        if (field[1] === "href") {
          if (tex[pos++] !== "{" || /[<>\n]/.test(content)) throw Error();
          result += "[" + read(true) + "](<" + content + ">)";
        } else {
          const fence = "`".repeat(
            1 +
              Math.max(
                0,
                ...Array.from(content.matchAll(/`+/g), (m) => m[0].length),
              ),
          );
          const pad =
            /^`|`$/.test(content) ||
            (/^ /.test(content) && / $/.test(content) && content.trim())
              ? " "
              : "";
          result += fence + pad + content + pad + fence;
        }
        continue;
      }
      const command = /^(textbf|emph|textit)\{/.exec(tex.slice(pos));
      if (!command) throw Error();
      pos += command[0].length;
      const content = read(true);
      const marker = command[1] === "textbf" ? "**" : "*";
      result += marker + content + marker;
    }
    if (nested) throw Error();
    return result;
  }
  return read(false);
}
function convert(tex, library, assets) {
  if (library.has(tex)) return library.get(tex);
  if (isHeadingIdentity(tex)) return tex;
  try {
    const figure =
      /^\\begin\{figure\}\n\\includegraphics\{([^{}\n]+)\}(?:\n\\caption\{(.*)\})?\n\\end\{figure\}$/.exec(
        tex,
      );
    if (figure) {
      const asset = assets.get(figure[1]);
      if (!asset && /^assets\/image-\d+\./.test(figure[1])) return literal(tex);
      const path = asset?.src ?? figure[1];
      if (/[<>\r\n]/.test(path)) return literal(tex);
      const caption = figure[2] ? decodeField(figure[2]) : "";
      return (
        "![" +
        (asset?.alt || "").replace(/[\\\[\]]/g, "\\$&") +
        "](<" +
        path +
        ">" +
        (caption ? ' "' + caption.replace(/["\\]/g, "\\$&") + '"' : "") +
        ")" +
        (asset?.width ? "{width=" + asset.width + "%}" : "")
      );
    }
    const heading = /^\\(\w+)\{([\s\S]*)\}$/.exec(tex);
    if (heading && sections.includes(heading[1]))
      return (
        "#".repeat(sections.indexOf(heading[1]) + 1) +
        " " +
        inlineMarkdown(heading[2])
      );
    const env =
      /^\\begin\{(equation\*?|itemize|enumerate|tabular)\}(?:\{([lcr]+)\})?[ \t]*\n([\s\S]*?)\n\\end\{\1\}$/.exec(
        tex,
      );
    if (env) {
      if (env[1].startsWith("equation")) return "$$\n" + env[3] + "\n$$";
      if (env[1] === "tabular" && env[2]) {
        const rows = env[3]
          .split(/\\\\[ \t]*(?:\n|$)/)
          .filter((v) => v.trim())
          .map((row) =>
            row
              .split(/(?<!\\)&/)
              .map((cell) =>
                inlineMarkdown(cell.trim()).replaceAll("|", "\\|"),
              ),
          );
        if (!rows.length || rows.some((row) => row.length !== env[2].length))
          return literal(tex);
        rows.splice(
          1,
          0,
          [...env[2]].map((c) => ({ l: "---", c: ":---:", r: "---:" })[c]),
        );
        return rows.map((row) => "| " + row.join(" | ") + " |").join("\n");
      }
      const lines = env[3].split("\n");
      if (lines.every((s) => /^\\item /.test(s)))
        return lines
          .map(
            (s, i) =>
              (env[1] === "itemize" ? "- " : i + 1 + ". ") +
              inlineMarkdown(s.slice(6)),
          )
          .join("\n");
    }
    const display = /^\\\[\s*([\s\S]*?)\s*\\\]$/.exec(tex);
    if (display) return "$$\n" + display[1] + "\n$$";
    return inlineMarkdown(tex);
  } catch {
    return literal(tex);
  }
}
function texBlocks(text, library, assets) {
  // A blank line inside an environment is part of that environment.
  const lines = text.split("\n"),
    blocks = [];
  for (let i = 0; i < lines.length; ) {
    if (!lines[i].trim()) {
      blocks.push(lines[i++]);
      continue;
    }
    const start = i++,
      env = /^\\begin\{([^}]+)\}/.exec(lines[start]);
    if (env) {
      while (i < lines.length && lines[i] !== "\\end{" + env[1] + "}") i++;
      if (i < lines.length) i++;
    } else if (lines[start].trim() === "\\[") {
      while (i < lines.length && lines[i].trim() !== "\\]") i++;
      if (i < lines.length) i++;
    } else if (
      !isHeadingIdentity(lines[start]) &&
      !/^\\(?:section|subsection|subsubsection|paragraph|subparagraph|Spec\w+)\{/.test(
        lines[start],
      )
    ) {
      while (
        i < lines.length &&
        lines[i].trim() &&
        !isHeadingIdentity(lines[i]) &&
        !/^\\(?:begin|section|subsection|subsubsection|Spec\w+)\{/.test(
          lines[i],
        )
      )
        i++;
    }
    blocks.push(convert(lines.slice(start, i).join("\n"), library, assets));
  }
  return blocks.join("\n");
}
// Fields use only literal printable characters and an explicit line-break escape.
function encodeField(s) {
  return escapeTex(s).replaceAll("\n", "\\newline{}");
}
function decodeField(s) {
  return s.replace(
    /\\(textbackslash\{\}|textasciicircum\{\}|textasciitilde\{\}|newline\{\}|[{}%&#_$])/g,
    (_, key) =>
      ({
        "textbackslash{}": "\\",
        "textasciicircum{}": "^",
        "textasciitilde{}": "~",
        "newline{}": "\n",
      })[key] ?? key,
  );
}
function partTex(p, index, assets) {
  const t = p.t,
    inline = p.tokens.find((item) => item.type === "inline");
  const children = inline?.children?.filter(
    (c) => c.type !== "text" || c.content.trim(),
  );
  if (
    t.type === "paragraph_open" &&
    children?.length === 1 &&
    children[0].type === "image"
  ) {
    const image = children[0],
      src = image.attrGet("src");
    const local = /^data:image\/(\w+);base64,/.exec(src);
    const path = local ? "assets/image-" + (index + 1) + "." + local[1] : src;
    if (!/[{}\n]/.test(path)) {
      assets.set(path, {
        src,
        alt: image.content,
        width: image.attrGet("data-image-width"),
      });
      const caption = image.attrGet("title");
      return [
        "\\begin{figure}",
        "\\includegraphics{" + path + "}",
        ...(caption ? ["\\caption{" + encodeField(caption) + "}"] : []),
        "\\end{figure}",
      ].join("\n");
    }
  }
  if (t.type === "math_block")
    return "\\begin{equation}\n" + t.content + "\n\\end{equation}";
  if (t.type === "fence" && t.info.trim() === "speccraft-latex")
    return t.content.replace(/\n$/, "");
  if (t.type === "paragraph_open" || t.type === "heading_open") {
    const value = inline && inlineTex(inline.children);
    if (value != null)
      return t.type === "heading_open"
        ? "\\" + sections[Number(t.tag.slice(1)) - 1] + "{" + value + "}"
        : value;
  }
  if (
    t.type === "table_open" ||
    t.type === "ordered_list_open" ||
    t.type === "bullet_list_open"
  ) {
    const content = p.tokens
      .filter((t) => t.type === "inline")
      .map((t) => inlineTex(t.children));
    if (content.every((s) => s !== null && !s.includes("\n"))) {
      if (t.type === "table_open") {
        const columns = p.tokens.filter((t) => t.type === "th_open");
        if (columns.length && content.length % columns.length === 0) {
          const lines = [];
          for (let i = 0; i < content.length; i += columns.length)
            lines.push(
              content.slice(i, i + columns.length).join(" & ") + " \\\\",
            );
          const spec = columns
            .map(
              (t) =>
                ({ right: "r", center: "c" })[
                  t.attrGet("style")?.split(":").at(-1)
                ] || "l",
            )
            .join("");
          return (
            "\\begin{tabular}{" +
            spec +
            "}\n" +
            lines.join("\n") +
            "\n\\end{tabular}"
          );
        }
      } else if (
        p.tokens.filter((x) => x.type === "list_item_open").length ===
          content.length &&
        !p.tokens.some((x) => x.type === "list_item_open" && x.level > 1)
      ) {
        const kind = t.type === "ordered_list_open" ? "enumerate" : "itemize";
        return (
          "\\begin{" +
          kind +
          "}\n" +
          content.map((s) => "\\item " + s).join("\n") +
          "\n\\end{" +
          kind +
          "}"
        );
      }
    }
  }
  const kind = inline?.children?.some((t) => t.type === "image")
    ? "Image"
    : t.type === "fence"
      ? "Listing"
      : "Block";
  return "\\Spec" + kind + "{" + (index + 1) + "}";
}
export function latexProjection(body, parts) {
  const entries = [],
    library = new Map(),
    assets = new Map();
  let cursor = 0,
    length = 0;
  const add = (raw, tex, start, block) => {
    tex = normalized(tex);
    entries.push({
      start,
      end: start + raw.length,
      from: length,
      to: length + tex.length,
      tex,
      raw,
      block,
    });
    length += tex.length;
  };
  parts.forEach((p, i) => {
    if (p.start > cursor)
      add(
        body.slice(cursor, p.start),
        body.slice(cursor, p.start),
        cursor,
        null,
      );
    const value = partTex(p, i, assets);
    add(p.text, value, p.start, i);
    library.set(normalized(value), normalized(p.text));
    cursor = p.end;
  });
  if (cursor < body.length)
    add(body.slice(cursor), body.slice(cursor), cursor, null);
  const text = entries.map((e) => e.tex).join("");
  return {
    text,
    entries,
    apply(next) {
      if (next === text) return body;
      let left = 0,
        right = text.length,
        tail = next.length;
      while (left < right && left < tail && text[left] === next[left]) left++;
      while (
        right > left &&
        tail > left &&
        text[right - 1] === next[tail - 1]
      ) {
        right--;
        tail--;
      }
      const first = entries.find(
        (e) => e.to > left || (e.to === left && e.block !== null),
      );
      const last = entries.findLast(
        (e) => e.from < right || (e.from === right && e.block !== null),
      );
      let from = first?.from ?? length,
        to = last?.to ?? from;
      if (to < from) to = from;
      const start = first?.start ?? body.length,
        end = last && last.to >= from ? last.end : start;
      const replacement = texBlocks(
        next.slice(from, to + next.length - length),
        library,
        assets,
      );
      return (
        body.slice(0, start) +
        replacement.replaceAll("\n", body.match(/\r\n|\n|\r/)?.[0] || "\n") +
        body.slice(end)
      );
    },
  };
}
