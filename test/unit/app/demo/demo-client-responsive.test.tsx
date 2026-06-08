/**
 * UI-tester för responsiv-poliering av DemoClient.
 *
 * Verifierar:
 *   - Touch-target storlek: input + knapp har min-h-12 (48 px) som
 *     uppfyller iOS HIG (44 px) och Material (48 dp).
 *   - Input har inputMode="url" och autoCapitalize="off" så mobil-tangentbord
 *     visar rätt layout och inte stor-bokstavar.
 *   - Container har responsiv padding (p-4 sm:p-6 md:p-8).
 *   - Form-rad stackar på mobil (flex-col), row på tablet+ (sm:flex-row).
 */

import { describe, it, expect, vi } from "vitest-compat";
import { render, screen } from "@testing-library/react";
import { DemoClient } from "@/app/demo/_demo-client";
import { DemoRuntime } from "@/lib/server/local-first/demo-runtime";

function factory() { return DemoRuntime.create({ cloneFn: vi.fn() }); }

describe("DemoClient — responsiv UI", () => {
  it("input har URL-tangentbord + ingen auto-cap", () => {
    render(<DemoClient runtimeFactory={factory} />);
    const input = screen.getByRole("textbox", { name: /GitHub-url/i });
    expect(input).toHaveAttribute("inputMode", "url");
    expect(input).toHaveAttribute("autoCapitalize", "off");
  });

  it("input + knapp har min-h-12 (48 px touch-target)", () => {
    render(<DemoClient runtimeFactory={factory} />);
    const input = screen.getByRole("textbox", { name: /GitHub-url/i });
    const button = screen.getByRole("button", { name: /Ladda demo/i });
    expect(input.className).toMatch(/min-h-12/);
    expect(button.className).toMatch(/min-h-12/);
  });

  it("input/knapp-rad har flex-col som default + sm:flex-row för bredare", () => {
    const { container } = render(<DemoClient runtimeFactory={factory} />);
    const row = container.querySelector("div.flex.flex-col.sm\\:flex-row");
    expect(row).not.toBeNull();
  });

  it("container har skalande padding", () => {
    const { container } = render(<DemoClient runtimeFactory={factory} />);
    const outer = container.querySelector("div");
    expect(outer?.className).toMatch(/p-4/);
    expect(outer?.className).toMatch(/sm:p-6/);
    expect(outer?.className).toMatch(/md:p-8/);
  });

  it("rubriken är mindre på mobil (text-2xl) och större på sm+ (text-3xl)", () => {
    render(<DemoClient runtimeFactory={factory} />);
    const heading = screen.getByRole("heading", { name: /AVA Demo/i });
    expect(heading.className).toMatch(/text-2xl/);
    expect(heading.className).toMatch(/sm:text-3xl/);
  });
});
