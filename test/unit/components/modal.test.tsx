/**
 * Test för Modal-komponenten — open/close, ESC, backdrop-klick.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "@/components/ui/modal";

describe("Modal", () => {
  it("renderar inget när open=false", () => {
    const { container } = render(<Modal open={false} title="Titel" onClose={() => {}}><p>Body</p></Modal>);
    expect(container.firstChild).toBeNull();
  });

  it("renderar title och children när open=true", () => {
    render(<Modal open={true} title="Min titel" onClose={() => {}}><p>Innehåll</p></Modal>);
    expect(screen.getByText("Min titel")).toBeInTheDocument();
    expect(screen.getByText("Innehåll")).toBeInTheDocument();
  });

  it("klick på Stäng-knappen anropar onClose", () => {
    const onClose = vi.fn();
    render(<Modal open={true} title="T" onClose={onClose}><p>x</p></Modal>);
    fireEvent.click(screen.getByLabelText("Stäng"));
    expect(onClose).toHaveBeenCalled();
  });

  it("klick på backdrop anropar onClose", () => {
    const onClose = vi.fn();
    render(<Modal open={true} title="T" onClose={onClose}><p>x</p></Modal>);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("klick på inner-container stänger INTE", () => {
    const onClose = vi.fn();
    render(<Modal open={true} title="T" onClose={onClose}><p>inner</p></Modal>);
    fireEvent.click(screen.getByText("inner"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ESC stänger modalen", () => {
    const onClose = vi.fn();
    render(<Modal open={true} title="T" onClose={onClose}><p>x</p></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ESC stänger INTE när open=false", () => {
    const onClose = vi.fn();
    render(<Modal open={false} title="T" onClose={onClose}><p>x</p></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
