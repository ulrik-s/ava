/**
 * LeaseModal (ADR 0033 §2) — "X redigerar" + Ta över / Öppna ändå / Behåll
 * skrivskyddat. Dum komponent; verifierar text + att knapparna anropar rätt
 * callback och att `busy` låser dem.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { LeaseModal } from "@/components/documents/lease-modal";

const noop = () => { /* */ };

describe("LeaseModal", () => {
  it("visar hållarens namn och filnamnet", () => {
    render(<LeaseModal fileName="avtal.docx" leaseHolder="Anna" onTakeover={noop} onForceEdit={noop} onClose={noop} />);
    expect(screen.getByText(/Anna redigerar det här dokumentet/)).toBeTruthy();
    expect(screen.getByText("avtal.docx")).toBeTruthy();
  });

  it("faller tillbaka på 'Någon annan' utan namn", () => {
    render(<LeaseModal fileName="a.docx" onTakeover={noop} onForceEdit={noop} onClose={noop} />);
    expect(screen.getByText(/Någon annan redigerar/)).toBeTruthy();
  });

  it("knapparna anropar rätt callback", () => {
    const onTakeover = vi.fn();
    const onForceEdit = vi.fn();
    const onClose = vi.fn();
    render(<LeaseModal fileName="a.docx" leaseHolder="Bo" onTakeover={onTakeover} onForceEdit={onForceEdit} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Ta över redigeringen" }));
    fireEvent.click(screen.getByRole("button", { name: "Öppna ändå för redigering" }));
    fireEvent.click(screen.getByRole("button", { name: "Behåll skrivskyddat" }));
    expect(onTakeover).toHaveBeenCalledTimes(1);
    expect(onForceEdit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("busy låser knapparna och visar 'Tar över…'", () => {
    render(<LeaseModal fileName="a.docx" leaseHolder="Bo" busy onTakeover={noop} onForceEdit={noop} onClose={noop} />);
    expect((screen.getByRole("button", { name: "Tar över…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Behåll skrivskyddat" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
