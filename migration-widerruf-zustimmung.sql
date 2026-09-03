-- Nachweis der Zustimmungen bei der Online-Buchung.
--
-- WARUM: Bei einem Fernabsatzvertrag muss der Unternehmer BEWEISEN koennen, dass er
-- ordnungsgemaess belehrt hat und dass der Kunde dem vorzeitigen Leistungsbeginn
-- ausdruecklich zugestimmt hat. Ohne diesen Nachweis kann ein Verbraucher noch nach
-- getaner Arbeit widerrufen, und der Wertersatz nach Paragraf 357a Abs. 2 BGB entfaellt —
-- die Arbeit waere dann unbezahlt. Ein Haekchen, das nur im Browser existiert, beweist
-- nichts; es muss mit Zeitpunkt in der Datenbank stehen.

ALTER TABLE termine
  ADD COLUMN IF NOT EXISTS agb_am timestamptz,
  ADD COLUMN IF NOT EXISTS vorzeitige_leistung boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vorzeitige_leistung_am timestamptz;

COMMENT ON COLUMN termine.agb_am IS
  'Zeitpunkt der Bestaetigung von AGB und Widerrufsbelehrung bei der Online-Buchung (Paragraf 305 Abs. 2 BGB, Artikel 246a EGBGB).';
COMMENT ON COLUMN termine.vorzeitige_leistung IS
  'Kunde hat ausdruecklich zugestimmt, dass vor Ablauf der 14-taegigen Widerrufsfrist gearbeitet wird (Paragraf 356 Abs. 4 BGB).';
COMMENT ON COLUMN termine.vorzeitige_leistung_am IS
  'Zeitpunkt dieser Zustimmung.';

GRANT SELECT, INSERT, UPDATE ON termine TO reifenpro_user;
