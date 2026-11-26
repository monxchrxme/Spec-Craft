const glyphPaths = new Map();
const fontUrls = new Map();

function glyphPath(font, glyph) {
  let paths = glyphPaths.get(font.postscriptName);
  if (!paths) {
    paths = new Map();
    glyphPaths.set(font.postscriptName, paths);
  }
  if (!paths.has(glyph.id)) paths.set(glyph.id, new Path2D(glyph.path.toSVG()));
  return paths.get(glyph.id);
}

function inlineFont(url, files) {
  if (!fontUrls.has(url)) {
    const pending = new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([files.readFileSync(url)], { type: "font/ttf" }));
    });
    fontUrls.set(url, pending);
    void pending.catch(() => fontUrls.delete(url));
  }
  return fontUrls.get(url);
}

async function canvasImage(source, svg, fontUrl) {
  const image = new Image();
  if (svg) {
    if (/<text[\s>]/i.test(source)) {
      const weights = new Set(
        Array.from(source.matchAll(/<text\b[^>]*>/gi), ([tag]) =>
          /font-weight="(?:bold|[6-9]00)"/i.test(tag) ? "bold" : "normal",
        ),
      );
      const faces = await Promise.all([...weights].map(async (weight) =>
        '@font-face{font-family:Sans;src:url("' + await fontUrl(weight) +
          '");font-weight:' + weight + '}',
      ));
      source = source.replace(/<svg\b[^>]*>/i, (tag) =>
        tag + "<style>" + faces.join("") + "</style>",
      );
    }
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
  } else image.src = source;
  await image.decode();
  return image;
}

class CanvasPage {
  constructor(context, resources) {
    this.context = context;
    this.resources = resources;
    this.pathShape = new Path2D();
    this.fillAlpha = this.strokeAlpha = 1;
    this.states = [];
  }
  addPage({ size }) {
    this.page = { width: size[0], height: size[1] };
  }
  resolveColor(color, fallback) { return color || fallback; }
  providePattern() { return null; }
  addNamedDestination() {}
  annotate() {}
  link() {}
  goTo() {}
  ref() { return { end() {} }; }
  fontSize(size) { this.size = size; }
  opacity(value) {
    this.fillAlpha = this.strokeAlpha = value;
    return this;
  }
  fillColor(color, alpha) {
    if (color) this.context.fillStyle = color;
    if (alpha !== undefined) this.fillAlpha = alpha;
    return this;
  }
  strokeColor(color, alpha) {
    if (color) this.context.strokeStyle = color;
    if (alpha !== undefined) this.strokeAlpha = alpha;
    return this;
  }
  lineWidth(value) { this.context.lineWidth = value; return this; }
  lineJoin(value) { this.context.lineJoin = value; return this; }
  lineCap(value) { this.context.lineCap = value; return this; }
  dash(length, { space, phase }) {
    this.context.setLineDash([length, space]);
    this.context.lineDashOffset = phase;
    return this;
  }
  undash() { this.context.setLineDash([]); return this; }
  rect(...args) { this.pathShape.rect(...args); return this; }
  roundedRect(...args) { this.pathShape.roundRect(...args); return this; }
  ellipse(x, y, rx, ry) {
    this.pathShape.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
    return this;
  }
  moveTo(...args) { this.pathShape.moveTo(...args); return this; }
  lineTo(...args) { this.pathShape.lineTo(...args); return this; }
  bezierCurveTo(...args) { this.pathShape.bezierCurveTo(...args); return this; }
  closePath() { this.pathShape.closePath(); return this; }
  path(value) { this.pathShape.addPath(new Path2D(value)); return this; }
  fill(color) {
    this.fillColor(color);
    this.context.globalAlpha = this.fillAlpha;
    this.context.fill(this.pathShape);
    this.pathShape = new Path2D();
    return this;
  }
  stroke(color) {
    this.strokeColor(color);
    this.context.globalAlpha = this.strokeAlpha;
    this.context.stroke(this.pathShape);
    this.pathShape = new Path2D();
    return this;
  }
  fillAndStroke() {
    const shape = this.pathShape;
    this.fill();
    this.pathShape = shape;
    return this.stroke();
  }
  clip() {
    this.context.clip(this.pathShape);
    this.pathShape = new Path2D();
    return this;
  }
  save() {
    this.context.save();
    this.states.push([this.fillAlpha, this.strokeAlpha]);
    return this;
  }
  restore() {
    this.context.restore();
    [this.fillAlpha, this.strokeAlpha] = this.states.pop();
    return this;
  }
  translate(x, y) { this.context.translate(x, y); return this; }
  addContent(value) {
    // pdfmake writes this single rectangle operator for table cell clipping.
    const [x, y, width, height] = value.split(" ").map(Number);
    return this.rect(x, y, width, height);
  }
  image(id, x, y, { width, height }) {
    this.context.globalAlpha = this.fillAlpha;
    this.context.drawImage(this.resources.get(id), x, y, width, height);
  }
  text(value, x, y, options) {
    const text = value.replace(/\n/g, "");
    if (!text) return;
    const font = this._font;
    const { glyphs, positions } = font.layout(text, options.features);
    const unit = this.size / font.font.unitsPerEm;
    const em = this.size / 1000;
    const baseline = y + font.ascender * em;
    const matrix = new DOMMatrix([unit, 0, 0, -unit, 0, 0]);
    const run = new Path2D();
    for (let i = 0; i < glyphs.length; i++) {
      const { xOffset, yOffset, xAdvance } = positions[i];
      matrix.e = x + xOffset * em;
      matrix.f = baseline - yOffset * em;
      run.addPath(glyphPath(font.font, glyphs[i]), matrix);
      x += xAdvance * em + (options.characterSpacing || 0);
    }
    this.context.globalAlpha = this.fillAlpha;
    this.context.fill(run);
  }
}

