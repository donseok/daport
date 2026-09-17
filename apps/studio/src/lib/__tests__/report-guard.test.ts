// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { parseReport, parseComponentBody } from "@daport/core";
import { checkReportComponents, WARNINGS_HEADER } from "../report-guard";
import { getComponentStore } from "../component-store";

// 라이브러리 v1 내용. 레포트에 품을 때도 같은 원본을 쓰므로 스키마 기본값이 같게 채워져 해시가 같다
const rawBody = { name: "헤더", w: 50, h: 10, props: [{ name: "title", type: "string", default: "T" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, value: "{{ props.title }}" }] };
// 크기는 같고 텍스트 한 글자만 다른 내용 (해시 불일치)
const changedBody = { ...rawBody, elements: [{ ...rawBody.elements[0], value: "{{ props.title }}!" }] };
const ref = (id: string, component: string, version: number) => ({ id, type: "ref", ref: component, version, x: 10, y: 10, w: 50, h: 10 });
const report = (components: Record<string, unknown>, elements: unknown[]) =>
  parseReport({ id: "g", version: 1, page: { width: 100, height: 100 }, components, elements });

beforeAll(async () => {
  delete process.env.DATABASE_URL;   // 메모리 컴포넌트 저장소
  await getComponentStore().create("guard-hdr", parseComponentBody(rawBody));   // guard-hdr@1만 라이브러리에 있다
});

describe("checkReportComponents", () => {
  it("exports the warnings header name", () => {
    expect(WARNINGS_HEADER).toBe("X-Daport-Warnings");
  });

  it("passes a report without components unchanged and with no warnings", async () => {
    const r = report({}, [{ id: "a", type: "rect", x: 0, y: 0, w: 5, h: 5 }]);
    const res = await checkReportComponents(r);
    expect(res).toEqual({ ok: true, report: r, warnings: [] });
  });

  it("accepts an embedded body whose hash matches the library version", async () => {
    const r = report({ "guard-hdr@1": rawBody }, [ref("h1", "guard-hdr", 1), ref("h2", "guard-hdr", 1)]);
    const res = await checkReportComponents(r);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warnings).toEqual([]);
      expect(Object.keys(res.report.components)).toEqual(["guard-hdr@1"]);
    }
  });

  it("rejects an embedded body that differs from the library version with 409 COMPONENT_MISMATCH", async () => {
    const r = report({ "guard-hdr@1": changedBody }, [ref("h1", "guard-hdr", 1)]);
    expect(await checkReportComponents(r)).toEqual({
      ok: false, status: 409, body: { error: "component guard-hdr@1 differs from the library", code: "COMPONENT_MISMATCH" },
    });
  });

  it("warns in ASCII for versions that are not in the library, including unknown component ids, sorted by key", async () => {
    const r = report({ "guard-none@1": rawBody, "guard-hdr@2": changedBody }, [ref("a", "guard-none", 1), ref("b", "guard-hdr", 2)]);
    const res = await checkReportComponents(r);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings).toEqual(["component guard-hdr@2 is not in the library", "component guard-none@1 is not in the library"]);
    for (const w of res.warnings) expect(w).toMatch(/^[\x20-\x7e]+$/);
    expect(Object.keys(res.report.components).sort()).toEqual(["guard-hdr@2", "guard-none@1"]);   // 경고만 하고 내용은 그대로 둔다
  });

  it("prunes unused entries before checking, so an unused mismatched or unknown entry neither blocks nor warns", async () => {
    const r = report({ "guard-hdr@1": changedBody, "guard-hdr@7": rawBody, "guard-none@3": rawBody }, [ref("h", "guard-hdr", 7)]);
    const res = await checkReportComponents(r);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.report.components)).toEqual(["guard-hdr@7"]);
    expect(res.warnings).toEqual(["component guard-hdr@7 is not in the library"]);
    expect(Object.keys(r.components).sort()).toEqual(["guard-hdr@1", "guard-hdr@7", "guard-none@3"]);   // 입력 객체는 바꾸지 않는다
  });
});
