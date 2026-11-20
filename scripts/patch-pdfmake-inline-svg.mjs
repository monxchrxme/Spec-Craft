// Adds inline SVG runs and SpecCraft pagination to pdfmake 0.3.14.
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

replaceOnce(
  "processSection(t){let r=this.writer.context().getCurrentPage();if(!r||r&&r.items.length)",
  `processSection(t){
    let context = this.writer.context(), r = context.getCurrentPage();
    // An earlier block's bottom margin can leave an empty sheet of its own size.
    if(r && !r.items.length && t.pageSize && t.pageSize !== "inherit" &&
      context.page === context.pages.length - 1){
      context.pages.pop();
      context.backgroundLength.pop();
      context.page--;
      r = null;
    }
    if(!r || r.items.length)`,
);

replaceOnce(
  ";for(;r&&(-1===i||n<i);){if(r.getHeight()>this.writer.context().availableHeight",
  `;
    if(t.specParagraph && r && i === -1){
      const lines = [r], context = this.writer.context();
      while ((r = this.buildNextLine(t))) lines.push(r);
      const fullHeight = context.getCurrentPage().pageSize.height -
        context.pageMargins.top - context.pageMargins.bottom;
      const totalHeight = lines.reduce((height,line) => height + line.getHeight(), 0);
      if(t.specKeepLines && totalHeight <= fullHeight && totalHeight > context.availableHeight &&
        context.y > context.pageMargins.top) this.writer.moveToNextPage(t.pageOrientation);
      for(let start = 0; start < lines.length;){
        let end = start, height = 0;
        while(end < lines.length && height + lines[end].getHeight() <= context.availableHeight){
          height += lines[end++].getHeight();
        }
        const fresh = context.y <= context.pageMargins.top;
        if(end < lines.length){
          if(end - start === 1 && !fresh) end = start;
          else if(lines.length - end === 1 && end - start > 2) end--;
          else if(lines.length - end === 1 && end - start === 2 && !fresh) end = start;
        }
        if(end === start && fresh) end++;
        while(start < end) t.positions.push(this.writer.addLine(lines[start++]));
        if(start < lines.length) this.writer.moveToNextPage(t.pageOrientation);
      }
      return;
    }
    for(;r&&(-1===i||n<i);){if(r.getHeight()>this.writer.context().availableHeight`,
);

replaceOnce(
  "!i.pageBreakCalculated){i.pageBreakCalculated",
  "(!i.pageBreakCalculated||i.specKeep)){i.pageBreakCalculated",
);

replaceOnce(
  "return u.pages}tryLayoutDocument",
  "h?.specLayout?.(u.pageBreakNodes,u.pages);return u.pages}tryLayoutDocument",
);

writeFileSync(file, bundle);
