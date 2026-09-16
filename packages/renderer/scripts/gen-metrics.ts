import { readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";

// opentype.js 1.3.x는 UMD/CJS 번들이라 Node ESM에서 named export를 인식하지 못한다
const { parse } = opentype;

type FontMetrics = { unitsPerEm: number; ascender: number; descender: number; hangul: number; fallback: number; widths: Record<string, number> };

function build(path: string): FontMetrics {
  const font = parse(readFileSync(path).buffer.slice(0));
  const widths: Record<string, number> = {};
  for (let cp = 0x20; cp <= 0x24f; cp++) {           // ASCII + Latin-1 + Latin Extended-A
    const ch = String.fromCodePoint(cp);
    const g = font.charToGlyph(ch);
    if (g && g.advanceWidth) widths[ch] = g.advanceWidth;
  }
  for (const ch of "·※○●□■◎△▲▽▼◇◆☆★→←↑↓℃㎜㎏㎡") {
    const g = font.charToGlyph(ch);
    if (g && g.advanceWidth) widths[ch] = g.advanceWidth;
  }
  const hangul = font.charToGlyph("가").advanceWidth ?? font.unitsPerEm;
  return { unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, hangul, fallback: hangul, widths };
}

const out = { regular: build("fonts/Pretendard-Regular.otf"), bold: build("fonts/Pretendard-Bold.otf") };
writeFileSync("src/metrics.json", JSON.stringify(out));
console.log("metrics written", Object.keys(out.regular.widths).length, "glyphs");
