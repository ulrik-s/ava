-- #1354: den dokumenterade bedömningen av jävskontrollens träffar.
--
-- När kontrollen ger träffar tar advokaten (eller byråns admin) ställning
-- innan uppdraget tas. Bedömningen sparas på ärendet: vem som gjorde den,
-- när, och motiveringen. Nullable: ärenden utan träffar har ingen bedömning.

ALTER TABLE matters ADD COLUMN IF NOT EXISTS conflict_reviewed_by_id uuid;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS conflict_reviewed_at timestamptz;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS conflict_review_note text;
