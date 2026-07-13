-- #880: dokumentets riktning — inkommande (svaromål/dom från motpart/domstol) vs
-- utgående (inlaga/brev byrån skickar). NULL där det saknar mening (fakturor/underlag).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS direction text;
