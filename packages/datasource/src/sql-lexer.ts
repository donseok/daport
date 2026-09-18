const Q_CLOSE: Record<string, string> = { "[": "]", "{": "}", "(": ")", "<": ">" };
const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$#]/.test(c);

/**
 * 주석·문자열·q-인용·큰따옴표 식별자를 같은 길이의 공백으로 바꾼 결과와, 그중 하나라도 끝까지 닫히지
 * 않은 채 입력 끝에 도달했는지를 함께 돌려준다. maskSqlNoise/hasUnterminatedNoise가 이 한 스캔을 공유한다
 */
function scan(sql: string): { masked: string; unterminated: boolean } {
  const out = sql.split("");
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) out[k] = " "; };
  let i = 0;
  let unterminated = false;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], next = sql[i + 1];
    if (c === "-" && next === "-") { const e = sql.indexOf("\n", i + 2); const to = e < 0 ? n : e; blank(i, to); i = to; continue; }
    if (c === "/" && next === "*") { const e = sql.indexOf("*/", i + 2); if (e < 0) unterminated = true; const to = e < 0 ? n : e + 2; blank(i, to); i = to; continue; }
    const nPrefix = (sql[i - 1] === "n" || sql[i - 1] === "N") && !isWord(sql[i - 2]);
    if ((c === "q" || c === "Q") && next === "'" && (!isWord(sql[i - 1]) || nPrefix) && i + 2 < n) {
      const open = sql[i + 2], close = Q_CLOSE[open] ?? open;
      const e = sql.indexOf(close + "'", i + 3);
      if (e < 0) unterminated = true;
      const to = e < 0 ? n : e + 2;
      blank(i, to); i = to; continue;
    }
    if (c === "'") {
      let j = i + 1;
      let closed = false;
      for (;;) {
        const e = sql.indexOf("'", j);
        if (e < 0) { j = n; break; }
        if (sql[e + 1] === "'") { j = e + 2; continue; }
        j = e + 1; closed = true; break;
      }
      if (!closed) unterminated = true;
      blank(i, j); i = j; continue;
    }
    if (c === '"') { const e = sql.indexOf('"', i + 1); if (e < 0) unterminated = true; const to = e < 0 ? n : e + 1; blank(i, to); i = to; continue; }
    i++;
  }
  return { masked: out.join(""), unterminated };
}

/**
 * Oracle SQL에서 주석(--, /* *\/), 문자열('...', '' 이스케이프), q-인용(q'[...]' 등), 큰따옴표 식별자를
 * 같은 길이의 공백으로 바꾼다. 위치가 보존되므로 바인드 탐색과 가드가 같은 결과 위에서 돈다.
 * 닫히지 않은 주석·문자열은 끝까지 노이즈로 본다
 */
export function maskSqlNoise(sql: string): string {
  return scan(sql).masked;
}

/** 주석·문자열·q-인용·큰따옴표 식별자 중 하나라도 입력 끝까지 닫히지 않았으면 true (가드가 이를 거부한다) */
export function hasUnterminatedNoise(sql: string): boolean {
  return scan(sql).unterminated;
}
