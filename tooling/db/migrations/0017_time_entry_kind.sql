-- #891: tidspostens kategori (ARBETE/TIDSSPILLAN). NULL behandlas som ARBETE.
-- Tidsspillan ersätts på en egen, lägre norm i statligt betalda ärenden.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS kind text;
