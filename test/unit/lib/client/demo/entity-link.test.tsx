/**
 * Tester för `<EntityLink>` — den kanoniska, demo-säkra detalj-länken. Den ska
 * rendera en VANLIG `<a href>` (hård navigering, inte Next-`<Link>`) med rätt
 * entityHref, och vidarebefordra alla extra props (className m.m.). Hård-nav är
 * det som gör att 404/nginx-shimmen kan lösa runtime-skapade id:n (annars #418).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntityLink } from "@/lib/client/demo/entity-link";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("EntityLink", () => {
  it("renderar ett <a>-element (inte en SPA-Link) med entityHref + base-path", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "/ava");
    render(<EntityLink route="invoices" id="inv-1">Öppna</EntityLink>);
    const link = screen.getByRole("link", { name: "Öppna" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/ava/invoices/inv-1/");
  });

  it("bygger nästlad href via sub (templates/<id>/edit)", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "/ava");
    render(<EntityLink route="templates" id="t-1" sub="edit">Redigera</EntityLink>);
    expect(screen.getByRole("link", { name: "Redigera" }).getAttribute("href"))
      .toBe("/ava/templates/t-1/edit/");
  });

  it("vidarebefordrar extra props (className, title) till <a>", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "");
    render(<EntityLink route="matters" id="m-1" className="x-cls" title="t">M1</EntityLink>);
    const link = screen.getByRole("link", { name: "M1" });
    expect(link).toHaveClass("x-cls");
    expect(link.getAttribute("title")).toBe("t");
    expect(link.getAttribute("href")).toBe("/matters/m-1/");
  });

  it("tomt/saknat id → ingen länk (span), undviker /route//-bounce till dashboard", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "/ava");
    const { rerender } = render(<EntityLink route="matters" id="" className="c">—</EntityLink>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("—").tagName).toBe("SPAN");
    rerender(<EntityLink route="matters" id={null}>X</EntityLink>);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<EntityLink route="matters" id={undefined}>Y</EntityLink>);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
