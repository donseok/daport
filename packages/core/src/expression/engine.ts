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

/** 프로토타입 키는 어디에 쓰여도(멤버, 문자열 키) 빠르게 거부한다 */
const FORBIDDEN_KEY_RE = /(^|[^\w$])(constructor|__proto__|prototype)(?![\w$])/;
/** 전역 이름은 루트 식별자일 때만 거부한다. `order.window` 같은 멤버 이름은 데이터에서 읽는다 */
const FORBIDDEN_ROOT_RE = /(^|[^\w.$])(globalThis|window|process|require|eval|Function)(?![\w$])/;
const STRING_LITERAL_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;
const FORBIDDEN_KEYS = new Set<PropertyKey>(["constructor", "__proto__", "prototype"]);

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

const proxies = new WeakMap<object, object>();
const targets = new WeakMap<object, object>();

/**
 * 컨텍스트를 읽기 전용 Proxy로 감싼다. 계산된 키(`a['con' + 'structor']`)로도 프로토타입 키를
 * 읽지 못하게 모든 깊이에서 undefined를 돌려준다. 함수 값은 원본에 bind해 Date·Array 메서드가 동작하고,
 * getPrototypeOf는 기본 동작(원본 프로토타입)이라 instanceof Date·Array.isArray가 유지된다.
 */
function guard<T>(value: T): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const target = value as unknown as object;
  const cached = proxies.get(target);
  if (cached) return cached as T;
  const proxy = new Proxy(target, {
    get(t, key) {
      const desc = Reflect.getOwnPropertyDescriptor(t, key);
      // Proxy 불변식: 설정 불가·쓰기 불가 데이터 속성은 원래 값을 그대로 돌려줘야 한다
      const frozen = desc !== undefined && "value" in desc && !desc.configurable && !desc.writable;
      if (FORBIDDEN_KEYS.has(key)) {
        if (frozen) throw new Error(`forbidden property: ${String(key)}`);
        return undefined;
      }
      if (frozen) return desc.value;
      const v = Reflect.get(t, key, t);
      return guard(typeof v === "function" ? v.bind(t) : v);
    },
    set() { return false; },
    defineProperty() { return false; },
    deleteProperty() { return false; },
    setPrototypeOf() { return false; },
  });
  proxies.set(target, proxy);
  targets.set(proxy, target);
  return proxy as T;
}

function unguard(value: unknown): unknown {
  return value !== null && (typeof value === "object" || typeof value === "function")
    ? (targets.get(value) ?? value) : value;
}

/** 리터럴에서 출발한 값(`''['con' + 'structor']`)은 Proxy를 거치지 않으므로 결과를 한 번 더 검사한다 */
function isForbiddenResult(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object") return false;
  const ctor = Object.hasOwn(value, "constructor") ? (value as { constructor: unknown }).constructor : undefined;
  return typeof ctor === "function" && ctor.prototype === value;
}

export function evaluate(expression: string, context: DataContext): unknown {
  if (FORBIDDEN_KEY_RE.test(expression) || FORBIDDEN_ROOT_RE.test(expression.replace(STRING_LITERAL_RE, "''"))) {
    throw new ExpressionError(expression, "forbidden identifier");
  }
  let result: unknown;
  try {
    engine.compile(expression);               // 구문 오류를 확실히 던지게 한다
    result = unguard(engine.evalSync(expression, guard(context)));
  } catch (e) {
    throw new ExpressionError(expression, e);
  }
  if (isForbiddenResult(result)) throw new ExpressionError(expression, "forbidden value");
  return result;
}
