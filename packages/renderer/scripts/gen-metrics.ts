import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "opentype.js";

type FontMetrics = { unitsPerEm: number; ascender: number; descender: number; hangul: number; fallback: number; widths: Record<string, number> };

// cwd와 무관하게 패키지 디렉터리를 기준으로 경로를 잡는다
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function build(path: string): FontMetrics {
  const buf = readFileSync(path);
  // Buffer는 풀 슬랩을 공유할 수 있으므로 자기 구간만 잘라 ArrayBuffer로 넘긴다
  const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const widths: Record<string, number> = {};
  // glyph index 0은 .notdef — 폰트에 없는 문자를 .notdef 폭으로 기록하지 않는다
  for (let cp = 0x20; cp <= 0x24f; cp++) {           // ASCII + Latin-1 + Latin Extended-A
    const ch = String.fromCodePoint(cp);
    const g = font.charToGlyph(ch);
    if (g && g.index !== 0 && g.advanceWidth) widths[ch] = g.advanceWidth;
  }
  for (const ch of "·※○●□■◎△▲▽▼◇◆☆★→←↑↓℃㎜㎏㎡") {
    const g = font.charToGlyph(ch);
    if (g && g.index !== 0 && g.advanceWidth) widths[ch] = g.advanceWidth;
  }
  const hangul = font.charToGlyph("가").advanceWidth ?? font.unitsPerEm;
  return { unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, hangul, fallback: hangul, widths };
}

const out = { regular: build(resolve(pkgDir, "fonts/Pretendard-Regular.otf")), bold: build(resolve(pkgDir, "fonts/Pretendard-Bold.otf")) };
writeFileSync(resolve(pkgDir, "src/metrics.json"), JSON.stringify(out));
console.log("metrics written", Object.keys(out.regular.widths).length, "glyphs");
