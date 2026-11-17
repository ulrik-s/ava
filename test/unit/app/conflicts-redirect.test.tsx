/**
 * /conflicts finns kvar för gamla bokmärken och skickar till ärendelistan (#1643).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import ConflictsRedirect from "@/app/conflicts/page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("/conflicts", () => {
  it("skickar vidare till /matters", () => {
    render(<ConflictsRedirect />);
    expect(replace).toHaveBeenCalledWith("/matters");
    expect(screen.getByText(/finns nu i Ärenden \/ jävskontroll/)).toBeInTheDocument();
  });
});
