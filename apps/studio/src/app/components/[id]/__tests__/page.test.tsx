// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from "vitest";
import { parseComponentBody } from "@daport/core";

vi.mock("@/editor/Editor", () => ({ Editor: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const v1 = parseComponentBody({ name: "헤더", w: 100, h: 20, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 5, value: "A" }] });
const v2 = parseComponentBody({ ...v1, h: 30, props: [{ name: "title", type: "string", default: "기본" }, { name: "show", type: "boolean", default: false }] });

beforeAll(() => { delete process.env.DATABASE_URL; });

describe("component edit page", () => {
  it("opens the editor in component mode on the latest version with defaults as sample props", async () => {
    const { getComponentStore } = await import("@/lib/component-store");
    await getComponentStore().create("page-test-hdr", v1);
    await getComponentStore().save("page-test-hdr", v2);
    const { default: ComponentPage } = await import("../page");
    const { Editor } = await import("@/editor/Editor");
    const { componentToEditReport } = await import("@/lib/component-edit");
    const el = await ComponentPage({ params: Promise.resolve({ id: "page-test-hdr" }) });
    expect(el.type).toBe(Editor);
    expect(el.props.initial).toEqual(componentToEditReport("page-test-hdr", v2));
    expect(el.props.componentMode).toEqual({ componentId: "page-test-hdr", version: 2, props: v2.props, sampleProps: { title: "기본", show: false } });
  });

  it("calls notFound for an unknown component", async () => {
    const { default: ComponentPage } = await import("../page");
    await expect(ComponentPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
