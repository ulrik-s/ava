import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ErrorReportButton } from "@/components/diagnostics/error-report-button";
import { issueStore, logBuffer } from "@/lib/client/diagnostics";
import type { InvariantViolation } from "@/lib/shared/diagnostics/invariants";

const violation: InvariantViolation = {
  code: "KR_PENDING_NO_DOC",
  severity: "error",
  message: "Kostnadsräkning väntar på dom men saknar dokument.",
  context: { matterId: "m-1", billingRunId: "br-1" },
};

beforeEach(() => {
  issueStore.clear();
  logBuffer.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("ErrorReportButton", () => {
  it("renderar utan badge när inga fel finns", () => {
    render(<ErrorReportButton />);
    expect(screen.getByRole("button", { name: "Rapportera fel" })).toBeTruthy();
    expect(screen.queryByLabelText(/självupptäckta fel/)).toBeNull();
  });

  it("visar badge med antal självupptäckta fel", () => {
    issueStore.report([violation]);
    render(<ErrorReportButton />);
    expect(screen.getByLabelText("1 självupptäckta fel").textContent).toBe("1");
  });

  it("öppnar dialogen och listar självupptäckta fel", () => {
    issueStore.report([violation]);
    render(<ErrorReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Rapportera fel" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Kostnadsräkning väntar på dom/)).toBeTruthy();
  });

  it("öppnar en GitHub-issue-URL med beskrivning + violation", () => {
    issueStore.report([violation]);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ErrorReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Rapportera fel" }));
    fireEvent.change(screen.getByPlaceholderText(/Beskriv vad du gjorde/), { target: { value: "Det small" } });
    fireEvent.click(screen.getByRole("button", { name: /Öppna GitHub-issue/ }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0]![0] as string;
    expect(url).toContain("github.com/ulrik-s/ava/issues/new");
    const body = new URL(url).searchParams.get("body") ?? "";
    expect(decodeURIComponent(body)).toContain("Det small");
    expect(decodeURIComponent(body)).toContain("KR_PENDING_NO_DOC");
  });

  it("kopierar rapporten till urklipp", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ErrorReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Rapportera fel" }));
    fireEvent.click(screen.getByRole("button", { name: /Kopiera/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toContain("[AVA]");
  });

  it("rensar upptäckta fel från dialogen", () => {
    issueStore.report([violation]);
    render(<ErrorReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Rapportera fel" }));
    fireEvent.click(screen.getByRole("button", { name: "Rensa upptäckta fel" }));
    expect(issueStore.count()).toBe(0);
  });
});
