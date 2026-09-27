-- #1230: dokument länkas till sin faktureringskörning.
--
-- Kostnadsräkningens PDF får körningens id så att "Ångra kostnadsräkning" kan ta
-- bort just det dokumentet (tidigare hittades det bara via en tids-heuristik).
-- Nullable: vanliga dokument och äldre kostnadsräkningar saknar koppling.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS billing_run_id uuid;
CREATE INDEX IF NOT EXISTS documents_billing_run_idx ON documents (billing_run_id);
