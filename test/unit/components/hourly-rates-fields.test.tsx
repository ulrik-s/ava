/**
 * `HourlyRatesFields` (#1206) — fyra kr/h-fält, ett per timbaserad kategori;
 * värdet är kartan i öre, tomt fält = ärvs och placeholdern säger från vad.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest-compat";
import { formatKrPerHour, HourlyRatesFields, withRate } from "@/components/billing/hourly-rates-fields";

describe("formatKrPerHour", () => {
  it("öre/h → kronor med tusentalsavgränsning", () => {
    expect(formatKrPerHour(162_600).replace(/\s/g, " ")).toBe("1 626 kr/h");
    expect(formatKrPerHour(97_550).replace(/\s/g, " ")).toBe("975,5 kr/h");
  });
});

describe("withRate", () => {
  it("sätter kategorin i öre utan att röra de andra", () => {
    expect(withRate({ ARBETE: 250_000 }, "TIDSSPILLAN", 1487)).toEqual({ ARBETE: 250_000, TIDSSPILLAN: 148_700 });
  });

  it("ett tömt fält tar bort kategorin (ärvs igen)", () => {
    expect(withRate({ ARBETE: 250_000, TIDSSPILLAN: 148_700 }, "TIDSSPILLAN", null)).toEqual({ ARBETE: 250_000 });
  });
});

describe("HourlyRatesFields", () => {
  it("ett fält per timbaserad kategori med användarens namn", () => {
    render(<HourlyRatesFields value={{}} onChange={() => {}} />);
    for (const label of ["Timarvode", "Timarvode helg/kväll", "Tidsspillan", "Tidsspillan helg/kväll"]) {
      expect(screen.getByLabelText(new RegExp(`^${label} \\(kr/h`))).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Advokatberedskap/)).not.toBeInTheDocument();
  });

  it("visar egna priser i kronor och ärvda som placeholder", () => {
    render(<HourlyRatesFields value={{ ARBETE: 300_000 }} onChange={() => {}} parents={[{ TIDSSPILLAN: 148_700 }]} />);
    expect((screen.getByLabelText(/^Timarvode \(kr/) as HTMLInputElement).value).toBe("3000");
    // Byråns tidsspillan går före juristens timarvode …
    expect((screen.getByLabelText(/^Tidsspillan \(kr/) as HTMLInputElement).placeholder).toMatch(/^ärvs: 1\s487 kr\/h$/);
    // … men utan kategoripris ärvs nivåns eget timarvode.
    expect((screen.getByLabelText(/^Timarvode helg\/kväll/) as HTMLInputElement).placeholder).toMatch(/^ärvs: 3\s000 kr\/h$/);
    // Timarvodet självt har inget att ärva.
    expect((screen.getByLabelText(/^Timarvode \(kr/) as HTMLInputElement).placeholder).toBe("ej satt");
  });

  it("visar föreskriftens omfång under tidsspillan och helg/kväll", () => {
    render(<HourlyRatesFields value={{}} onChange={() => {}} />);
    expect(screen.getByText(/Vardag 08–18/)).toBeInTheDocument();
    expect(screen.getByText(/ersätts bara 07–22/)).toBeInTheDocument();
    expect(screen.getByText(/Häktningsförhandling helg/)).toBeInTheDocument();
  });

  it("en ändring ger hela kartan i öre", () => {
    const onChange = vi.fn();
    render(<HourlyRatesFields value={{ ARBETE: 300_000 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^Tidsspillan helg\/kväll/), { target: { value: "975" } });
    expect(onChange).toHaveBeenLastCalledWith({ ARBETE: 300_000, TIDSSPILLAN_OVRIG_TID: 97_500 });
  });
});
