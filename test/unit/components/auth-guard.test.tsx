/**
 * Test för AuthGuard — laddar/inloggad/ej-inloggad/login-page-bypass.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthGuard } from "@/components/auth-guard";

const sessionMock = vi.fn<
  () => {
    data: null | { user?: { name?: string | null } };
    status: "authenticated" | "loading" | "unauthenticated";
  }
>(() => ({ data: null, status: "authenticated" }));
const pathnameMock = vi.fn(() => "/");
const pushMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => sessionMock(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ push: pushMock }),
}));

// Sidebar är tung att rendera (signOut + Link); mocka som platshållare
vi.mock("@/components/sidebar", () => ({
  Sidebar: ({ userName }: { userName?: string | null }) => (
    <aside data-testid="sidebar">{userName ?? "anonym"}</aside>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  pathnameMock.mockReturnValue("/");
});

describe("AuthGuard", () => {
  it("renderar children utan sidebar på /login", () => {
    pathnameMock.mockReturnValue("/login");
    render(
      <AuthGuard>
        <div>Login UI</div>
      </AuthGuard>,
    );
    expect(screen.getByText("Login UI")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
  });

  it("visar laddartext vid status=loading i prod", () => {
    sessionMock.mockReturnValue({ data: null, status: "loading" });
    // I dev hoppar vi över loadingen — sätt nodeenv via vi.stubEnv
    vi.stubEnv("NODE_ENV", "production");
    render(<AuthGuard><div>Inner</div></AuthGuard>);
    expect(screen.getByText("Laddar...")).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("renderar sidebar + content när authenticated", () => {
    sessionMock.mockReturnValue({
      data: { user: { name: "Anna" } },
      status: "authenticated",
    });
    render(<AuthGuard><div>Page</div></AuthGuard>);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByText("Page")).toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
  });

  it("renderar sidebar utan namn när session saknar user", () => {
    sessionMock.mockReturnValue({ data: null, status: "authenticated" });
    render(<AuthGuard><div>Page</div></AuthGuard>);
    expect(screen.getByText("anonym")).toBeInTheDocument();
  });
});
