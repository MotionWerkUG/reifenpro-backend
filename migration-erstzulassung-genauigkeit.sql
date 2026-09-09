-- Genauigkeit der Erstzulassung: tag | monat | jahr
--
-- Entscheidung des Inhabers vom 09.09.2026: Erfasst wird IMMER die Erstzulassung; das Baujahr
-- ist eine andere Angabe und interessiert den Betrieb nicht. Ein Fahrzeug kann im Dezember
-- gebaut und im Maerz zugelassen worden sein -- die HU haengt an der Zulassung.
--
-- Der Kunde weiss sie oft nur ungenau, am Telefon haeufig nur das Jahr. Das soll ausdruecklich
-- moeglich bleiben. Damit die Anzeige dann keinen Monat erfindet, steht die Genauigkeit neben
-- dem Datum. Der 1. Januar bei 'jahr' ist ein Platzhalter zum Rechnen und Sortieren, KEINE
-- Aussage -- ohne diese Spalte stuende er spaeter auf einer Erinnerung, als haette ihn jemand
-- so erfasst.
ALTER TABLE fahrzeuge ADD COLUMN IF NOT EXISTS erstzulassung_genauigkeit text;
ALTER TABLE kunden    ADD COLUMN IF NOT EXISTS erstzulassung_genauigkeit text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fahrzeuge_ez_genauigkeit_check') THEN
    ALTER TABLE fahrzeuge ADD CONSTRAINT fahrzeuge_ez_genauigkeit_check
      CHECK (erstzulassung_genauigkeit IS NULL OR erstzulassung_genauigkeit IN ('tag','monat','jahr'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kunden_ez_genauigkeit_check') THEN
    ALTER TABLE kunden ADD CONSTRAINT kunden_ez_genauigkeit_check
      CHECK (erstzulassung_genauigkeit IS NULL OR erstzulassung_genauigkeit IN ('tag','monat','jahr'));
  END IF;
END $$;

COMMENT ON COLUMN fahrzeuge.erstzulassung_genauigkeit IS 'Wie genau die Erstzulassung bekannt ist: tag, monat oder jahr. Steuert NUR die Anzeige -- bei jahr steht im Datum der 1. Januar als Platzhalter.';
COMMENT ON COLUMN kunden.erstzulassung_genauigkeit IS 'Siehe fahrzeuge.erstzulassung_genauigkeit.';
