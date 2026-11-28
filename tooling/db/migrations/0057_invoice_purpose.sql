-- kind: expand
-- #1933: fakturans affärsroll (invoices.purpose, zod-enumen invoicePurposeSchema).
--
-- Betald rådgivning känns i dag igen på anteckningstexten
-- (RADGIVNING_INVOICE_NOTES), eftersom fakturatypen inte räcker: äldre
-- rådgivningsfakturor är ACCONTO och nyare STANDARD. Identiteten ska bäras av en
-- typ, inte av en visningstext (ADR 0038 §4). NULL = en vanlig faktura. Ingen
-- CHECK (den vore en contract); zod vaktar värdena.
--
-- Backfill, idempotent (bara rader där purpose är null): fakturor med exakt
-- rådgivningstexten som inte är kreditnotor får 'RADGIVNING'. Ändrade rader får
-- ny version + en change_log-rad med ärendets org-id (fakturor saknar egen
-- org-kolumn), som 0051 och 0054, så att klienternas cache hämtar dem igen.
--
-- Additivt: äldre kod läser inte kolumnen, och texten skrivs fortfarande, så en
-- automatisk rollback känner igen samma fakturor som i dag. Belopp, status och
-- text rörs inte.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS purpose text;

WITH changed AS (
  UPDATE invoices SET purpose = 'RADGIVNING', version = invoices.version + 1, updated_at = now()
  FROM matters
  WHERE matters.id = invoices.matter_id
    AND invoices.purpose IS NULL
    AND invoices.notes = 'Rådgivningstimme enligt rättshjälpstaxan (1 tim).'
    AND invoices.invoice_type <> 'CREDIT'
  RETURNING matters.organization_id, invoices.id, invoices.version, invoices.deleted_at
)
INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT organization_id, 'invoice', id, version, 'update' FROM changed WHERE deleted_at IS NULL;
