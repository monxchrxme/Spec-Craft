import { isExcalidraw } from "./excalidraw.js";

const foldedLabel = /⟪(?:фото|Excalidraw) \d+⟫/g;

// Folded assets and native textarea newlines change the displayed offsets.
export function markdownSource(body, parts, compact) {
  const folded = [];
  if (compact) {
    const numbers = { фото: 0, Excalidraw: 0 };
    const allUrls = new Set();
    function foldAsset(start, end, name) {
      let value;
      do {
        value = "⟪" + name + " " + ++numbers[name] + "⟫";
      } while (body.includes(value));
      folded.push({ start, end, value, asset: true });
    }
    function foldAt(urls, offset, angled) {
      const url = urls.find(
        (url) =>
          body.startsWith(url, offset) &&
          (angled
            ? body[offset + url.length] === ">"
            : /[\s)]/.test(body[offset + url.length] || " ")),
      );
      if (url) foldAsset(offset, offset + url.length, "фото");
    }
    // Reference definitions are outside the rendered block ranges.
    let previous = 0;
    const gaps = [];
    for (const part of parts) {
      if (part.start > previous) gaps.push([previous, part.start]);
      previous = part.end;
      if (isExcalidraw(part.t)) {
        const opener = /^[^\r\n]*(?:\r\n|\r|\n)/.exec(part.text);
        const closer = /(?:\r\n|\r|\n)[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(part.text);
        if (opener && closer?.[1].startsWith(part.t.markup) &&
            closer.index - opener[0].length >= 256)
          foldAsset(part.start + opener[0].length, part.start + closer.index, "Excalidraw");
        continue;
      }
      const urls = part.tokens
        .flatMap((token) =>
          (token.children || [])
            .filter((child) => child.type === "image")
            .map((child) => child.attrGet("src")),
        )
        .filter((url) => url && url.length >= 96);
      if (!urls.length) continue;
      urls.forEach((url) => allUrls.add(url));
      // Skip inline code so Markdown examples stay literal.
      for (const match of part.text.matchAll(
        /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|(?<!\\)!\[(?:\\.|[^\]\\\n])*\]\(\s*(<?)/g,
      )) {
        if (match[2] !== undefined)
          foldAt(urls, part.start + match.index + match[0].length, match[2]);
      }
    }
    if (previous < body.length) gaps.push([previous, body.length]);
    if (allUrls.size)
      for (const [from, to] of gaps) {
        for (const match of body
          .slice(from, to)
          .matchAll(/^ {0,3}\[(?:\\.|[^\]\n])+\]:[ \t]*(<?)/gm))
          foldAt([...allUrls], from + match.index + match[0].length, match[1]);
      }
  }
  const changes = [];
  function visibleNewlines(from, to) {
    for (const m of body.slice(from, to).matchAll(/\r\n?/g))
      changes.push({ start: from + m.index, end: from + m.index + m[0].length, value: "\n" });
  }
  let visibleFrom = 0;
  for (const item of folded.sort((a, b) => a.start - b.start)) {
    visibleNewlines(visibleFrom, item.start);
    changes.push(item);
    visibleFrom = item.end;
  }
  visibleNewlines(visibleFrom, body.length);
  let end = 0,
    text = "";
  for (const item of changes) {
    text += body.slice(end, item.start);
    item.from = text.length;
    text += item.value;
    item.to = text.length;
    end = item.end;
  }
  text += body.slice(end);
  function map(pos, sourceStart, sourceEnd, targetStart, targetEnd, right) {
    let lo = 0,
      hi = changes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (changes[mid][sourceStart] < pos) lo = mid + 1;
      else hi = mid;
    }
    const item = changes[lo - 1];
    if (!item) return pos;
    if (pos < item[sourceEnd])
      return right ? item[targetEnd] : item[targetStart];
    return pos - item[sourceEnd] + item[targetEnd];
  }
  const raw = (pos, right = false) =>
    map(pos, "from", "to", "start", "end", right);
  const display = (pos, right = false) =>
    map(pos, "start", "end", "from", "to", right);
  const assets = new Map(
    folded.map((item) => [item.value, body.slice(item.start, item.end)]),
  );
  return {
    text,
    raw,
    display,
    changes,
    apply(next) {
      if (next === text) return { body, caret: raw };
      let left = 0,
        oldEnd = text.length,
        nextEnd = next.length;
      while (left < oldEnd && left < nextEnd && text[left] === next[left])
        left++;
      while (
        oldEnd > left &&
        nextEnd > left &&
        text[oldEnd - 1] === next[nextEnd - 1]
      ) {
        oldEnd--;
        nextEnd--;
      }
      const start = raw(left),
        finish = raw(oldEnd, true);
      const newline = body.match(/\r\n|\r|\n/)?.[0] || "\n";
      const expanded = (value) =>
        value
          .replaceAll("\n", newline)
          .replace(foldedLabel, (key) => assets.get(key) ?? key);
      const inserted = expanded(next.slice(left, nextEnd));
      return {
        body: body.slice(0, start) + inserted + body.slice(finish),
        caret(pos) {
          if (pos < left) return raw(pos);
          if (pos <= nextEnd)
            return start + expanded(next.slice(left, pos)).length;
          return (
            raw(pos - nextEnd + oldEnd) + inserted.length - (finish - start)
          );
        },
      };
    },
  };
}
