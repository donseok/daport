import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ConnectionsManager } from "../ConnectionsManager";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  let list = [{ name: "mes", via: "direct", host: "db.local", port: 1521, service: "ORCL", user: "rpt", secretRef: "MES_DB", secretConfigured: true, usedBy: ["quality-cert"] }];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/connections") return new Response(JSON.stringify(list), { status: 200 });
    if (init?.method === "PUT") { const body = JSON.parse(String(init.body)); list = [...list.filter((c) => c.name !== body.name), { ...body, secretConfigured: false, usedBy: [] }]; return new Response(JSON.stringify(body), { status: 200 }); }
    if (url.endsWith("/test")) return new Response(JSON.stringify({ ok: true, elapsedMs: 12 }), { status: 200 });
    if (init?.method === "DELETE") return new Response(JSON.stringify({ error: "in use", code: "CONNECTION_IN_USE", reports: ["quality-cert"] }), { status: 409 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ConnectionsManager />);
  return fetchMock;
}

describe("ConnectionsManager", () => {
  it("lists connections with secret state and usage, tests one, and shows 409 on delete", async () => {
    setup();
    const row = await screen.findByTestId("conn-mes");
    expect(row.textContent).toContain("db.local:1521/ORCL"); expect(row.textContent).toContain("MES_DB"); expect(row.textContent).toContain("1");
    fireEvent.click(row.querySelector('button[name="test"]')!);
    await waitFor(() => expect(screen.getByTestId("test-mes").textContent).toMatch(/OK.*12/));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(row.querySelector('button[name="delete"]')!);
    await waitFor(() => expect(screen.getByTestId("conn-mes").textContent).toMatch(/quality-cert/));
  });
  it("saves a new agent connection via PUT and switches fields by via", async () => {
    const fetchMock = setup();
    await screen.findByTestId("conn-mes");
    fireEvent.change(screen.getByLabelText("방식"), { target: { value: "agent" } });
    expect(screen.queryByLabelText("호스트")).toBeNull();
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "factory" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://agent.local:8433" } });
    fireEvent.change(screen.getByLabelText("비밀값 이름"), { target: { value: "AGENT" } });
    fireEvent.click(screen.getByRole("button", { name: "연결 저장" }));
    await waitFor(() => expect(screen.getByTestId("conn-factory")).toBeTruthy());
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(put[0]).toBe("/api/connections/factory");
    expect(JSON.parse(String(put[1]?.body))).toEqual({ name: "factory", via: "agent", url: "https://agent.local:8433", secretRef: "AGENT" });
  });
});
