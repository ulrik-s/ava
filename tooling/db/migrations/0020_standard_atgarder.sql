-- #956: byråns standardåtgärder — åtgärder som förekommer i varje ärende och som
-- ska registreras med samma beskrivning och tidsåtgång av alla på byrån.
-- Byråkonfiguration, samma mönster som organizations.document_tags (#621).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS standard_atgarder jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Spårbarhet: vilken standardåtgärd tidsposten registrerades ur (NULL = fritext).
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS standard_atgard_id text;
