import metrics from "../metrics.json";
import { ptToMm } from "@daport/core";

type FontMetrics = typeof metrics.regular;

function fm(bold: boolean): FontMetrics { return bold ? metrics.bold : metrics.regular; }

function isHangul(cp: number) { return (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f); }
function isWide(cp: number) { return isHangul(cp) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0xff00 && cp <= 0xffef); }

/** 문자열 폭(mm). fontSize는 pt */
export function measureWidth(text: string, fontSize: number, bold: boolean): number {
  const m = fm(bold);
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const w = (m.widths as Record<string, number>)[ch];
    units += w !== undefined ? w : isWide(cp) ? m.hangul : m.fallback * 0.6;
  }
  return ptToMm((units / m.unitsPerEm) * fontSize);
}

export function lineHeightMm(fontSize: number, lineHeight: number): number { return ptToMm(fontSize) * lineHeight; }

/** maxWidth(mm)에 맞춰 줄바꿈. 공백 우선, 없으면 문자 단위 */
export function wrapText(text: string, fontSize: number, bold: boolean, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    const tokens = para.split(/(\s+)/).filter((t) => t !== "");
    for (const tok of tokens) {
      const candidate = line + tok;
      if (measureWidth(candidate, fontSize, bold) <= maxWidth || line === "" && /^\s+$/.test(tok)) {
        line = candidate; continue;
      }
      if (/^\s+$/.test(tok)) { out.push(line); line = ""; continue; }
      if (line !== "") { out.push(line.trimEnd()); line = ""; }
      // 토큰 자체가 넘치면 문자 단위로 쪼갠다
      for (const ch of tok) {
        if (measureWidth(line + ch, fontSize, bold) <= maxWidth || line === "") line += ch;
        else { out.push(line); line = ch; }
      }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [""];
}
