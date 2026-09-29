-- #1243 (ADR 0012): register över utfärdade fakturanummer.
--
-- 17 kap. 24 § 2 mervärdesskattelagen kräver ett löpnummer som ENSAMT
-- identifierar fakturan. Klienten räknade fram numret lokalt, så två jurister
-- som fakturerade under samma avbrott kunde få samma nummer. Servern sätter nu
-- numret, och primärnyckeln (byrå, nummer) gör en dubblett omöjlig.
--
-- Fakturor scopas via ärendet (ingen egen org-kolumn) — därför ett eget
-- register i stället för ett unikt index på invoices.
--
-- Backfill: befintliga nummer förs in. Historiska dubbletter (om buggen redan
-- slagit till) kan inte föras in två gånger; de räknas och rapporteras som en
-- NOTICE i stället för att fälla migreringen — de måste rättas manuellt
-- (kreditera och ställ ut på nytt), men nya dubbletter är omöjliga härefter.

CREATE TABLE IF NOT EXISTS "invoice_numbers" (
  "organization_id" uuid NOT NULL,
  "invoice_number" text NOT NULL,
  "invoice_id" uuid NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoice_numbers_pk" PRIMARY KEY ("organization_id", "invoice_number")
);

INSERT INTO "invoice_numbers" ("organization_id", "invoice_number", "invoice_id")
SELECT m."organization_id", i."invoice_number", i."id"
FROM "invoices" i
JOIN "matters" m ON m."id" = i."matter_id"
WHERE i."invoice_number" IS NOT NULL
ORDER BY i."created_at"
ON CONFLICT DO NOTHING;

DO $$
DECLARE dup integer;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT m."organization_id", i."invoice_number"
    FROM "invoices" i JOIN "matters" m ON m."id" = i."matter_id"
    WHERE i."invoice_number" IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE NOTICE 'invoice_numbers: % fakturanummer förekommer mer än en gång i samma byrå — rätta dem manuellt (#1243)', dup;
  END IF;
END $$;
