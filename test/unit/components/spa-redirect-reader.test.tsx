/**
 * Tester för SpaRedirectReader: läser sessionStorage._spa_redirect och
 * kör router.replace om det finns ett target.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
}));

import { SpaRedirectReader } from "@/client/components/spa-redirect-reader";

beforeEach(() => {
  replaceMock.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("SpaRedirectReader", () => {
  it("router.replace:ar till saved path och rensar sessionStorage", () => {
    sessionStorage.setItem("_spa_redirect", "/matters/m-new");
    render(<SpaRedirectReader />);
    expect(replaceMock).toHaveBeenCalledWith("/matters/m-new");
    expect(sessionStorage.getItem("_spa_redirect")).toBeNull();
  });

  it("skippar replace om sessionStorage tom", () => {
    render(<SpaRedirectReader />);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("skippar replace om target är '/' (annars loop)", () => {
    sessionStorage.setItem("_spa_redirect", "/");
    render(<SpaRedirectReader />);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("renderar inget (null)", () => {
    const { container } = render(<SpaRedirectReader />);
    expect(container.innerHTML).toBe("");
  });
});
