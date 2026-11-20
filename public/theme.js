// Apply the local interface preference before the first paint.
(() => {
  const key = "speccraft:theme";
  const themes = new Map([
    ["light", "Light"],
    ["dark", "Dark"],
    ["gruvbox-material", "Gruvbox Material"],
  ]);
  const root = document.documentElement;
  function apply(value) {
    root.dataset.theme = themes.has(value) ? value : "light";
    for (const picker of document.querySelectorAll("[data-theme-picker]"))
      picker.value = root.dataset.theme;
  }
  try {
    apply(localStorage.getItem(key));
  } catch {
    apply("light");
  }
  document.addEventListener("DOMContentLoaded", () => {
    for (const picker of document.querySelectorAll("[data-theme-picker]")) {
      for (const [value, label] of themes) picker.add(new Option(label, value));
      picker.value = root.dataset.theme;
      picker.onchange = () => {
        apply(picker.value);
        try {
          localStorage.setItem(key, picker.value);
        } catch {
          // Keep the theme active for this tab if storage is unavailable.
        }
      };
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
