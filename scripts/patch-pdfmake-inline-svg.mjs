// Adds inline SVG runs to the vendored pdfmake 0.3.14 browser bundle.
// Usage: node scripts/patch-pdfmake-inline-svg.mjs path/to/unmodified/pdfmake.min.js
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw Error("Specify the unmodified pdfmake 0.3.14 browser bundle.");
let bundle = readFileSync(file, "utf8");

function replaceOnce(original, replacement) {
  const start = bundle.indexOf(original);
  if (start < 0 || bundle.indexOf(original, start + original.length) >= 0)
    throw Error("Expected a unique pdfmake 0.3.14 fragment.");
  bundle = bundle.replace(original, () => replacement);
}

replaceOnce(
  "t.height=t.font.lineHeight(t.fontSize)*a,t.leadingCut",
  // TextInlines.measure reserves the vector's own width and vertical metrics.
  "t.height=t.font.lineHeight(t.fontSize)*a,t.inlineSvg&&(t.width=t.inlineSvg._width,t.height=t.inlineSvg._height),t.leadingCut",
);

replaceOnce(
  "getHeight(){let t=0;return this.inlines.forEach(r=>{t=Math.max(t,r.height||0)}),t}getAscenderHeight(){let t=0;return this.inlines.forEach(r=>{t=Math.max(t,r.font.ascender/1e3*r.fontSize)}),t}",
  `getHeight(){
    // Combine the deepest descent with the highest ascent on mixed text/SVG lines.
    if(this.inlines.some(inline=>inline.inlineSvg)){
      const descent=Math.max(0,...this.inlines.map(inline=>inline.height-
        (inline.inlineSvg?.ascent??inline.font.ascender/1000*inline.fontSize)));
      return this.getAscenderHeight()+descent;
    }
    let t=0;return this.inlines.forEach(r=>{t=Math.max(t,r.height||0)}),t
  }
  getAscenderHeight(){
    let height=0;
    this.inlines.forEach(inline=>{
      height=Math.max(height,inline.inlineSvg?.ascent??inline.font.ascender/1000*inline.fontSize);
    });
    return height;
  }`,
);

replaceOnce(
  "this.pdfDocument.text(o.text,r+o.x,p,h),o.linkToPage&&",
  `(o.inlineSvg ? (() => {
    // r and n are the line origin, and o is the measured inline run.
    const x=r+o.x, y=n+t.getAscenderHeight()-o.inlineSvg.ascent;
    if(h.destination)this.pdfDocument.addNamedDestination(h.destination,"XYZ",x,y,null);
    this.renderSVG({...o.inlineSvg,x,y,link:o.link,linkToDestination:o.linkToDestination});
  })() : this.pdfDocument.text(o.text,r+o.x,p,h)),o.linkToPage&&`,
);

writeFileSync(file, bundle);
