/**
 * Tester för ärendehuvudets läsvy (#1566): MatterHeaderDetails och
 * MatterTypeText visar uppgifterna som text, saknade med etikett och streck.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { MatterHeaderDetails, MatterTypeText, MISSING_VALUE } from "@/app/matters/[id]/_matter-header-details";

const INSURER = [{ role: "FORSAKRINGSBOLAG", contact: { contactType: "INSURANCE_COMPANY" } }] as const;
const ADVERSE = [{ role: "MOTPART", contact: { contactType: "INSURANCE_COMPANY" } }] as const;
const EMPTY = { courtCaseNumber: "", previousCourtCaseNumber: "", insuranceReference: "", contacts: [] };

describe("MatterHeaderDetails", () => {
  it("visar målnummer, tidigare målnr och beskrivning som text", () => {
    render(<MatterHeaderDetails {...EMPTY} courtCaseNumber="T 2-26" previousCourtCaseNumber="T 1-26" description="En bodelning" />);
    expect(screen.getByTestId("matter-court-case-number")).toHaveTextContent("Målnummer: T 2-26");
    expect(screen.getByText("Tidigare målnr")).toHaveTextContent("Tidigare målnr T 1-26");
    expect(screen.getByTestId("matter-description")).toHaveTextContent("Beskrivning: En bodelning");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("saknade uppgifter visas med streck; inget tidigare målnr utan byte", () => {
    render(<MatterHeaderDetails {...EMPTY} description={null} />);
    expect(screen.getByTestId("matter-court-case-number")).toHaveTextContent(`Målnummer: ${MISSING_VALUE}`);
    expect(screen.getByTestId("matter-description")).toHaveTextContent(`Beskrivning: ${MISSING_VALUE}`);
    expect(screen.queryByText("Tidigare målnr")).not.toBeInTheDocument();
  });

  it("försäkringsreferensen visas med försäkringsbolag, med streck när den saknas", () => {
    const { unmount } = render(<MatterHeaderDetails {...EMPTY} contacts={INSURER} insuranceReference="SK-1" />);
    expect(screen.getByTestId("matter-insurance-reference")).toHaveTextContent("Försäkringsreferens: SK-1");
    unmount();
    render(<MatterHeaderDetails {...EMPTY} contacts={INSURER} />);
    expect(screen.getByTestId("matter-insurance-reference")).toHaveTextContent(`Försäkringsreferens: ${MISSING_VALUE}`);
  });

  it("försäkringsreferensen döljs utan försäkringsbolag och när bolaget är motpart", () => {
    const { unmount } = render(<MatterHeaderDetails {...EMPTY} insuranceReference="SK-1" />);
    expect(screen.queryByTestId("matter-insurance-reference")).not.toBeInTheDocument();
    unmount();
    render(<MatterHeaderDetails {...EMPTY} contacts={ADVERSE} insuranceReference="SK-1" />);
    expect(screen.queryByTestId("matter-insurance-reference")).not.toBeInTheDocument();
  });
});

describe("MatterTypeText", () => {
  it("visar ärendetypen i fetstil, även en äldre fritext-typ som den är", () => {
    render(<MatterTypeText matterType="Gammal fritext-typ" />);
    expect(screen.getByTestId("matter-type")).toHaveTextContent(/^Gammal fritext-typ$/);
    expect(screen.getByTestId("matter-type")).toHaveClass("font-bold");
  });

  it("saknad ärendetyp visas som \"Ärendetyp: –\"", () => {
    render(<MatterTypeText matterType={null} />);
    expect(screen.getByTestId("matter-type")).toHaveTextContent(`Ärendetyp: ${MISSING_VALUE}`);
  });
});
