const maxFormulaLength = 8192;
let engine;
const cache = new Map();
const pending = new WeakMap();

function mathEngine() {
  if (!engine) {
    engine = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./vendor/mathjax/tex-svg.js", import.meta.url).href;
      window.MathJax = {
        startup: { typeset: false },
        options: { enableMenu: false },
        tex: {
          packages: ["base", "ams"],
          maxBuffer: maxFormulaLength,
          maxMacros: 1000,
          formatError: (_jax, error) => {
            throw error;
          },
        },
        svg: { fontCache: "none" },
      };
      script.onload = () =>
        window.MathJax.startup.promise.then(
          () => resolve(window.MathJax),
          reject,
        );
      script.onerror = () => {
        script.remove();
        reject(Error("Не удалось загрузить движок формул."));
      };
      document.head.append(script);
    }).catch((error) => {
      engine = undefined;
      throw error;
    });
  }
  return engine;
}

export async function formulaSvg(content, display) {
  if (content.length > maxFormulaLength)
    throw Error("Формула слишком длинная.");
  const key = (display ? "D" : "I") + content;
  if (cache.has(key)) return cache.get(key).cloneNode(true);
  const math = await mathEngine();
  math.texReset();
  const svg = math.tex2svg(content, { display }).querySelector("svg");
  if (!svg || svg.querySelector('[data-mml-node="merror"]'))
    throw Error("Проверьте синтаксис LaTeX.");
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(key, svg);
  return svg.cloneNode(true);
}

async function paintFormula(node) {
  try {
    const svg = await formulaSvg(
      node.dataset.tex,
      node.classList.contains("math-display"),
    );
    node.replaceChildren(svg);
    node.setAttribute("role", "math");
    node.setAttribute("aria-label", node.dataset.tex);
  } catch (error) {
    const message = document.createElement("span");
    message.className = "math-error-label";
    message.textContent = "Ошибка LaTeX";
    node.classList.add("math-error");
    node.title = error.message;
    node.append(" ", message);
  }
  node.dataset.mathReady = "";
}

export function paintMath(root) {
  return Promise.all(
    Array.from(
      root.querySelectorAll("[data-tex]:not([data-math-ready])"),
      (node) => {
        if (!pending.has(node)) pending.set(node, paintFormula(node));
        return pending.get(node);
      },
    ),
  );
}

function inlineMath(state, silent) {
  const start = state.pos;
  const src = state.src;
  const dollar = src[start] === "$";
  if (dollar) {
    if (
      src[start - 1] === "$" ||
      src[start + 1] === "$" ||
      /\s/.test(src[start + 1] || "")
    )
      return false;
  } else if (!src.startsWith("\\(", start)) return false;
  const from = start + (dollar ? 1 : 2);
  for (
    let pos = from;
    pos < state.posMax && pos - from <= maxFormulaLength;
    pos++
  ) {
    if (src[pos] === "\n") return false;
    const closing = dollar ? src[pos] === "$" : src.startsWith("\\)", pos);
    if (closing) {
      // Dollar signs in prices and double-dollar delimiters are ordinary text here.
      if (
        dollar &&
        (src[pos + 1] === "$" ||
          /\d/.test(src[pos + 1] || "") ||
          /\s/.test(src[pos - 1]))
      )
        return false;
      const content = src.slice(from, pos).trim();
      if (!content) return false;
      if (!silent) state.push("math_inline", "span", 0).content = content;
      state.pos = pos + (dollar ? 1 : 2);
      return true;
    }
    if (src[pos] === "\\") pos++;
  }
  return false;
}

function blockMath(state, start, end, silent) {
  if (state.sCount[start] - state.blkIndent >= 4) return false;
  const lineAt = (line) =>
    state.src
      .slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
      .trimEnd();
  const first = lineAt(start);
  const open = first.slice(0, 2);
  if (open !== "$$" && open !== "\\[") return false;
  const close = open === "$$" ? "$$" : "\\]";
  const lines = [];
  let length = 0;
  for (let line = start; line < end; line++) {
    if (
      line > start &&
      state.sCount[line] < state.blkIndent &&
      !state.isEmpty(line)
    )
      break;
    const text = line === start ? first.slice(2) : lineAt(line);
    if (text.endsWith(close)) {
      lines.push(text.slice(0, -2));
      const content = lines.join("\n").trim();
      if (!content) return false;
      if (silent) return true;
      const token = state.push("math_block", "div", 0);
      token.block = true;
      token.content = content;
      token.map = [start, line + 1];
      state.line = line + 1;
      return true;
    }
    length += text.length + 1;
    if (length > maxFormulaLength) break;
    lines.push(text);
  }
  return false;
}

export function latex(md) {
  md.inline.ruler.before("escape", "math_inline", inlineMath);
  md.block.ruler.before("fence", "math_block", blockMath, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  for (const [type, tag, className] of [
    ["math_inline", "span", "math-inline"],
    ["math_block", "div", "math-display"],
  ]) {
    md.renderer.rules[type] = (tokens, index) => {
      const tex = md.utils.escapeHtml(tokens[index].content);
      return (
        "<" +
        tag +
        ' class="' +
        className +
        '" data-tex="' +
        tex +
        '">' +
        tex +
        "</" +
        tag +
        ">"
      );
    };
  }
}
