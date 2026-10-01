-- #1408: e-postadressen är unik över alla byråer — ett konto per adress.
--
-- OIDC-inloggningen matchar claims mot användarraderna på e-post (ADR 0009,
-- #1371), så adressen ÄR kontots identitet. Utan unikt index kunde en admin i
-- byrå B skapa (eller döpa om) en användare till en adress som redan fanns i
-- byrå A, och vilken rad inloggningen hamnade på berodde på ordningen.
-- `user.create`/`user.update` svarar nu CONFLICT, och inloggningen nekar när
-- adressen matchar mer än ett konto. Indexet gör en dubblett omöjlig även vid
-- samtidiga anrop.
--
-- Normaliseringen är densamma som inloggningens (`sameLoginEmail`): skiftläge
-- och omgivande blanksteg spelar ingen roll. Raderade rader (tombstones)
-- räknas inte.
--
-- Felsäker: finns redan dubbletter skapas indexet INTE, och migreringen fälls
-- inte. Adresserna rapporteras som en NOTICE och rättas manuellt (slå ihop
-- eller byt adress), varefter indexet skapas för hand med samma sats som
-- nedan. Applikationens kontroller gäller ändå, och inloggningen nekar en
-- tvetydig adress i stället för att välja första träffen.

DO $$
DECLARE dups text;
BEGIN
  SELECT string_agg(d.email || ' (' || d.n || ' konton)', ', ' ORDER BY d.email) INTO dups FROM (
    SELECT lower(btrim("email")) AS email, count(*) AS n
    FROM "users"
    WHERE "deleted_at" IS NULL
    GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF dups IS NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "users_login_email_uq" ON "users" (lower(btrim("email"))) WHERE "deleted_at" IS NULL;
  ELSE
    RAISE NOTICE 'users: e-postadresser som hör till mer än ett konto — users_login_email_uq skapas inte förrän de rättats, skapa det sedan för hand (#1408): %', dups;
  END IF;
END $$;
