-- #782: utlägg lagras netto (exkl moms). Konvertera befintliga brutto-rader
-- (vat_included = true) till netto och behåll per-utlägg momssats. AVA lägger
-- på momsen vid fakturering. PRUTNING-rader (vat_included redan false, vat_rate 0)
-- lämnas orörda.
UPDATE expenses
SET amount = round(amount::numeric * 10000 / (10000 + vat_rate)),
    vat_included = false
WHERE kind = 'EXPENSE' AND vat_included = true AND vat_rate <> 0;

UPDATE expenses
SET vat_included = false
WHERE kind = 'EXPENSE' AND vat_included = true AND vat_rate = 0;
