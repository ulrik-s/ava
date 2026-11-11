-- Byråns ärendetyper: valen i "Ärendetyp" när ett ärende läggs upp. Samma mönster
-- som organizations.document_tags (#621); redigeras i byråinställningarna.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS matter_types jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Moll & Grosskopfs lista. Bara om byrån inte redan har en egen.
UPDATE organizations SET matter_types = '[
  "Arvsärende", "Bodelning", "Bodelningsförrättare", "Bouppteckning", "Bouppteckningsman",
  "Faderskapsärende", "God man", "Förvaltarskap", "LBSB ärenden från FörvR", "LPT/LRV",
  "Lundia", "LVU/LVM", "Migrationsärende", "Målsägandebiträde", "Offentlig försvarare",
  "Rådgivning", "Rådgivning och Juristförsäkring", "Skiftesman",
  "Särskild företrädare för barn", "Underhållsbidrag", "Vårdnad/Umgänge",
  "Äktenskapsskillnad", "Övrigt"
]'::jsonb
WHERE name ILIKE '%grosskopf%' AND matter_types = '[]'::jsonb;
