import { reportJsonSchema } from "@daport/core";

// Base(공통) 필드. 요소 타입 요약에서는 생략하고 타입 고유 필드만 보여준다
const BASE_KEYS = new Set(["id", "x", "y", "w", "h", "visible", "flow", "style", "type"]);

type JsonSchemaObject = Record<string, unknown>;
type Variant = { properties?: Record<string, JsonSchemaObject>; required?: string[] };

/** reportJsonSchema()의 definitions에서 discriminated union(요소 타입별 type: const)인 항목을 찾는다 */
function findElementVariants(schema: JsonSchemaObject): Variant[] {
  const defs = (schema.definitions ?? {}) as Record<string, JsonSchemaObject>;
  for (const def of Object.values(defs)) {
    const variants = (def.oneOf ?? def.anyOf) as Variant[] | undefined;
    if (variants && variants.length > 0 && variants.every((v) => typeof v.properties?.type?.["const"] === "string")) {
      return variants;
    }
  }
  return [];
}

/** 한 요소 타입을 `type: 필드(a, b*, ...) 열거(k: v1|v2|...)` 한 줄로 요약한다. *는 필수 필드 */
function summarizeVariant(v: Variant, enumLimit: number): string {
  const type = v.properties?.type?.["const"] as string;
  const required = new Set(v.required ?? []);
  const fields: string[] = [];
  const enumParts: string[] = [];
  for (const [key, prop] of Object.entries(v.properties ?? {})) {
    if (BASE_KEYS.has(key)) continue;
    fields.push(required.has(key) ? `${key}*` : key);
    const enumValues = prop["enum"] as unknown[] | undefined;
    if (enumValues) enumParts.push(`${key}: ${enumValues.slice(0, enumLimit).join("|")}`);
  }
  const fieldPart = `필드(${fields.join(", ")})`;
  const enumPart = enumParts.length > 0 ? ` 열거(${enumParts.join(", ")})` : "";
  return `${type}: ${fieldPart}${enumPart}`;
}

/**
 * reportJsonSchema()에서 요소 타입별 필드(필수는 *)·열거값을 뽑아 프롬프트에 넣을 짧은 요약을 만든다.
 * 결과가 6,000자를 넘으면 열거값을 앞 8개까지만 남긴다
 */
export function summarizeSchema(): string {
  const schema = reportJsonSchema();
  const variants = findElementVariants(schema);
  const build = (enumLimit: number) => variants.map((v) => summarizeVariant(v, enumLimit)).join("\n");
  const full = build(Number.POSITIVE_INFINITY);
  return full.length > 6_000 ? build(8) : full;
}
