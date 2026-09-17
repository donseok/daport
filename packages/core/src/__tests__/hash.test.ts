import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256Hex, componentHash, reportHash } from "../schema/hash";
import { parseComponentBody, type ComponentBody } from "../schema/component";
import { parseReport } from "../schema/report";
import * as core from "../index";

const nodeSha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: "x" } })).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}');
    expect(canonicalJson([{ z: 1, y: 2 }, { x: 3 }])).toBe('[{"y":2,"z":1},{"x":3}]');
  });
  it("gives the same string regardless of key insertion order", () => {
    expect(canonicalJson({ name: "h", w: 1, props: [], elements: [] })).toBe(canonicalJson({ elements: [], props: [], w: 1, name: "h" }));
  });
  it("removes undefined properties but keeps null, false, 0 and empty string", () => {
    expect(canonicalJson({ a: undefined, b: null, c: false, d: 0, e: "" })).toBe('{"b":null,"c":false,"d":0,"e":""}');
    expect(canonicalJson({ a: { label: undefined } })).toBe('{"a":{}}');
  });
  it("writes scalars and escapes strings like JSON.stringify, without whitespace", () => {
    expect(canonicalJson("따옴표\"와\n줄바꿈")).toBe(JSON.stringify("따옴표\"와\n줄바꿈"));
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
    expect(canonicalJson({ "키 b": 1, "키 a": 2 })).toBe('{"키 a":2,"키 b":1}');
  });
});

describe("sha256Hex", () => {
  it("matches the published SHA-256 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))
      .toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
  it("hashes the UTF-8 bytes of Korean text like node:crypto", () => {
    for (const s of ["품질보증서", "회사 헤더 {{ props.title }}", "가".repeat(1000)]) expect(sha256Hex(s)).toBe(nodeSha(s));
  });
  it("agrees with node:crypto across padding boundaries (55, 56, 63, 64, 65 bytes and multi-block)", () => {
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const s = "a".repeat(n);
      expect(sha256Hex(s)).toBe(nodeSha(s));
    }
  });
  it("does not import node or web crypto so it runs the same in the browser", () => {
    const src = readFileSync(new URL("../schema/hash.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'](node:)?crypto["']/);
    expect(src).not.toMatch(/crypto\.subtle|require\(/);
  });
  it("returns 64 lowercase hex characters", () => {
    expect(sha256Hex("daport")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("componentHash", () => {
  const body: ComponentBody = parseComponentBody({
    name: "회사 헤더", w: 180, h: 24,
    props: [{ name: "title", type: "string", default: "품질보증서", label: "제목" }],
    elements: [{ id: "title", type: "text", x: 0, y: 0, w: 180, h: 10, value: "{{ props.title }}" }],
  });
  it("equals sha256Hex of the canonical JSON", () => {
    expect(componentHash(body)).toBe(sha256Hex(canonicalJson(body)));
    expect(componentHash(body)).toBe(nodeSha(canonicalJson(body)));
  });
  it("does not depend on key order or undefined properties", () => {
    const reordered = JSON.parse(canonicalJson(body)) as Record<string, unknown>;
    const shuffled = { elements: reordered.elements, props: reordered.props, h: reordered.h, w: reordered.w, name: reordered.name, extra: undefined };
    expect(componentHash(shuffled as unknown as ComponentBody)).toBe(componentHash(body));
    const clone = structuredClone(body);
    expect(componentHash(clone)).toBe(componentHash(body));
  });
  it("changes when one character of the content changes", () => {
    const changed = structuredClone(body);
    const t = changed.elements[0];
    if (t.type === "text") t.value = "{{ props.titlE }}";
    expect(componentHash(changed)).not.toBe(componentHash(body));
    expect(componentHash({ ...body, name: "회사 헤더2" })).not.toBe(componentHash(body));
  });
  it("changes when array order changes", () => {
    const two = { ...body, props: [...body.props, { name: "no", type: "number" as const, default: 1 }] };
    const swapped = { ...two, props: [two.props[1], two.props[0]] };
    expect(componentHash(swapped)).not.toBe(componentHash(two));
  });
  it("is exported from the package index", () => {
    expect(core.componentHash).toBe(componentHash);
    expect(core.sha256Hex).toBe(sha256Hex);
    expect(core.canonicalJson).toBe(canonicalJson);
  });
});

describe("reportHash", () => {
  const base = { id: "r", name: "R", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 10, h: 5, text: "a" }] };
  it("is stable across key order and whitespace", () => {
    const a = parseReport(base);
    const b = parseReport(JSON.parse(JSON.stringify({ elements: base.elements, page: { height: 100, width: 100 }, version: 1, name: "R", id: "r" })));
    expect(reportHash(a)).toBe(reportHash(b));
    expect(reportHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when the model changes", () => {
    const a = parseReport(base);
    const b = parseReport({ ...base, name: "S" });
    expect(reportHash(a)).not.toBe(reportHash(b));
  });
});
