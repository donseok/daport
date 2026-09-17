import jexl from "jexl";

type JexlInstance = typeof jexl;
type Ast = ReturnType<ReturnType<JexlInstance["compile"]>["_getAst"]>;
const JexlCtor = (jexl as unknown as { Jexl: new () => JexlInstance }).Jexl;

export class ExpressionError extends Error {
  constructor(public expression: string, cause: unknown) {
    super(`Expression error in "${expression}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ExpressionError";
  }
}

export type DataContext = Record<string, unknown>;

/** 프로토타입 키는 식별자로 쓰이면 빠르게 거부한다. 문자열 키(`a['constructor']`)는 guardAst가 평가 시점에 막는다 */
const FORBIDDEN_KEY_RE = /(^|[^\w$])(constructor|__proto__|prototype)(?![\w$])/;
/**
 * 전역 이름은 루트 식별자이고 컨텍스트에 그 이름의 데이터가 없을 때만 거부한다.
 * jexl은 루트 식별자를 컨텍스트에서만 읽으므로 `process`라는 데이터셋은 그대로 쓸 수 있고, `order.window` 같은 멤버 이름도 데이터에서 읽는다
 */
const FORBIDDEN_ROOT_RE = /(^|[^\w.$])(globalThis|window|process|require|eval|Function)(?![\w$])/g;
const STRING_LITERAL_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;
const FORBIDDEN_KEYS = new Set<PropertyKey>(["constructor", "__proto__", "prototype"]);

function toNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** 숫자로 볼 수 있는 값만 모은다. null·undefined·빈 문자열·불리언·NaN 문자열은 건너뛴다 (sum과 달리 0으로 세지 않는다) */
function numericValues(rows: unknown, field: string): number[] {
  if (!Array.isArray(rows)) return [];
  const key = checkKey(field) as string;
  const out: number[] = [];
  for (const r of rows) {
    const v = (r as Record<string, unknown> | null | undefined)?.[key];
    if (v === null || v === undefined || v === "" || typeof v === "boolean") continue;
    const n = Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

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

/** 계산된 멤버 키 검사 함수의 등록 이름. `#`은 jexl 식별자에 쓸 수 없어 표현식에서 직접 부를 수 없다 */
const KEY_GUARD = "#key";

/**
 * 멤버 키를 평가 시점에 검사한다. 불리언은 jexl에서 키가 아니라 필터(`a[true]`는 a 자체)라 그대로 둔다.
 * 그 밖의 값은 JS가 속성 키로 바꾸는 것과 같게 문자열로 바꿔 검사하고 그 문자열을 키로 쓴다
 * (`a[['constructor']]`처럼 배열이 키 문자열이 되는 경우도 막힌다).
 */
function checkKey(key: unknown): unknown {
  if (typeof key === "boolean") return key;
  const k = String(key);
  if (FORBIDDEN_KEYS.has(k)) throw new Error(`forbidden property: ${k}`);
  return k;
}

const MAX_PAD = 1000;

function createJexl(): JexlInstance {
  const j = new JexlCtor();
  j.addFunction(KEY_GUARD, checkKey);
  j.addFunction("sum", (rows: unknown, field: string) =>
    Array.isArray(rows) ? rows.reduce((a, r) => a + toNumber((r as Record<string, unknown>)?.[checkKey(field) as string]), 0) : 0);
  j.addFunction("count", (rows: unknown) => (Array.isArray(rows) ? rows.length : 0));
  j.addFunction("avg", (rows: unknown, field: string) => { const ns = numericValues(rows, field); return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null; });
  j.addFunction("min", (rows: unknown, field: string) => { const ns = numericValues(rows, field); return ns.length ? Math.min(...ns) : null; });
  j.addFunction("max", (rows: unknown, field: string) => { const ns = numericValues(rows, field); return ns.length ? Math.max(...ns) : null; });
  j.addFunction("formatNumber", formatNumber);
  j.addFunction("formatDate", formatDate);
  j.addFunction("pad", (v: unknown, len: number, ch = " ") => {
    if (Number(len) > MAX_PAD) throw new Error(`pad length must be at most ${MAX_PAD}`);   // 서버 렌더 메모리 보호
    return String(v ?? "").padStart(len, ch);
  });
  j.addFunction("upper", (v: unknown) => String(v ?? "").toUpperCase());
  j.addFunction("lower", (v: unknown) => String(v ?? "").toLowerCase());
  j.addFunction("default", (v: unknown, fb: unknown) => (v === null || v === undefined || v === "" ? fb : v));
  return j;
}

const engine = createJexl();

type Compiled = ReturnType<JexlInstance["compile"]>;
const MAX_CACHE = 2000;
/** 표현식 문자열 → guardAst를 거친 컴파일 결과. jexl Expression은 AST를 한 번만 만들고 재사용하므로 행 1만 건도 파싱은 한 번이다 */
const compiled = new Map<string, Compiled>();

function compileCached(expression: string): Compiled {
  let c = compiled.get(expression);
  if (!c) {
    c = engine.compile(expression);   // 구문 오류를 확실히 던지게 한다
    guardAst(c._getAst());            // 금지 노드는 여기서 던지고, 필터 키 검사는 AST에 남는다
    if (compiled.size >= MAX_CACHE) compiled.clear();
    compiled.set(expression, c);
  }
  return c;
}

/**
 * 컴파일된 AST를 검사하고 고친다. jexl이 속성을 읽는 경로는 두 가지뿐이다.
 * - 식별자(`a.b`, `.b`, 루트 `b`): 이름이 소스에 그대로 있으므로 여기서 바로 거부한다.
 * - 계산된 멤버(`a[expr]`, relative가 아닌 FilterExpression): 키가 평가 중에 정해지므로
 *   expr을 KEY_GUARD 호출로 감싸 읽기 직전에 검사한다.
 * 주체가 데이터 객체든 원시값·리터럴·필터 결과 배열이든 같은 경로를 지나므로,
 * 중간 단계에서도 constructor·__proto__·prototype에 닿지 못한다.
 */
function guardAst(node: Ast): void {
  switch (node.type) {
    case "Literal":
      return;
    case "Identifier":
      checkKey(node.value);
      if (node.from) guardAst(node.from);
      return;
    case "FilterExpression":
      guardAst(node.subject);
      guardAst(node.expr);
      if (!node.relative) node.expr = { type: "FunctionCall", name: KEY_GUARD, pool: "functions", args: [node.expr] };
      return;
    case "UnaryExpression":
      guardAst(node.right);
      return;
    case "BinaryExpression":
      guardAst(node.left);
      guardAst(node.right);
      return;
    case "ConditionalExpression":
      guardAst(node.test);
      if (node.consequent) guardAst(node.consequent);
      guardAst(node.alternate);
      return;
    case "ArrayLiteral":
      node.value.forEach(guardAst);
      return;
    case "ObjectLiteral":
      for (const [key, value] of Object.entries(node.value)) {
        checkKey(key);
        guardAst(value);
      }
      return;
    case "FunctionCall":
      node.args.forEach(guardAst);
      return;
    default:
      throw new Error(`unsupported expression node: ${(node as { type?: unknown }).type}`);
  }
}

/** 멤버 함수 값(`order.toString`)처럼 키 검사로 걸러지지 않는 함수·프로토타입 결과를 마지막으로 막는다 */
function isForbiddenResult(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object") return false;
  const ctor = Object.hasOwn(value, "constructor") ? (value as { constructor: unknown }).constructor : undefined;
  return typeof ctor === "function" && ctor.prototype === value;
}

export function evaluate(expression: string, context: DataContext): unknown {
  const code = expression.replace(STRING_LITERAL_RE, "''");   // 문자열 리터럴 안의 단어는 식별자가 아니다
  const unboundGlobal = [...code.matchAll(FORBIDDEN_ROOT_RE)].some((m) => !Object.hasOwn(context, m[2]));
  if (FORBIDDEN_KEY_RE.test(code) || unboundGlobal) {
    throw new ExpressionError(expression, "forbidden identifier");
  }
  let result: unknown;
  try {
    result = compileCached(expression).evalSync(context);
  } catch (e) {
    throw new ExpressionError(expression, e);
  }
  if (isForbiddenResult(result)) throw new ExpressionError(expression, "forbidden value");
  return result;
}
