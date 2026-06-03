/**
 * Tester för `<EntityLink>` — den kanoniska, demo-säkra detalj-länken. Den
 * SOFT-navigerar (Next-`<Link>`) till den pre-renderade `__shell__`-routen med
 * id:t som query-param (`?id=`) → ingen sidomladdning, inget blink, ingen #418.
 * Tomt/saknat id renderar en `<span>` (aldrig en trasig URL).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntityLink } from "@/lib/client/demo/entity-link";

describe("EntityLink", () => {
  it("soft-navigerar till __shell__-routen med ?id (inte en /<route>/<id>-URL)", () => {
    render(<EntityLink route="invoices" id="inv-1">Öppna</EntityLink>);
    const link = screen.getByRole("link", { name: "Öppna" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/invoices/__shell__");
    expect(href).toContain("id=inv-1");
    // Får ALDRIG vara en direkt /invoices/<id>-länk (soft-nav dit → React #418).
    expect(href).not.toMatch(/\/invoices\/inv-1(\/|$)/);
  });

  it("bygger nästlad href via sub (templates/<id>/edit)", () => {
    const href = (() => {
      render(<EntityLink route="templates" id="t-1" sub="edit">Redigera</EntityLink>);
      return screen.getByRole("link", { name: "Redigera" }).getAttribute("href") ?? "";
    })();
    expect(href).toContain("/templates/__shell__/edit");
    expect(href).toContain("id=t-1");
  });

  it("vidarebefordrar extra props (className, title)", () => {
    render(<EntityLink route="matters" id="m-1" className="x-cls" title="t">M1</EntityLink>);
    const link = screen.getByRole("link", { name: "M1" });
    expect(link).toHaveClass("x-cls");
    expect(link.getAttribute("title")).toBe("t");
  });

  it("tomt/saknat id → ingen länk (span), aldrig en trasig URL", () => {
    const { rerender } = render(<EntityLink route="matters" id="" className="c">—</EntityLink>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("—").tagName).toBe("SPAN");
    rerender(<EntityLink route="matters" id={null}>X</EntityLink>);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<EntityLink route="matters" id={undefined}>Y</EntityLink>);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
