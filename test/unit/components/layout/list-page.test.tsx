import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import { ListPage } from "@/components/layout/list-page";

describe("ListPage", () => {
  it("huvud och sidfot står still, listan scrollar mellan dem", () => {
    render(<ListPage header={<h1>Rubrik</h1>} footer={<p>Sida 1</p>}><p>rad</p></ListPage>);
    const body = screen.getByText("rad").parentElement;
    expect(body?.className).toContain("overflow-y-auto");
    expect(body?.className).toContain("relative");
    expect(screen.getByRole("heading", { name: "Rubrik" }).parentElement?.className).toContain("shrink-0");
    expect(screen.getByText("Sida 1")).toBeInTheDocument();
  });

  it("utan sidfot renderas ingen sidfot", () => {
    const { container } = render(<ListPage header={<h1>R</h1>}><p>rad</p></ListPage>);
    expect(container.firstElementChild?.children).toHaveLength(2);
  });
});
