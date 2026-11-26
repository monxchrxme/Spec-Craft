import { paintMath } from "./math.js";
import { headingInline } from "./portable-blocks.js";

const optionLabels = new WeakMap();

export function documentLabel(md, source) {
  const inline = typeof source === "string" ? md.parseInline(source, {})[0] : source;
  let remaining = 160;
  const tokens = [];
  for (const token of headingInline(inline)) {
    if (token.type === "math_inline") {
      tokens.push(token);
      remaining -= Math.min(32, token.content.length);
    } else {
      const content = token.content.replace(/\s+/g, " ");
      tokens.push({ ...token, content: content.slice(0, remaining) });
      remaining -= content.length;
    }
    if (remaining <= 0) {
      tokens.push({ type: "text", content: "…" });
      break;
    }
  }
  return {
    text: tokens.map((token) => token.content).join("").trim(),
    html: md.renderer.renderInline(tokens, md.options, {}).trim(),
  };
}

export function documentOption(label, value, { prefix = "", suffix = "" } = {}) {
  const text = typeof label === "string" ? label : label.text;
  const option = new Option(prefix + text + suffix, value);
  if (typeof label !== "string") optionLabels.set(option, { html: label.html, prefix, suffix });
  return option;
}

export function enhanceDocumentPicker(select) {
  if (typeof HTMLElement.prototype.showPopover !== "function") return () => {};
  const label = select.getAttribute("aria-label");
  const container = document.createElement("span");
  container.className = "document-picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "document-picker-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const display = document.createElement("span");
  display.className = "document-picker-label";
  trigger.append(display);
  const list = document.createElement("div");
  list.className = "document-picker-options";
  list.popover = "auto";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  trigger.popoverTargetElement = list;
  container.append(trigger, list);
  select.before(container);
  select.classList.add("document-picker-native");
  let displayed;

  function content(target, option) {
    const rich = optionLabels.get(option);
    if (!rich) target.textContent = option?.text || "";
    else {
      target.innerHTML = rich.html;
      target.prepend(rich.prefix);
      target.append(rich.suffix);
      void paintMath(target);
    }
  }

  function sync() {
    container.hidden = select.hidden;
    trigger.disabled = select.disabled || !select.length;
    if ((select.hidden || trigger.disabled) && list.matches(":popover-open"))
      list.hidePopover();
    const option = select.selectedOptions[0];
    if (displayed === option && trigger.hasAttribute("aria-label")) return;
    displayed = option;
    content(display, option);
    trigger.setAttribute("aria-label", option ? label + " · " + option.text : label);
    trigger.title = option?.text || label;
  }
  function choose(option) {
    list.hidePopover();
    trigger.focus({ preventScroll: true });
    if (select.value === option.value) return;
    select.value = option.value;
    sync();
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function position() {
    const rect = trigger.getBoundingClientRect();
    const above = rect.top - 8;
    const below = innerHeight - rect.bottom - 8;
    const downward = below >= 210 || below >= above;
    const width = Math.min(innerWidth - 16, Math.max(420, rect.width));
    Object.assign(list.style, {
      width: width + "px",
      left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + "px",
      top: downward ? rect.bottom + 4 + "px" : "auto",
      bottom: downward ? "auto" : innerHeight - rect.top + 4 + "px",
      maxHeight: Math.min(320, downward ? below : above) + "px",
    });
  }
  list.addEventListener("beforetoggle", (event) => {
    const open = event.newState === "open";
    trigger.setAttribute("aria-expanded", String(open));
    if (!open) return;
    list.replaceChildren(...Array.from(select.options, (option) => {
      const item = document.createElement("button");
      item.type = "button";
      item.tabIndex = -1;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.selected));
      item.disabled = option.disabled;
      content(item, option);
      item.onclick = () => choose(option);
      return item;
    }));
    position();
  });
  list.addEventListener("toggle", (event) => {
    if (event.newState === "open")
      (list.querySelector('[aria-selected="true"]:enabled') || list.querySelector(":enabled"))?.focus();
  });
  trigger.onkeydown = (event) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    list.showPopover();
  };
  list.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      list.hidePopover();
      trigger.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const option = event.target.closest('[role="option"]');
      if (option) {
        event.preventDefault();
        option.click();
      }
      return;
    }
    const options = [...list.querySelectorAll("button:enabled")];
    const current = options.indexOf(event.target);
    const target = {
      Home: options[0],
      End: options.at(-1),
      ArrowUp: options[Math.max(0, current - 1)],
      ArrowDown: options[Math.min(options.length - 1, current + 1)],
    }[event.key];
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };
  new MutationObserver((changes) => {
    if (changes.some((change) => change.type === "childList") && list.matches(":popover-open"))
      list.hidePopover();
    sync();
  }).observe(select, {
    attributes: true,
    attributeFilter: ["hidden", "disabled"],
    childList: true,
  });
  sync();
  return sync;
}
