import { describe, it, expect, afterEach, vi } from "vitest";
import { StrictMode } from "react";
import { render, cleanup } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); refresh.mockClear(); vi.resetModules(); });

describe("RefreshOnReturn", () => {
  it("does not refresh on the first mount after a page load, even under StrictMode's double effects", async () => {
    const { RefreshOnReturn } = await import("../RefreshOnReturn");
    render(<StrictMode><RefreshOnReturn /></StrictMode>);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the server list when the home page mounts again after a client-side navigation (e.g. browser Back)", async () => {
    const { RefreshOnReturn } = await import("../RefreshOnReturn");
    render(<RefreshOnReturn />);
    cleanup();                                   // 에디터로 이동하면 홈 페이지가 언마운트된다
    render(<StrictMode><RefreshOnReturn /></StrictMode>);   // 뒤로가기로 라우터 캐시의 홈이 다시 마운트된다
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
