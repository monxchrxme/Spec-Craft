import { canonical } from "./spec-index.js";
export function enableWikiSuggestions(getTargets) {
  const menu = document.createElement("div");
  menu.className = "wiki-suggestions";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Цели ссылки");
  document.body.append(menu);
  let input,
    start,
    choices = [],
    active = 0;
  function close() {
    menu.hidden = true;
    input = null;
  }
  function choose(i) {
    if (!input || !choices[i]) return;
    const el = input,
      after = el.value.slice(el.selectionStart);
    const end = el.selectionStart + (after.startsWith("]]") ? 2 : 0);
    el.setRangeText("[[" + choices[i] + "]]", start, end, "end");
    close();
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function select(i) {
    active = (i + choices.length) % choices.length;
    Array.from(menu.children).forEach((b, j) =>
      b.setAttribute("aria-selected", String(j === active)),
    );
    menu.children[active]?.scrollIntoView({ block: "nearest" });
  }
  document.addEventListener("input", (e) => {
    if (!e.target.matches("#source,.source-edit")) return;
    const el = e.target,
      pos = el.selectionStart,
      m = el.value.slice(0, pos).match(/\[\[([^\[\]\n|]*)$/);
    if (!m || el.selectionEnd !== pos) {
      close();
      return;
    }
    const q = canonical(m[1]);
    const candidates = getTargets();
    choices = [
      ...new Set(
        candidates
          .filter(
            (t) =>
              canonical(t.label).includes(q) ||
              canonical(t.id || "").includes(q),
          )
          .map((t) => t.id || t.label),
      ),
    ].slice(0, 30);
    if (!choices.length) {
      close();
      return;
    }
    input = el;
    start = pos - m[0].length;
    menu.replaceChildren();
    choices.forEach((name, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.setAttribute("role", "option");
      b.tabIndex = -1;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => choose(i);
      menu.append(b);
    });
    const rect = el.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left =
      Math.max(6, Math.min(rect.left, innerWidth - menu.offsetWidth - 6)) +
      "px";
    menu.style.top =
      Math.max(4, Math.min(rect.bottom, innerHeight - menu.offsetHeight - 8)) +
      "px";
    select(0);
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (menu.hidden || e.target !== input || e.isComposing) return;
      if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === "Enter") choose(active);
        else if (e.key === "Escape") close();
        else select(active + (e.key === "ArrowDown" ? 1 : -1));
      } else if (
        ["ArrowLeft", "ArrowRight", "Tab", "Home", "End"].includes(e.key)
      )
        close();
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!menu.contains(e.target)) close();
    },
    true,
  );
  document.addEventListener("focusin", (e) => {
    if (e.target !== input && !menu.contains(e.target)) close();
  });
}
