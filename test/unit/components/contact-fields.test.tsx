/**
 * Partens fält (#1925): delade av Ny part och Ändra part. Nummerfältet följer
 * typen, ett ifyllt nummer döljs aldrig, och `contactInput` bygger routerns indata.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest-compat";
import {
  type ContactForm, ContactFields, contactFormOf, contactInput, EMPTY_CONTACT_FORM,
  showsOrgNumber, showsPersonalNumber,
} from "@/components/contacts/contact-fields";
import { asId } from "@/lib/shared/schemas/ids";

/** Formuläret med eget state; `latest` håller det senaste värdet. */
function renderFields(initial: ContactForm): { latest: () => ContactForm } {
  let current = initial;
  function Harness() {
    const [value, setValue] = useState(initial);
    current = value;
    return <ContactFields value={value} onChange={setValue} />;
  }
  render(<Harness />);
  return { latest: () => current };
}

const personnummer = () => screen.queryByLabelText("Personnummer");
const orgnummer = () => screen.queryByLabelText("Organisationsnummer");

describe("ContactFields — nummerfältet följer typen", () => {
  it("en person får personnummer, inte organisationsnummer", () => {
    renderFields(EMPTY_CONTACT_FORM);
    expect(personnummer()).toHaveAttribute("placeholder", "YYYYMMDD-XXXX");
    expect(orgnummer()).toBeNull();
  });

  it.each(["COMPANY", "AUTHORITY", "COURT", "OTHER"] as const)("%s får organisationsnummer, inte personnummer", (contactType) => {
    renderFields({ ...EMPTY_CONTACT_FORM, contactType });
    expect(orgnummer()).toHaveAttribute("placeholder", "XXXXXX-XXXX");
    expect(personnummer()).toBeNull();
  });

  it("ett sparat organisationsnummer på en person visas vid ändring", () => {
    renderFields(contactFormOf({ name: "Anna", contactType: "PERSON", personalNumber: null, orgNumber: "556677-8899" }));
    expect(orgnummer()).toHaveValue("556677-8899");
    expect(personnummer()).toHaveValue("");
  });

  it("efter ett typbyte står ett ifyllt nummer kvar och skickas med; ett tomt döljs", () => {
    const { latest } = renderFields(EMPTY_CONTACT_FORM);
    fireEvent.change(screen.getByLabelText("Personnummer"), { target: { value: "19900101-1111" } });
    fireEvent.change(screen.getByLabelText("Typ"), { target: { value: "COMPANY" } });
    expect(latest().contactType).toBe("COMPANY");
    expect(personnummer()).toHaveValue("19900101-1111");
    expect(orgnummer()).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Personnummer"), { target: { value: "" } });
    expect(personnummer()).toBeNull();
    expect(contactInput(latest())).toMatchObject({ contactType: "COMPANY", personalNumber: "" });
  });

  it("varje textfält skriver till sitt eget fält", () => {
    const { latest } = renderFields(EMPTY_CONTACT_FORM);
    const entries: Array<[string, keyof ContactForm, string]> = [
      ["Namn *", "name", "Anna"], ["E-post", "email", "a@x.se"], ["Telefon", "phone", "070"],
      ["Adress", "address", "Gatan 1"], ["Anteckningar", "notes", "ny"],
    ];
    for (const [label, key, value] of entries) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(latest()[key]).toBe(value);
    }
    expect(screen.getByLabelText("Anteckningar")).toHaveAttribute("rows", "2");
  });
});

describe("synlighetsreglerna", () => {
  it("personnummer: person eller ifyllt; organisationsnummer: inte person eller ifyllt", () => {
    expect(showsPersonalNumber({ ...EMPTY_CONTACT_FORM, contactType: "COMPANY", personalNumber: "x" })).toBe(true);
    expect(showsPersonalNumber({ ...EMPTY_CONTACT_FORM, contactType: "COMPANY" })).toBe(false);
    expect(showsOrgNumber({ ...EMPTY_CONTACT_FORM, orgNumber: "x" })).toBe(true);
    expect(showsOrgNumber(EMPTY_CONTACT_FORM)).toBe(false);
  });
});

describe("contactFormOf och contactInput", () => {
  it("en sparad part blir formulär med tomma strängar för saknade värden", () => {
    expect(contactFormOf({ name: "Acme AB", contactType: "COMPANY", orgNumber: "556677-8899", email: null })).toEqual({
      ...EMPTY_CONTACT_FORM, name: "Acme AB", contactType: "COMPANY", orgNumber: "556677-8899",
    });
  });

  it("ger indata för create, och med id för update", () => {
    const form: ContactForm = { ...EMPTY_CONTACT_FORM, name: "Anna", personalNumber: "19900101-1111" };
    expect(contactInput(form)).toEqual(form);
    const id = asId<"ContactId">("c-1");
    expect(contactInput(form, id)).toEqual({ id, ...form });
  });
});
