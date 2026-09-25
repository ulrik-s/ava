/**
 * /todo finns kvar för gamla bokmärken och skickar till Att bevaka (#1167).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import TodoRedirect from "@/app/todo/page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("/todo", () => {
  it("skickar vidare till /watchlist", () => {
    render(<TodoRedirect />);
    expect(replace).toHaveBeenCalledWith("/watchlist");
    expect(screen.getByText(/heter nu Att bevaka/)).toBeInTheDocument();
  });
});
