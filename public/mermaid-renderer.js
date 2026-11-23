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
  const midnightBackground = "#ffffff";
  const midnightInk = "#82b4ff";
  const midnightEdgeInk = "#24508d";
  const midnightEdgeBackground = "#dbeafe";
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
    midnight: {
      theme: "base",
      look: "classic",
      darkMode: true,
      fontFamily: "system-ui, sans-serif",
      themeVariables: {
        darkMode: true,
        background: midnightBackground,
        primaryColor: "#0a203e",
        primaryTextColor: midnightInk,
        primaryBorderColor: "#304767",
        secondaryColor: "#18283d",
        secondaryTextColor: midnightInk,
        tertiaryColor: "#18212d",
        tertiaryTextColor: midnightInk,
        textColor: midnightEdgeInk,
        lineColor: "#667381",
        edgeLabelBackground: midnightEdgeBackground,
      },
      themeCSS: `
        .node > rect:is([rx="0"], :not([rx])) { rx: 12px; ry: 12px; }
        .node .label tspan[font-weight="normal"],
        .edgeLabel tspan[font-weight="normal"] { font-weight: 600; }
        .flowchart-link { stroke-linecap: round; stroke-linejoin: round; }
        .edgeLabel rect.background {
          fill: ${midnightEdgeBackground};
          stroke: ${midnightEdgeInk};
          stroke-width: 1px;
          opacity: 1;
        }
        .edgeLabel text { fill: ${midnightEdgeInk}; }
      `,
    },
  };
  function padMidnightLabels(svg) {
    const labels = svg.querySelectorAll(
      ".edgeLabel rect.background[width][height]",
    );
    for (const rect of labels) {
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      const width = Number(rect.getAttribute("width"));
      const height = Number(rect.getAttribute("height"));
      if (
        !(width > 0 && height > 0 && [x, y, width, height].every(Number.isFinite))
      )
        continue;
      rect.setAttribute("x", x - 8);
      rect.setAttribute("y", y - 2);
      rect.setAttribute("width", width + 16);
      rect.setAttribute("height", height + 4);
      rect.setAttribute("rx", (height + 4) / 2);
    }
  }
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
            ...(theme === "midnight" ? ["darkMode"] : []),
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
        if (
          theme === "midnight" &&
          viewBox?.length === 4 &&
          viewBox.every(Number.isFinite)
        ) {
          viewBox[0] -= 10;
          viewBox[1] -= 10;
          viewBox[2] += 20;
          viewBox[3] += 20;
          svg.setAttribute("viewBox", viewBox.join(" "));
        }
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
        if (theme === "midnight") {
          padMidnightLabels(svg);
          const backdrop = svg.ownerDocument.createElementNS(
            svg.namespaceURI,
            "rect",
          );
          backdrop.setAttribute("x", viewBox?.[0] || 0);
          backdrop.setAttribute("y", viewBox?.[1] || 0);
          backdrop.setAttribute("width", viewBox?.[2] || width);
          backdrop.setAttribute("height", viewBox?.[3] || height);
          backdrop.setAttribute("fill", midnightBackground);
          svg.prepend(backdrop);
        }
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
