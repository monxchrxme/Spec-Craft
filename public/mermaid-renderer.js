(() => {
  const parentOrigin = location.origin;
  if (window.parent === window || !window.mermaid) return;
  const engine = window.mermaid;
  // Keep document directives from enabling active content or exporting labels as HTML.
  const safeConfig = {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: "Arial, sans-serif",
    maxTextSize: 48_000,
    maxEdges: 500,
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "suppressErrorRendering",
      "maxTextSize",
      "maxEdges",
      "htmlLabels",
      "flowchart",
      "dompurifyConfig",
      "themeCSS",
      "fontFamily",
    ],
  };
  engine.initialize(safeConfig);
  const layouts = {
    compact: {
      layout: "dagre",
      flowchart: {
        htmlLabels: false,
        nodeSpacing: 25,
        rankSpacing: 35,
        curve: "basis",
      },
      state: { padding: 7, edgeLengthFactor: 12, labelHeight: 14 },
    },
    elk: {
      layout: "elk",
      elk: { preset: "modelOrder", forceNodeModelOrder: true },
    },
  };
  const themes = {
    neutral: { theme: "neutral", look: "classic" },
    blue: {
      theme: "base",
      look: "classic",
      themeVariables: {
        background: "#ffffff",
        primaryColor: "#e3efff",
        primaryTextColor: "#152a49",
        primaryBorderColor: "#3974b6",
        lineColor: "#37567b",
        edgeLabelBackground: "#f0f6ff",
      },
    },
  };
  const stage = document.querySelector("main");
  let queue = Promise.resolve();
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const { type, id, source, layout, theme } = event.data || {};
    if (
      type !== "speccraft-mermaid-render" ||
      !Number.isSafeInteger(id) ||
      typeof source !== "string" ||
      source.length > 48_000
    )
      return;
    const reply = (fields) =>
      event.source.postMessage(
        { type: "speccraft-mermaid-result", id, ...fields },
        parentOrigin,
      );
    queue = queue.then(async () => {
      try {
        const preset = Object.hasOwn(layouts, layout) ? layouts[layout] : {};
        const palette = Object.hasOwn(themes, theme) ? themes[theme] : {};
        engine.initialize({
          ...safeConfig,
          ...preset,
          ...palette,
          secure: [
            ...safeConfig.secure,
            ...(preset.layout ? ["layout", "elk", "state"] : []),
            ...(palette.theme ? ["theme", "themeVariables", "look"] : []),
          ],
        });
        const output = await engine.render("specmermaid-" + id, source, stage);
        const svg = new DOMParser().parseFromString(
          output.svg,
          "image/svg+xml",
        ).documentElement;
        if (
          svg.localName !== "svg" ||
          svg.namespaceURI !== "http://www.w3.org/2000/svg"
        )
          throw Error("Не получено изображение SVG.");
        const viewBox = svg
          .getAttribute("viewBox")
          ?.trim()
          .split(/[\s,]+/)
          .map(Number);
        const width = Math.ceil(
          viewBox?.[2] || Number.parseFloat(svg.getAttribute("width")),
        );
        const height = Math.ceil(
          viewBox?.[3] || Number.parseFloat(svg.getAttribute("height")),
        );
        if (!(width > 0 && height > 0 && width <= 50_000 && height <= 50_000))
          throw Error("Размер диаграммы выходит за допустимые пределы.");
        if (!viewBox?.length)
          svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        svg.style.removeProperty("max-width");
        svg.style.removeProperty("width");
        svg.style.removeProperty("height");
        const background =
          engine.mermaidAPI?.getConfig()?.themeVariables?.background;
        svg.style.backgroundColor = /^#[\da-f]{3,8}$/i.test(background)
          ? background
          : "#ffffff";
        svg.querySelectorAll("script").forEach((element) => element.remove());
        for (const link of svg.querySelectorAll("a"))
          link.replaceWith(...link.childNodes);
        const markup = new XMLSerializer().serializeToString(svg);
        if (markup.length > 2_000_000)
          throw Error("Диаграмма слишком большая.");
        const label = svg
          .querySelector("title,desc")
          ?.textContent.trim()
          .slice(0, 250);
        reply({ svg: markup, width, height, label });
      } catch (error) {
        reply({ error: String(error?.message || error).slice(0, 550) });
      } finally {
        stage.replaceChildren();
      }
    });
  });
  window.parent.postMessage({ type: "speccraft-mermaid-ready" }, parentOrigin);
})();
