/**
 * GitUsernameField — visa/dölj på tier + tomt → "härleds"-placeholder.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { render, screen, fireEvent } from "@testing-library/react";
import { GitUsernameField } from "@/components/settings/firma-settings-panel";

describe("GitUsernameField", () => {
  it("renderar INGET för tier=demo", () => {
    const { container } = render(
      <GitUsernameField tier="demo" value="" onChange={() => {}} authorEmail="" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renderar INGET för tier=github", () => {
    const { container } = render(
      <GitUsernameField tier="github" value="" onChange={() => {}} authorEmail="" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("visar input + placeholder för self-hosted med tom value", () => {
    render(
      <GitUsernameField tier="self-hosted" value="" onChange={() => {}} authorEmail="anna@firma.se" />,
    );
    const input = screen.getByPlaceholderText(/anna@firma\.se/);
    expect(input).toBeInTheDocument();
  });

  it("visar 'admin' som default-placeholder när email är tom", () => {
    render(
      <GitUsernameField tier="self-hosted" value="" onChange={() => {}} authorEmail="" />,
    );
    expect(screen.getByPlaceholderText(/"admin"/)).toBeInTheDocument();
  });

  it("anropar onChange vid input", () => {
    const onChange = vi.fn();
    render(
      <GitUsernameField tier="self-hosted" value="" onChange={onChange} authorEmail="" />,
    );
    fireEvent.change(screen.getByPlaceholderText(/"admin"/), { target: { value: "kalle" } });
    expect(onChange).toHaveBeenCalledWith("kalle");
  });

  it("visar inmatat värde", () => {
    render(
      <GitUsernameField tier="self-hosted" value="kalle" onChange={() => {}} authorEmail="" />,
    );
    expect((screen.getByDisplayValue("kalle") as HTMLInputElement).value).toBe("kalle");
  });
});
