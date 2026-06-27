/**
 * RattsskyddNekadBanner (#811) — visas bara när rättsskydd nekats; "Byt till
 * rättshjälp"-knappen byter ärendets betalningssätt.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { RattsskyddNekadBanner } from "@/components/matter/rattsskydd-nekad-banner";
import { asId } from "@/lib/shared/schemas/ids";

const mutate = vi.fn();
const invalidate = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ matter: { getById: { invalidate } } }),
    matter: { update: { useMutation: () => ({ mutate, isPending: false }) } },
  },
}));

const matterId = asId<"MatterId">("m1");

beforeEach(() => { vi.clearAllMocks(); });

describe("RattsskyddNekadBanner", () => {
  it("visas inte för rättsskydd utan avslagsdatum", () => {
    const { container } = render(<RattsskyddNekadBanner matterId={matterId} paymentMethod="RATTSSKYDD" rattsskyddNekadAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("visas inte för annat betalningssätt även med datum", () => {
    const { container } = render(<RattsskyddNekadBanner matterId={matterId} paymentMethod="RATTSHJALP" rattsskyddNekadAt="2026-05-01" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("visar avslaget + 6 §-påminnelsen och byter till rättshjälp vid klick", () => {
    render(<RattsskyddNekadBanner matterId={matterId} paymentMethod="RATTSSKYDD" rattsskyddNekadAt="2026-05-01" />);
    expect(screen.getByText(/Rättsskydd nekades 2026-05-01/)).toBeInTheDocument();
    expect(screen.getByText(/6 § rättshjälpslagen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Byt till rättshjälp" }));
    expect(mutate).toHaveBeenCalledWith({ id: matterId, paymentMethod: "RATTSHJALP" });
  });
});
