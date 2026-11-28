-- kind: expand
-- #2265: byråns betalningsvillkor (dagar från fakturadag till förfallodag).
-- NULL = kodens standard (DEFAULT_PAYMENT_TERM_DAYS i
-- src/lib/shared/billing/payment-terms.ts).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_term_days integer;
