-- #1379: register över utfärdade KR-referenser (KR-ÅÅÅÅ-NNNN).
--
-- Lasttestet (#1366) visade att två kostnadsräkningar som skickas in samtidigt
-- i samma byrå kunde få samma referens: den togs fram som högsta + 1 utan lås.
-- Servern tar nu ett transaktionslås per byrå och serie, och primärnyckeln
-- (byrå, referens) gör en dubblett omöjlig i databasen — samma mönster som
-- fakturanumrets register (0031_invoice_numbers).
--
-- Körningarna scopas via ärendet (ingen egen org-kolumn) — därför ett eget
-- register i stället för ett unikt index på billing_runs.
--
-- Felsäker backfill: befintliga referenser förs in, äldsta först. En historisk
-- dubblett (om buggen redan slagit till) kan inte föras in två gånger; den
-- fäller INTE migreringen utan rapporteras som en NOTICE med referenserna.
-- Skyddet gäller ändå för alla nya referenser. Dubbletterna rättas manuellt.

CREATE TABLE IF NOT EXISTS "kr_references" (
  "organization_id" uuid NOT NULL,
  "reference" text NOT NULL,
  "billing_run_id" uuid NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "kr_references_pk" PRIMARY KEY ("organization_id", "reference")
);

INSERT INTO "kr_references" ("organization_id", "reference", "billing_run_id")
SELECT m."organization_id", b."reference", b."id"
FROM "billing_runs" b
JOIN "matters" m ON m."id" = b."matter_id"
WHERE b."reference" IS NOT NULL
ORDER BY b."created_at", b."id"
ON CONFLICT DO NOTHING;

DO $$
DECLARE dups text;
BEGIN
  SELECT string_agg(d.organization_id::text || ' ' || d.reference || ' (' || d.n || ' st)', ', ') INTO dups FROM (
    SELECT m."organization_id", b."reference", count(*) AS n
    FROM "billing_runs" b JOIN "matters" m ON m."id" = b."matter_id"
    WHERE b."reference" IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF dups IS NOT NULL THEN
    RAISE NOTICE 'kr_references: KR-referenser som förekommer mer än en gång i samma byrå — rätta dem manuellt (#1379): %', dups;
  END IF;
END $$;
