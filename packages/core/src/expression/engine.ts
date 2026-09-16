import jexl from "jexl";

type JexlInstance = typeof jexl;
const JexlCtor = (jexl as unknown as { Jexl: new () => JexlInstance }).Jexl;

export class ExpressionError extends Error {
  constructor(public expression: string, cause: unknown) {
    super(`Expression error in "${expression}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ExpressionError";
  }
}

export type DataContext = Record<string, unknown>;

const FORBIDDEN = /(^|[^\w])(constructor|__proto__|prototype|globalThis|window|process|require|eval|Function)([^\w]|$)/;

function toNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function formatNumber(value: unknown, pattern = "#,##0"): string {
  const n = toNumber(value);
  const dec = pattern.includes(".") ? pattern.split(".")[1].length : 0;
  const grouped = pattern.includes(",");
  const fixed = n.toFixed(dec);
  if (!grouped) return fixed;
  const [int, frac] = fixed.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + withCommas + (frac !== undefined ? "." + frac : "");
}

export function formatDate(value: unknown, pattern = "yyyy-MM-dd"): string {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return pattern
    .replace(/yyyy/g, String(d.getUTCFullYear()))
    .replace(/MM/g, p(d.getUTCMonth() + 1))
    .replace(/dd/g, p(d.getUTCDate()))
    .replace(/HH/g, p(d.getUTCHours()))
    .replace(/mm/g, p(d.getUTCMinutes()))
    .replace(/ss/g, p(d.getUTCSeconds()));
}

function createJexl(): JexlInstance {
  const j = new JexlCtor();
  j.addFunction("sum", (rows: unknown, field: string) =>
    Array.isArray(rows) ? rows.reduce((a, r) => a + toNumber((r as Record<string, unknown>)?.[field]), 0) : 0);
  j.addFunction("count", (rows: unknown) => (Array.isArray(rows) ? rows.length : 0));
  j.addFunction("formatNumber", formatNumber);
  j.addFunction("formatDate", formatDate);
  j.addFunction("pad", (v: unknown, len: number, ch = " ") => String(v ?? "").padStart(len, ch));
  j.addFunction("upper", (v: unknown) => String(v ?? "").toUpperCase());
  j.addFunction("lower", (v: unknown) => String(v ?? "").toLowerCase());
  j.addFunction("default", (v: unknown, fb: unknown) => (v === null || v === undefined || v === "" ? fb : v));
  return j;
}

const engine = createJexl();

export function evaluate(expression: string, context: DataContext): unknown {
  if (FORBIDDEN.test(expression)) throw new ExpressionError(expression, "forbidden identifier");
  try {
    engine.compile(expression);               // 구문 오류를 확실히 던지게 한다
    return engine.evalSync(expression, context);
  } catch (e) {
    throw new ExpressionError(expression, e);
  }
}