// Use the same renderer for line runs, decorations, borders, and clipping.
export function makePagePainter(pages, pdfDocument, Renderer, fonts) {
  const decoded = new Map();
  const fontUrl = (weight) => inlineFont(fonts.Sans[weight], pdfDocument.virtualfs);
  return async (number, canvas, current) => {
    const page = pages[number - 1];
    const resources = new Map();
    function load(key, source, svg = false) {
      if (resources.has(key)) return;
      if (!decoded.has(key)) {
        const result = canvasImage(source, svg, fontUrl);
        decoded.set(key, result);
        void result.catch(() => decoded.delete(key));
        if (decoded.size > 32) decoded.delete(decoded.keys().next().value);
      }
      resources.set(key, decoded.get(key));
    }
    for (const { type, item } of page.items) {
      if (type === "image")
        load(item.image, pdfDocument.images[item.image] || item.image);
      if (type === "svg") load(item.svg, item.svg, true);
      if (type === "line")
        for (const { inlineSvg } of item.inlines)
          if (inlineSvg) load(inlineSvg.svg, inlineSvg.svg, true);
    }
    await Promise.all([...resources].map(async ([key, value]) =>
      resources.set(key, await value),
    ));
    if (!current()) return;
    const context = canvas.getContext("2d");
    context.setTransform(canvas.width / page.pageSize.width, 0, 0,
      canvas.height / page.pageSize.height, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, page.pageSize.width, page.pageSize.height);
    context.fillStyle = "#000";
    const surface = new CanvasPage(context, resources);
    const renderer = new Renderer(surface);
    renderer.renderSVG = ({ svg, x, y, _width, _height }) => {
      context.globalAlpha = 1;
      context.drawImage(resources.get(svg), x, y, _width, _height);
    };
    renderer.renderVector = (item) => Renderer.prototype.renderVector.call(renderer, { ...item });
    renderer.renderPages([page]);
  };
}
