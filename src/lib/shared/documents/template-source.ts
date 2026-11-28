/**
 * En dokumentmall (ADR 0042): Handlebars-mallen och de partials den använder.
 * Det här är sömmen där fas 2 laddar byråns egen mall (Mallar-vyn) i stället
 * för standardmallen — renderaren tar emot vilken `DocumentTemplateSource` som
 * helst.
 */

/** En Handlebars-mall som ger layoutmarkering, med sina partials (`{{> namn}}`). */
export interface DocumentTemplateSource {
  template: string;
  partials: Readonly<Record<string, string>>;
}

/**
 * Platshållarna för sidnummer. Hjälpfunktionerna `{{pageNumber}}` och
 * `{{pageCount}}` skriver dem; renderaren ersätter dem i sidhuvud och sidfot när
 * sidantalet är känt. Tecken ur Unicodes privata område, så de aldrig krockar
 * med text ur ett ärende.
 */
export const PAGE_NUMBER_TOKEN = "";
export const PAGE_COUNT_TOKEN = "";
