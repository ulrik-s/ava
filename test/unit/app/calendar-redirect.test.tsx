/**
 * /calendar finns kvar för gamla bokmärken och skickar till Startsidan —
 * kalendern är borttagen ur AVA (#1623).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest-compat";
import CalendarRedirect from "@/app/calendar/page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("/calendar", () => {
  it("skickar vidare till Startsidan", () => {
    render(<CalendarRedirect />);
    expect(replace).toHaveBeenCalledWith("/");
    expect(screen.getByText(/Kalendern finns inte längre/)).toBeInTheDocument();
  });
});
