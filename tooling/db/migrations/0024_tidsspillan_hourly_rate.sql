-- Byråns eget timpris för tidsspillan vid privat fakturering (#1199).
-- NULL = tidsspillan får samma timpris som arbete (ärende → jurist → byrå).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tidsspillan_hourly_rate integer;
